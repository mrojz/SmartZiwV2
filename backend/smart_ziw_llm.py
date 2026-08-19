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
from dataclasses import dataclass, field
from typing import Any, Callable

import requests
from openai import APIConnectionError, APITimeoutError, APIStatusError, OpenAI

AUTO = "auto"
DEEPSEEK = "deepseek"
LIGHTLLM = "lightllm"
CUSTOM = "custom"
ANTHROPIC_COMPATIBLE = "anthropic_compatible"
_PROVIDERS = (AUTO, DEEPSEEK, LIGHTLLM)
_LIGHTLLM_PLACEHOLDER_KEY = "EMPTY"  # vLLM/LightLLM convention for keyless local endpoints
_DEFAULT_LLM_TEMPERATURE = 0.1
_DEFAULT_LLM_MAX_TOKENS = 4000


@dataclass(frozen=True)
class LlmProviderPreset:
    """Preset configuration for a well-known LLM provider."""

    id: str
    name: str
    base_url: str = ""
    format: str = "openai"  # "openai" | "anthropic" | "env" | "auto"
    default_model: str = "default"
    requires_api_key: bool = False
    hardcoded_models: list[dict] = field(default_factory=list)


# Preset registry: well-known providers plus env/auto/custom/local fallbacks.
# base_url values are defaults; users can override them for local/self-hosted presets.
_LLMM_PROVIDER_PRESETS: tuple[LlmProviderPreset, ...] = (
    LlmProviderPreset(
        id=AUTO,
        name="Auto (LightLLM if configured, else DeepSeek env)",
        format="auto",
        default_model="default",
        requires_api_key=False,
    ),
    LlmProviderPreset(
        id=DEEPSEEK,
        name="DeepSeek (environment API key)",
        format="env",
        default_model="deepseek-chat",
        requires_api_key=False,
    ),
    LlmProviderPreset(
        id="openai",
        name="OpenAI (ChatGPT)",
        base_url="https://api.openai.com/v1",
        format="openai",
        default_model="gpt-4o-mini",
        requires_api_key=True,
    ),
    LlmProviderPreset(
        id="anthropic",
        name="Anthropic (Claude)",
        base_url="https://api.anthropic.com",
        format="anthropic",
        default_model="claude-3-5-sonnet-20241022",
        requires_api_key=True,
    ),
    LlmProviderPreset(
        id="gemini",
        name="Google Gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        format="openai",
        default_model="gemini-1.5-flash",
        requires_api_key=True,
    ),
    LlmProviderPreset(
        id="groq",
        name="Groq",
        base_url="https://api.groq.com/openai/v1",
        format="openai",
        default_model="llama-3.1-70b-versatile",
        requires_api_key=True,
    ),
    LlmProviderPreset(
        id="together",
        name="Together AI",
        base_url="https://api.together.xyz/v1",
        format="openai",
        default_model="meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
        requires_api_key=True,
    ),
    LlmProviderPreset(
        id="zai",
        name="Z.ai (GLM)",
        base_url="https://api.z.ai/v1",
        format="openai",
        default_model="glm-4",
        requires_api_key=True,
    ),
    LlmProviderPreset(
        id="kimi",
        name="Kimi",
        base_url="https://api.moonshot.ai/v1",
        format="openai",
        default_model="kimi-k3",
        requires_api_key=True,
    ),
    LlmProviderPreset(
        id="openrouter",
        name="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        format="openai",
        default_model="openai/gpt-4o-mini",
        requires_api_key=True,
    ),
    LlmProviderPreset(
        id="deepseek_api",
        name="DeepSeek (API key)",
        base_url="https://api.deepseek.com/v1",
        format="openai",
        default_model="deepseek-chat",
        requires_api_key=True,
    ),
    LlmProviderPreset(
        id="local",
        name="Local / Self-hosted",
        base_url="http://localhost:8000/v1",
        format="openai",
        default_model="default",
        requires_api_key=False,
    ),
    LlmProviderPreset(
        id=CUSTOM,
        name="Custom endpoint",
        format="openai",
        default_model="default",
        requires_api_key=False,
    ),
)

_PRESET_MAP: dict[str, LlmProviderPreset] = {p.id: p for p in _LLMM_PROVIDER_PRESETS}
_PRESET_IDS: set[str] = set(_PRESET_MAP.keys())


def get_llm_provider_presets() -> list[dict]:
    """Return sanitized preset list for the admin UI."""
    return [
        {
            "id": p.id,
            "name": p.name,
            "base_url": p.base_url,
            "format": p.format,
            "default_model": p.default_model,
            "requires_api_key": p.requires_api_key,
            "hardcoded_models": p.hardcoded_models,
        }
        for p in _LLMM_PROVIDER_PRESETS
    ]


def _resolve_preset_config(config: dict) -> dict:
    """Merge a preset's defaults with user-supplied overrides.

    Returns a dict with base_url, api_key, subscription_key, model, format, requires_api_key.
    """
    provider_id = str(config.get("smart_ziw_llm_provider") or AUTO)
    preset = _PRESET_MAP.get(provider_id)
    if not preset:
        preset = _PRESET_MAP[AUTO]
    user_base_url = str(config.get("lightllm_base_url") or "").strip()
    base_url = user_base_url or preset.base_url
    api_key = str(config.get("lightllm_api_key") or "").strip()
    subscription_key = str(config.get("lightllm_subscription_key") or "").strip()
    model = str(config.get("lightllm_model") or preset.default_model or "default").strip()
    format_override = str(config.get("lightllm_provider") or "").strip()
    if provider_id == CUSTOM and format_override in (ANTHROPIC_COMPATIBLE, "openai_compatible"):
        fmt = "anthropic" if format_override == ANTHROPIC_COMPATIBLE else "openai"
    else:
        fmt = preset.format
    return {
        "base_url": base_url,
        "api_key": api_key,
        "subscription_key": subscription_key,
        "model": model,
        "format": fmt,
        "requires_api_key": preset.requires_api_key,
    }


def _coerce_llm_params(config: dict) -> tuple:
    """Read llm_temperature/llm_max_tokens from config with safe clamping.

    Returns (temperature, max_tokens): temperature clamped to [0, 2] and
    max_tokens to [1, 128000]. Missing or invalid values fall back to the
    defaults (0.1, 4000).
    """
    try:
        temperature = float(config.get("llm_temperature", _DEFAULT_LLM_TEMPERATURE))
    except (TypeError, ValueError):
        temperature = _DEFAULT_LLM_TEMPERATURE
    try:
        max_tokens = int(config.get("llm_max_tokens", _DEFAULT_LLM_MAX_TOKENS))
    except (TypeError, ValueError):
        max_tokens = _DEFAULT_LLM_MAX_TOKENS
    return (
        min(max(temperature, 0.0), 2.0),
        min(max(max_tokens, 1), 128000),
    )


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


def _lightllm_call(
    base_url: str,
    api_key: str,
    model: str,
    json_mode: bool,
    temperature: float = _DEFAULT_LLM_TEMPERATURE,
    max_tokens: int = _DEFAULT_LLM_MAX_TOKENS,
    subscription_key: str = "",
) -> Callable[[str, str], dict | str]:
    client_kwargs = {"api_key": api_key or _LIGHTLLM_PLACEHOLDER_KEY, "base_url": base_url, "timeout": 120.0}
    if subscription_key:
        client_kwargs["default_headers"] = {"X-Subscription-Key": subscription_key}
    client = OpenAI(**client_kwargs)

    def call(system_prompt: str, user_prompt: str):
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        content = response.choices[0].message.content or ("{}" if json_mode else "")
        if not json_mode:
            return content
        from smart_ziw_agent import _safe_json_loads
        return _safe_json_loads(content)

    return call


def _anthropic_call(
    base_url: str,
    api_key: str,
    model: str,
    json_mode: bool,
    temperature: float = _DEFAULT_LLM_TEMPERATURE,
    max_tokens: int = _DEFAULT_LLM_MAX_TOKENS,
    subscription_key: str = "",
) -> Callable[[str, str], dict | str]:
    """Anthropic-compatible Messages API call path (not wire-compatible with OpenAI)."""

    def call(system_prompt: str, user_prompt: str):
        headers = {
            "x-api-key": api_key or _LIGHTLLM_PLACEHOLDER_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        if subscription_key:
            headers["X-Subscription-Key"] = subscription_key
        resp = requests.post(
            f"{base_url.rstrip('/')}/messages",
            headers=headers,
            json={
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
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


def _env_json_call(temperature: float, max_tokens: int) -> Callable[[str, str], dict]:
    """Environment (DeepSeek) JSON-mode call with non-default LLM params."""

    def call(system_prompt: str, user_prompt: str) -> dict:
        from smart_ziw_agent import _deepseek_client, _safe_json_loads
        client = _deepseek_client()
        model = os.environ.get("DEEPSEEK_MODEL", os.environ.get("DEEPSEEK_WEB_MODEL", "deepseek-chat"))
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or "{}"
        return _safe_json_loads(content)

    return call


def _env_text_call(temperature: float, max_tokens: int) -> Callable[[str, str], str]:
    """Environment (DeepSeek) text-mode call with non-default LLM params."""

    def call(system_prompt: str, user_prompt: str) -> str:
        from smart_ziw_agent import _deepseek_client
        client = _deepseek_client()
        model = os.environ.get("DEEPSEEK_MODEL", os.environ.get("DEEPSEEK_WEB_MODEL", "deepseek-chat"))
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content or ""

    return call


def get_llm_call(config: dict | None = None, json_mode: bool = True) -> Callable[[str, str], dict | str]:
    """Return callable(system_prompt, user_prompt) -> dict (json_mode=True) or str (False).

    Provider resolution:
    - "auto" (default) -> lightllm/custom when a base URL is configured, else the .env DeepSeek path.
    - "deepseek" forces the env path.
    - Preset ids ("openai", "groq", ...) use the preset base URL and stored API key.
    - "lightllm" / "custom" use the user-supplied base URL and wire format.
    Unknown provider values are treated as "auto".
    """
    config = config or {}
    provider = str(config.get("smart_ziw_llm_provider") or AUTO)
    if provider not in _PROVIDERS and provider not in _PRESET_IDS:
        provider = AUTO
    temperature, max_tokens = _coerce_llm_params(config)

    # Preset providers (openai, groq, together, ...)
    if provider in _PRESET_IDS and provider not in (AUTO, DEEPSEEK, LIGHTLLM, CUSTOM):
        pc = _resolve_preset_config(config)
        if pc["format"] == "anthropic":
            return _anthropic_call(
                base_url=pc["base_url"],
                api_key=pc["api_key"],
                model=pc["model"],
                json_mode=json_mode,
                temperature=temperature,
                max_tokens=max_tokens,
                subscription_key=pc["subscription_key"],
            )
        return _lightllm_call(
            base_url=pc["base_url"],
            api_key=pc["api_key"],
            model=pc["model"],
            json_mode=json_mode,
            temperature=temperature,
            max_tokens=max_tokens,
            subscription_key=pc["subscription_key"],
        )

    base_url = str(config.get("lightllm_base_url") or "").strip()
    subscription_key = str(config.get("lightllm_subscription_key") or "").strip()
    if provider in (LIGHTLLM, CUSTOM) and not base_url:
        raise RuntimeError("LightLLM base URL is not configured")
    use_lightllm = provider in (LIGHTLLM, CUSTOM) or (provider == AUTO and bool(base_url))
    if not use_lightllm:
        # Default params keep the original callables (identity preserved for
        # callers and tests); custom params get equivalent closures.
        if temperature == _DEFAULT_LLM_TEMPERATURE and max_tokens == _DEFAULT_LLM_MAX_TOKENS:
            if json_mode:
                from smart_ziw_agent import _call_llm
                return _call_llm
            return _call_llm_text
        if json_mode:
            return _env_json_call(temperature, max_tokens)
        return _env_text_call(temperature, max_tokens)
    provider_format = str(config.get("lightllm_provider") or "openai_compatible")
    if provider_format == ANTHROPIC_COMPATIBLE:
        return _anthropic_call(
            base_url=base_url,
            api_key=str(config.get("lightllm_api_key") or ""),
            model=str(config.get("lightllm_model") or "default"),
            json_mode=json_mode,
            temperature=temperature,
            max_tokens=max_tokens,
            subscription_key=subscription_key,
        )
    return _lightllm_call(
        base_url=base_url,
        api_key=str(config.get("lightllm_api_key") or ""),
        model=str(config.get("lightllm_model") or "default"),
        json_mode=json_mode,
        temperature=temperature,
        max_tokens=max_tokens,
        subscription_key=subscription_key,
    )


class _SimpleToolCall:
    """Minimal wrapper for Anthropic-style tool_use blocks."""

    def __init__(self, id: str, name: str, arguments: dict):
        self.id = id
        self.function = _SimpleFunction(name=name, arguments=arguments)


class _SimpleFunction:
    def __init__(self, name: str, arguments: dict):
        self.name = name
        self.arguments = arguments


class _SimpleMessage:
    def __init__(self, content: str, tool_calls: list | None):
        self.content = content
        self.tool_calls = tool_calls or []


class _SimpleToolResponse:
    def __init__(self, message: _SimpleMessage):
        self.message = message


def get_llm_tool_call(config: dict | None = None) -> Callable[[list[dict], list[dict] | None], Any]:
    """Return callable(messages, tools) -> raw response with .message.content and .message.tool_calls.

    Supports OpenAI-compatible (incl. DeepSeek / LightLLM-openai) and
    Anthropic-compatible (LightLLM-anthropic) providers.
    """
    config = config or {}
    provider = str(config.get("smart_ziw_llm_provider") or AUTO)
    if provider not in _PROVIDERS and provider not in _PRESET_IDS:
        provider = AUTO
    temperature, max_tokens = _coerce_llm_params(config)

    # Preset providers
    if provider in _PRESET_IDS and provider not in (AUTO, DEEPSEEK, LIGHTLLM, CUSTOM):
        pc = _resolve_preset_config(config)
        base_url = pc["base_url"]
        api_key = pc["api_key"]
        subscription_key = pc["subscription_key"]
        model = pc["model"]
        fmt = pc["format"]
    else:
        base_url = str(config.get("lightllm_base_url") or "").strip()
        api_key = str(config.get("lightllm_api_key") or "")
        subscription_key = str(config.get("lightllm_subscription_key") or "")
        model = str(config.get("lightllm_model") or "default")
        fmt = str(config.get("lightllm_provider") or "openai_compatible")

    def _openai_tool_call(messages: list[dict], tools: list[dict] | None):
        if provider == DEEPSEEK or (provider == AUTO and not base_url):
            from smart_ziw_agent import _deepseek_client
            client = _deepseek_client()
            resolved_model = os.environ.get("DEEPSEEK_MODEL", os.environ.get("DEEPSEEK_WEB_MODEL", "deepseek-chat"))
        else:
            resolved_model = model
            client_kwargs = {"api_key": api_key or _LIGHTLLM_PLACEHOLDER_KEY, "base_url": base_url, "timeout": 120.0}
            if subscription_key:
                client_kwargs["default_headers"] = {"X-Subscription-Key": subscription_key}
            client = OpenAI(**client_kwargs)
        kwargs: dict = {
            "model": resolved_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        return client.chat.completions.create(**kwargs)

    def _anthropic_tool_call(messages: list[dict], tools: list[dict] | None):
        if not base_url:
            raise RuntimeError("LightLLM base URL is not configured")
        headers = {
            "x-api-key": api_key or _LIGHTLLM_PLACEHOLDER_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        if subscription_key:
            headers["X-Subscription-Key"] = subscription_key
        system = ""
        anthropic_messages = messages
        if messages and messages[0].get("role") == "system":
            system = messages[0].get("content", "")
            anthropic_messages = messages[1:]
        payload: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": anthropic_messages,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = tools
        resp = requests.post(
            f"{base_url.rstrip('/')}/messages",
            headers=headers,
            json=payload,
            timeout=120.0,
        )
        if not (200 <= resp.status_code < 300):
            raise RuntimeError(f"Anthropic-compatible LLM request failed with HTTP {resp.status_code}")
        data = resp.json()
        content = ""
        tool_calls = []
        for block in data.get("content") or []:
            block_type = block.get("type")
            if block_type == "text":
                content += block.get("text", "")
            elif block_type == "tool_use":
                tool_calls.append(_SimpleToolCall(
                    id=block.get("id", ""),
                    name=block.get("name", ""),
                    arguments=block.get("input") or {},
                ))
        return _SimpleToolResponse(_SimpleMessage(content=content, tool_calls=tool_calls))

    if fmt == ANTHROPIC_COMPATIBLE or fmt == "anthropic":
        return _anthropic_tool_call
    return _openai_tool_call


_LIGHTLLM_DISCOVERY_TIMEOUT = 8.0


def _stored_lightllm_api_key() -> str:
    """Stored LightLLM API key from the admin config; empty on any failure."""
    try:
        from database import get_smart_ziw_config
        return str(get_smart_ziw_config().get("lightllm_api_key") or "")
    except Exception:
        return ""


def _stored_lightllm_subscription_key() -> str:
    """Stored LightLLM subscription/secondary key from the admin config; empty on any failure."""
    try:
        from database import get_smart_ziw_config
        return str(get_smart_ziw_config().get("lightllm_subscription_key") or "")
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


def _discover_anthropic_models(base_url: str, api_key: str = "", subscription_key: str = "") -> dict:
    """Discover models via the Anthropic-compatible /models endpoint."""
    if not base_url:
        return {"status": "error", "models": [], "detail": "LightLLM base URL is not set"}
    resolved_key = str(api_key or "").strip() or _stored_lightllm_api_key()
    resolved_subscription_key = str(subscription_key or "").strip() or _stored_lightllm_subscription_key()
    headers = {
        "x-api-key": resolved_key or _LIGHTLLM_PLACEHOLDER_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    if resolved_subscription_key:
        headers["X-Subscription-Key"] = resolved_subscription_key
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


def discover_models_for_preset(preset_id: str, base_url: str = "", api_key: str = "", subscription_key: str = "") -> dict:
    """Discover models for a provider preset.

    Uses the OpenAI SDK for OpenAI-compatible presets and the existing
    Anthropic-compatible path for Anthropic. Falls back to hardcoded models
    when discovery is unsupported. The API key never appears in the response.
    """
    preset = _PRESET_MAP.get(preset_id)
    if not preset:
        return {"status": "error", "models": [], "detail": "Unknown provider preset"}
    if preset.format == "env":
        return {"status": "unsupported", "models": [], "detail": "Environment provider does not support model discovery"}
    effective_base_url = str(base_url or "").strip() or preset.base_url
    if not effective_base_url:
        return {"status": "error", "models": [], "detail": "Base URL is not set"}
    effective_key = str(api_key or "").strip() or _stored_lightllm_api_key()
    effective_subscription_key = str(subscription_key or "").strip() or _stored_lightllm_subscription_key()

    if preset.format == "anthropic":
        result = _discover_anthropic_models(effective_base_url, effective_key, effective_subscription_key)
    else:
        result = discover_lightllm_models("openai_compatible", effective_base_url, effective_key, effective_subscription_key)

    if result.get("status") in ("unsupported", "error") and preset.hardcoded_models:
        return {"status": "ok", "models": list(preset.hardcoded_models)}
    return result


def discover_lightllm_models(provider: str, base_url: str, api_key: str = "", subscription_key: str = "") -> dict:
    """Discover models on a LightLLM server (OpenAI- or Anthropic-compatible).

    The OpenAI-compatible path attempts keyless discovery first; on 401/403
    retries with the resolved key (the provided api_key when non-blank, else
    the stored lightllm_api_key). Returns {"status", "models", ...} with
    status one of ok | no_models | auth_required | unsupported | error. The
    API key never appears in the returned dict.
    """
    if str(provider or "").strip() == ANTHROPIC_COMPATIBLE:
        return _discover_anthropic_models(str(base_url or "").strip(), api_key, subscription_key)
    if str(provider or "").strip() != "openai_compatible":
        return {"status": "unsupported", "models": []}
    base_url = str(base_url or "").strip()
    if not base_url:
        return {"status": "error", "models": [], "detail": "LightLLM base URL is not set"}
    resolved_key = str(api_key or "").strip() or _stored_lightllm_api_key()
    resolved_subscription_key = str(subscription_key or "").strip() or _stored_lightllm_subscription_key()
    keys = [_LIGHTLLM_PLACEHOLDER_KEY]
    if resolved_key:
        keys.append(resolved_key)
    for key in keys:
        try:
            client_kwargs = {"api_key": key, "base_url": base_url, "timeout": _LIGHTLLM_DISCOVERY_TIMEOUT}
            if resolved_subscription_key:
                client_kwargs["default_headers"] = {"X-Subscription-Key": resolved_subscription_key}
            client = OpenAI(**client_kwargs)
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
