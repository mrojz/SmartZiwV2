"""LLM provider factory for Smart-Ziw.

Routes every Smart-Ziw LLM call to the admin-selected provider:
"auto" (default) uses the lightllm configuration when one is present
(base URL non-blank) and falls back to the .env DeepSeek parameters
otherwise. LightLLM servers are covered by two wire formats:
"openai_compatible" via the existing openai SDK, and
"anthropic_compatible" via requests (the Anthropic Messages API is
not wire-compatible with OpenAI). No new dependencies.

Imports of smart_ziw_agent symbols are function-level (lazy) so that
tests monkeypatching smart_ziw_agent._call_llm keep working through
this factory, and so smart_ziw_agent can import this module lazily
inside run() without an import cycle.
"""
import os
from typing import Callable

import requests
from openai import APIConnectionError, APITimeoutError, APIStatusError, OpenAI

AUTO = "auto"
DEEPSEEK = "deepseek"
LIGHTLLM = "lightllm"
ANTHROPIC_COMPATIBLE = "anthropic_compatible"
_PROVIDERS = (AUTO, DEEPSEEK, LIGHTLLM)
_LIGHTLLM_PLACEHOLDER_KEY = "EMPTY"  # vLLM/LightLLM convention for keyless local endpoints


def _call_llm_text(system_prompt: str, user_prompt: str) -> str:
    from smart_ziw_agent import _deepseek_client
    model = os.environ.get("DEEPSEEK_MODEL", os.environ.get("DEEPSEEK_WEB_MODEL", "deepseek-chat"))
    client = _deepseek_client()
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
        max_tokens=4000,
    )
    return response.choices[0].message.content or ""


def _lightllm_call(base_url: str, api_key: str, model: str, json_mode: bool) -> Callable[[str, str], dict | str]:
    client = OpenAI(api_key=api_key or _LIGHTLLM_PLACEHOLDER_KEY, base_url=base_url)

    def call(system_prompt: str, user_prompt: str):
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=4000,
        )
        content = response.choices[0].message.content or ("{}" if json_mode else "")
        if not json_mode:
            return content
        from smart_ziw_agent import _safe_json_loads
        return _safe_json_loads(content)

    return call


def _anthropic_call(base_url: str, api_key: str, model: str, json_mode: bool) -> Callable[[str, str], dict | str]:
    """Anthropic-compatible Messages API call path (not wire-compatible with OpenAI)."""

    def call(system_prompt: str, user_prompt: str):
        headers = {
            "x-api-key": api_key or _LIGHTLLM_PLACEHOLDER_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        resp = requests.post(
            f"{base_url.rstrip('/')}/messages",
            headers=headers,
            json={
                "model": model,
                "max_tokens": 4000,
                "temperature": 0.1,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=120.0,
        )
        if not (200 <= resp.status_code < 300):
            raise RuntimeError(f"Anthropic-compatible LLM request failed with HTTP {resp.status_code}")
        data = resp.json()
        content = (data.get("content") or [{}])[0].get("text") or ""
        if not json_mode:
            return content
        from smart_ziw_agent import _safe_json_loads
        return _safe_json_loads(content)

    return call


def get_llm_call(config: dict | None = None, json_mode: bool = True) -> Callable[[str, str], dict | str]:
    """Return callable(system_prompt, user_prompt) -> dict (json_mode=True) or str (False).

    Provider resolution: "auto" (default) -> lightllm params when
    lightllm_base_url is non-blank, else the .env DeepSeek path.
    "deepseek" forces the env path; "lightllm" forces lightllm and
    raises RuntimeError when the base URL is blank. Unknown provider
    values are treated as "auto".
    """
    config = config or {}
    provider = str(config.get("smart_ziw_llm_provider") or AUTO)
    if provider not in _PROVIDERS:
        provider = AUTO
    base_url = str(config.get("lightllm_base_url") or "").strip()
    if provider == LIGHTLLM and not base_url:
        raise RuntimeError("LightLLM base URL is not configured")
    use_lightllm = provider == LIGHTLLM or (provider == AUTO and bool(base_url))
    if not use_lightllm:
        if json_mode:
            from smart_ziw_agent import _call_llm
            return _call_llm
        return _call_llm_text
    provider_format = str(config.get("lightllm_provider") or "openai_compatible")
    if provider_format == ANTHROPIC_COMPATIBLE:
        return _anthropic_call(
            base_url=base_url,
            api_key=str(config.get("lightllm_api_key") or ""),
            model=str(config.get("lightllm_model") or "default"),
            json_mode=json_mode,
        )
    return _lightllm_call(
        base_url=base_url,
        api_key=str(config.get("lightllm_api_key") or ""),
        model=str(config.get("lightllm_model") or "default"),
        json_mode=json_mode,
    )

_LIGHTLLM_DISCOVERY_TIMEOUT = 8.0


def _stored_lightllm_api_key() -> str:
    """Stored LightLLM API key from the admin config; empty on any failure."""
    try:
        from database import get_smart_ziw_config
        return str(get_smart_ziw_config().get("lightllm_api_key") or "")
    except Exception:
        return ""


def _normalize_llm_models(entries) -> list[dict]:
    """Normalize a models listing into [{"id", "name"}] — deduped by id, sorted by name."""
    models: list[dict] = []
    seen: set = set()
    for entry in entries or []:
        if isinstance(entry, str):
            model_id = entry.strip()
            name = ""
        elif isinstance(entry, dict):
            model_id = str(entry.get("id") or "").strip()
            name = str(entry.get("name") or "").strip()
        else:
            continue
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append({"id": model_id, "name": name or model_id})
    models.sort(key=lambda m: (m["name"] or m["id"]).lower())
    return models


def _discover_anthropic_models(base_url: str, api_key: str = "") -> dict:
    """Discover models via the Anthropic-compatible /models endpoint."""
    if not base_url:
        return {"status": "error", "models": [], "detail": "LightLLM base URL is not set"}
    headers = {
        "x-api-key": str(api_key or "").strip() or _LIGHTLLM_PLACEHOLDER_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    try:
        resp = requests.get(f"{base_url.rstrip('/')}/models", headers=headers, timeout=_LIGHTLLM_DISCOVERY_TIMEOUT)
        if resp.status_code in (401, 403):
            return {"status": "auth_required", "models": []}
        if resp.status_code == 404:
            return {"status": "unsupported", "models": []}
        if resp.status_code != 200:
            return {"status": "error", "models": [], "detail": f"The server returned HTTP {resp.status_code}"}
        entries = resp.json().get("data") or []
        models = _normalize_llm_models(
            {"id": str(e.get("id") or "").strip(), "name": str(e.get("display_name") or e.get("id") or "").strip()}
            for e in entries
        )
        if models:
            return {"status": "ok", "models": models}
        return {"status": "no_models", "models": []}
    except Exception:
        return {"status": "error", "models": [], "detail": "Connection to the LightLLM server failed"}


def discover_lightllm_models(provider: str, base_url: str, api_key: str = "") -> dict:
    """Discover models on a LightLLM server (OpenAI- or Anthropic-compatible).

    The OpenAI-compatible path attempts keyless discovery first; on 401/403
    retries with the resolved key (the provided api_key when non-blank, else
    the stored lightllm_api_key). Returns {"status", "models", ...} with
    status one of ok | no_models | auth_required | unsupported | error. The
    API key never appears in the returned dict.
    """
    if str(provider or "").strip() == ANTHROPIC_COMPATIBLE:
        return _discover_anthropic_models(str(base_url or "").strip(), api_key)
    if str(provider or "").strip() != "openai_compatible":
        return {"status": "unsupported", "models": []}
    base_url = str(base_url or "").strip()
    if not base_url:
        return {"status": "error", "models": [], "detail": "LightLLM base URL is not set"}
    resolved_key = str(api_key or "").strip() or _stored_lightllm_api_key()
    keys = [_LIGHTLLM_PLACEHOLDER_KEY]
    if resolved_key:
        keys.append(resolved_key)
    for key in keys:
        try:
            client = OpenAI(api_key=key, base_url=base_url, timeout=_LIGHTLLM_DISCOVERY_TIMEOUT)
            listing = client.models.list()
            entries = listing.data if hasattr(listing, "data") else listing
            models = _normalize_llm_models(entries)
            if models:
                return {"status": "ok", "models": models}
            return {"status": "no_models", "models": []}
        except APIStatusError as exc:
            if exc.status_code in (401, 403):
                continue
            if exc.status_code == 404:
                return {"status": "unsupported", "models": []}
            return {"status": "error", "models": [], "detail": f"The server returned HTTP {exc.status_code}"}
        except (APIConnectionError, APITimeoutError):
            return {"status": "error", "models": [], "detail": "Connection to the LightLLM server failed"}
        except Exception:
            return {"status": "error", "models": [], "detail": "Failed to discover models from the LightLLM server"}
    return {"status": "auth_required", "models": []}
