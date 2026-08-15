"""LLM provider factory for Smart-Ziw.

Routes every Smart-Ziw LLM call to the admin-selected provider:
"auto" (default) uses the lightllm configuration when one is present
(base URL non-blank) and falls back to the .env DeepSeek parameters
otherwise. LightLLM is OpenAI-compatible, so the existing openai SDK
covers it — no new dependencies.

Imports of smart_ziw_agent symbols are function-level (lazy) so that
tests monkeypatching smart_ziw_agent._call_llm keep working through
this factory, and so smart_ziw_agent can import this module lazily
inside run() without an import cycle.
"""
import os
from typing import Callable

from openai import OpenAI

AUTO = "auto"
DEEPSEEK = "deepseek"
LIGHTLLM = "lightllm"
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
    return _lightllm_call(
        base_url=base_url,
        api_key=str(config.get("lightllm_api_key") or ""),
        model=str(config.get("lightllm_model") or "default"),
        json_mode=json_mode,
    )
