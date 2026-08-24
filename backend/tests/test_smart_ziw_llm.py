import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import requests

import smart_ziw_agent as agent
import smart_ziw_llm as sll


def _response(content):
    resp = MagicMock()
    resp.choices = [MagicMock()]
    resp.choices[0].message.content = content
    return resp


class _FakeOpenAI:
    instances = []
    next_content = '{"ok": true}'
    next_models = []            # returned by models.list() unless next_models_errors applies
    next_models_errors = []     # exceptions raised by successive models.list() calls

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.chat = MagicMock()
        self.chat.completions.create.return_value = _response(_FakeOpenAI.next_content)
        self.models = MagicMock()
        self.models.list.side_effect = _models_list_side_effect
        _FakeOpenAI.instances.append(self)


def _models_list_side_effect(*args, **kwargs):
    if _FakeOpenAI.next_models_errors:
        raise _FakeOpenAI.next_models_errors.pop(0)
    return MagicMock(data=list(_FakeOpenAI.next_models))


def _reset_fake_openai():
    _FakeOpenAI.instances = []
    _FakeOpenAI.next_content = '{"ok": true}'
    _FakeOpenAI.next_models = []
    _FakeOpenAI.next_models_errors = []


@pytest.fixture(autouse=True)
def _patch_stored_keys(monkeypatch):
    """Avoid real DB lookups when tests exercise stored-key fallbacks."""
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "")
    monkeypatch.setattr(sll, "_stored_lightllm_subscription_key", lambda: "")


def test_auto_with_blank_base_url_returns_env_call():
    assert getattr(sll, "get_llm_call")({}) is agent._call_llm
    assert getattr(sll, "get_llm_call")({"lightllm_base_url": "  "}) is agent._call_llm


def test_auto_with_blank_base_url_text_mode():
    call = getattr(sll, "get_llm_call")({}, json_mode=False)
    assert call is sll._call_llm_text


def test_forced_deepseek_ignores_lightllm_config():
    config = {"smart_ziw_llm_provider": "deepseek", "lightllm_base_url": "http://localhost:8000/v1"}
    assert getattr(sll, "get_llm_call")(config) is agent._call_llm


def test_unknown_provider_treated_as_auto():
    assert getattr(sll, "get_llm_call")({"smart_ziw_llm_provider": "not-a-preset"}) is agent._call_llm


def test_forced_lightllm_raises_on_blank_base_url():
    with pytest.raises(RuntimeError, match="LightLLM base URL is not configured"):
        getattr(sll, "get_llm_call")({"smart_ziw_llm_provider": "lightllm"})


def test_auto_uses_lightllm_when_base_url_set(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    call = getattr(sll, "get_llm_call")({"lightllm_base_url": "http://localhost:8000/v1"})
    result = call("s", "u")
    assert result == {"ok": True}
    assert len(_FakeOpenAI.instances) == 1
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["base_url"] == "http://localhost:8000/v1"
    assert client.kwargs["api_key"] == "EMPTY"
    create_kwargs = client.chat.completions.create.call_args.kwargs
    assert create_kwargs["model"] == "default"
    assert "response_format" not in create_kwargs


def test_lightllm_uses_configured_key_and_model(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    config = {
        "smart_ziw_llm_provider": "lightllm",
        "lightllm_base_url": "http://10.0.0.5:8000/v1",
        "lightllm_api_key": "k123",
        "lightllm_model": "Qwen/Qwen2.5-7B-Instruct",
    }
    getattr(sll, "get_llm_call")(config)("s", "u")
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["api_key"] == "k123"
    assert client.chat.completions.create.call_args.kwargs["model"] == "Qwen/Qwen2.5-7B-Instruct"


def test_lightllm_text_mode_returns_raw_string(monkeypatch):
    _reset_fake_openai()
    _FakeOpenAI.next_content = "plain answer"
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    call = getattr(sll, "get_llm_call")({"lightllm_base_url": "http://localhost:8000/v1"}, json_mode=False)
    assert call("s", "u") == "plain answer"


def test_lightllm_json_mode_coerces_garbage_to_empty(monkeypatch):
    _reset_fake_openai()
    _FakeOpenAI.next_content = "no json at all"
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    call = getattr(sll, "get_llm_call")({"lightllm_base_url": "http://localhost:8000/v1"})
    assert call("s", "u") == {}

# --- model discovery (discover_lightllm_models) ---

from openai import APIConnectionError, APIStatusError


def _status_error(status_code):
    return APIStatusError("status", response=MagicMock(status_code=status_code), body=None)


def test_discover_keyless_success_normalizes_models(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "")
    _FakeOpenAI.next_models = ["gpt-4o", {"id": "", "name": "Empty"}, {"id": "a1", "name": "Alpha"},
                                {"id": "a1", "name": "Alpha Dupe"}, {"id": "b1"}]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "ok", "models": [
        {"id": "a1", "name": "Alpha"},
        {"id": "b1", "name": "b1"},
        {"id": "gpt-4o", "name": "gpt-4o"},
    ]}
    assert len(_FakeOpenAI.instances) == 1
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["api_key"] == "EMPTY"
    assert client.kwargs["base_url"] == "http://localhost:8000/v1"


def test_discover_returns_no_models_on_empty_list(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "")
    _FakeOpenAI.next_models = []
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "no_models", "models": []}


def test_discover_401_retries_with_stored_key(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "stored-key")
    _FakeOpenAI.next_models_errors = [_status_error(401)]
    _FakeOpenAI.next_models = [{"id": "m1", "name": "Model One"}]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "ok", "models": [{"id": "m1", "name": "Model One"}]}
    assert len(_FakeOpenAI.instances) == 2
    assert _FakeOpenAI.instances[0].kwargs["api_key"] == "EMPTY"
    assert _FakeOpenAI.instances[1].kwargs["api_key"] == "stored-key"


def test_discover_401_without_key_returns_auth_required(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "")
    _FakeOpenAI.next_models_errors = [_status_error(401)]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "auth_required", "models": []}
    assert len(_FakeOpenAI.instances) == 1


def test_discover_typed_key_preferred_over_stored_key(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "stored-key")
    _FakeOpenAI.next_models_errors = [_status_error(401)]
    _FakeOpenAI.next_models = [{"id": "m1", "name": "Model One"}]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1", "typed-key")
    assert result["status"] == "ok"
    assert len(_FakeOpenAI.instances) == 2
    assert _FakeOpenAI.instances[1].kwargs["api_key"] == "typed-key"


def test_discover_404_returns_unsupported_without_retry(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "stored-key")
    _FakeOpenAI.next_models_errors = [_status_error(404)]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "unsupported", "models": []}
    assert len(_FakeOpenAI.instances) == 1  # no keyed retry on 404


def test_discover_connection_error_returns_sanitized_error(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    _FakeOpenAI.next_models_errors = [APIConnectionError(request=MagicMock())]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1", "my-secret-key")
    assert result["status"] == "error"
    assert result["models"] == []
    assert "my-secret-key" not in result["detail"]
    assert result["detail"] == "Connection to the LightLLM server failed"


def test_discover_http_500_returns_sanitized_error(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    _FakeOpenAI.next_models_errors = [_status_error(500)]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1", "my-secret-key")
    assert result["status"] == "error"
    assert "my-secret-key" not in result["detail"]
    assert result["detail"] == "The server returned HTTP 500"


def test_discover_custom_provider_no_network(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    result = sll.discover_lightllm_models("custom", "http://localhost:8000/v1")
    assert result == {"status": "unsupported", "models": []}
    assert _FakeOpenAI.instances == []


def test_discover_unknown_provider_no_network(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    result = sll.discover_lightllm_models("ollama", "http://localhost:8000/v1")
    assert result == {"status": "unsupported", "models": []}
    assert _FakeOpenAI.instances == []


def test_discover_blank_base_url_no_network(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    result = sll.discover_lightllm_models("openai_compatible", "   ")
    assert result["status"] == "error"
    assert result["models"] == []
    assert result["detail"] == "LightLLM base URL is not set"
    assert _FakeOpenAI.instances == []

# --- Anthropic-compatible provider (requests-based) ---


def _http_response(status_code=200, payload=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = payload if payload is not None else {}
    return resp


def _anthropic_config(**overrides):
    config = {
        "smart_ziw_llm_provider": "lightllm",
        "lightllm_base_url": "https://api.anthropic.com/v1",
        "lightllm_api_key": "k",
        "lightllm_model": "claude-x",
        "lightllm_provider": "anthropic_compatible",
    }
    config.update(overrides)
    return config


def test_anthropic_provider_routes_to_messages_endpoint(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        return _http_response(200, {"content": [{"type": "text", "text": "hello anthropic"}]})

    monkeypatch.setattr("smart_ziw_llm.requests.post", fake_post)
    call = getattr(sll, "get_llm_call")(_anthropic_config(), json_mode=False)
    result = call("sys", "user")
    assert result == "hello anthropic"
    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    assert captured["kwargs"]["timeout"] == 120.0
    headers = captured["kwargs"]["headers"]
    assert headers["x-api-key"] == "k"
    assert headers["anthropic-version"] == "2023-06-01"
    body = captured["kwargs"]["json"]
    assert body["model"] == "claude-x"
    assert body["max_tokens"] == 4000
    assert body["temperature"] == 0.1
    assert body["system"] == "sys"
    assert body["messages"] == [{"role": "user", "content": "user"}]


def test_anthropic_json_mode_uses_safe_json_loads(monkeypatch):
    monkeypatch.setattr(
        "smart_ziw_llm.requests.post",
        lambda url, **kwargs: _http_response(200, {"content": [{"text": '{"ok": 1}'}]}),
    )
    recorded = {}

    def fake_safe_json_loads(text):
        recorded["text"] = text
        return {"ok": 1}

    monkeypatch.setattr(agent, "_safe_json_loads", fake_safe_json_loads)
    call = getattr(sll, "get_llm_call")(_anthropic_config(), json_mode=True)
    assert call("sys", "user") == {"ok": 1}
    assert recorded["text"] == '{"ok": 1}'


def test_anthropic_http_error_raises(monkeypatch):
    monkeypatch.setattr("smart_ziw_llm.requests.post", lambda url, **kwargs: _http_response(500))
    call = getattr(sll, "get_llm_call")(_anthropic_config(), json_mode=False)
    with pytest.raises(RuntimeError, match="HTTP 500"):
        call("sys", "user")


def test_anthropic_provider_defaults_to_openai_path(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)

    def fake_post(*args, **kwargs):
        raise AssertionError("requests.post must not be used for the OpenAI-compatible path")

    monkeypatch.setattr("smart_ziw_llm.requests.post", fake_post)
    call = getattr(sll, "get_llm_call")(_anthropic_config(lightllm_provider="custom"), json_mode=False)
    assert call("s", "u") == _FakeOpenAI.next_content
    assert len(_FakeOpenAI.instances) == 1
    assert _FakeOpenAI.instances[0].kwargs["api_key"] == "k"


def test_discover_anthropic_models_ok(monkeypatch):
    captured = {}

    def fake_get(url, **kwargs):
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        captured["timeout"] = kwargs.get("timeout")
        return _http_response(200, {"data": [{"id": "claude-a", "display_name": "Claude A"}, {"id": "claude-b"}]})

    monkeypatch.setattr("smart_ziw_llm.requests.get", fake_get)
    result = sll.discover_lightllm_models("anthropic_compatible", "https://api.anthropic.com/v1", "")
    assert result == {"status": "ok", "models": [
        {"id": "claude-a", "name": "Claude A"},
        {"id": "claude-b", "name": "claude-b"},
    ]}
    assert captured["url"] == "https://api.anthropic.com/v1/models"
    assert captured["headers"]["x-api-key"] == "EMPTY"
    assert captured["headers"]["anthropic-version"] == "2023-06-01"
    assert captured["timeout"] == 8.0


def test_discover_anthropic_401_returns_auth_required(monkeypatch):
    monkeypatch.setattr("smart_ziw_llm.requests.get", lambda url, **kwargs: _http_response(401))
    result = sll.discover_lightllm_models("anthropic_compatible", "https://api.anthropic.com/v1", "k")
    assert result == {"status": "auth_required", "models": []}
    assert "k" not in str(result)


def test_discover_anthropic_404_returns_unsupported(monkeypatch):
    monkeypatch.setattr("smart_ziw_llm.requests.get", lambda url, **kwargs: _http_response(404))
    result = sll.discover_lightllm_models("anthropic_compatible", "https://api.anthropic.com/v1", "k")
    assert result == {"status": "unsupported", "models": []}


def test_discover_anthropic_connection_error_sanitized(monkeypatch):
    def fake_get(url, **kwargs):
        raise requests.exceptions.ConnectionError("boom")

    monkeypatch.setattr("smart_ziw_llm.requests.get", fake_get)
    result = sll.discover_lightllm_models("anthropic_compatible", "https://api.anthropic.com/v1", "secret-key")
    assert result["status"] == "error"
    assert result["models"] == []
    assert result["detail"] == "Connection to the LightLLM server failed"
    assert "secret-key" not in str(result)


# --- configurable llm_temperature / llm_max_tokens ---


def test_lightllm_uses_configured_temperature_and_max_tokens(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    config = {"lightllm_base_url": "http://localhost:8000/v1", "llm_temperature": 1.0, "llm_max_tokens": 1234}
    getattr(sll, "get_llm_call")(config)("s", "u")
    create_kwargs = _FakeOpenAI.instances[0].chat.completions.create.call_args.kwargs
    assert create_kwargs["temperature"] == 1.0
    assert create_kwargs["max_tokens"] == 1234


def test_anthropic_uses_configured_temperature_and_max_tokens(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured["body"] = kwargs["json"]
        return _http_response(200, {"content": [{"text": "ok"}]})

    monkeypatch.setattr("smart_ziw_llm.requests.post", fake_post)
    call = getattr(sll, "get_llm_call")(_anthropic_config(llm_temperature=1.0, llm_max_tokens=999), json_mode=False)
    assert call("s", "u") == "ok"
    assert captured["body"]["temperature"] == 1.0
    assert captured["body"]["max_tokens"] == 999


def test_env_path_custom_params_returns_parameterized_call(monkeypatch):
    created = {}

    def fake_create(**kwargs):
        created.update(kwargs)
        return _response('{"ok": true}')

    client = MagicMock()
    client.chat.completions.create.side_effect = fake_create
    monkeypatch.setattr(agent, "_deepseek_client", lambda: client)
    call = getattr(sll, "get_llm_call")({"llm_temperature": 1.0, "llm_max_tokens": 100})
    assert call is not agent._call_llm
    assert call("s", "u") == {"ok": True}
    assert created["temperature"] == 1.0
    assert created["max_tokens"] == 100
    assert created.get("response_format") == {"type": "json_object"}


def test_env_text_path_custom_params(monkeypatch):
    created = {}

    def fake_create(**kwargs):
        created.update(kwargs)
        return _response("plain")

    client = MagicMock()
    client.chat.completions.create.side_effect = fake_create
    monkeypatch.setattr(agent, "_deepseek_client", lambda: client)
    call = getattr(sll, "get_llm_call")({"llm_temperature": 1.0}, json_mode=False)
    assert call is not sll._call_llm_text
    assert call("s", "u") == "plain"
    assert created["temperature"] == 1.0
    assert created["max_tokens"] == 4000


def test_invalid_llm_params_fall_back_to_defaults(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    config = {"lightllm_base_url": "http://localhost:8000/v1", "llm_temperature": "abc", "llm_max_tokens": None}
    getattr(sll, "get_llm_call")(config)("s", "u")
    create_kwargs = _FakeOpenAI.instances[0].chat.completions.create.call_args.kwargs
    assert create_kwargs["temperature"] == 0.1
    assert create_kwargs["max_tokens"] == 4000


def test_llm_params_are_clamped(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    config = {"lightllm_base_url": "http://localhost:8000/v1", "llm_temperature": 5, "llm_max_tokens": 0}
    getattr(sll, "get_llm_call")(config)("s", "u")
    create_kwargs = _FakeOpenAI.instances[0].chat.completions.create.call_args.kwargs
    assert create_kwargs["temperature"] == 2.0
    assert create_kwargs["max_tokens"] == 1


# --- provider presets ---


def test_openai_preset_builds_client_with_defaults(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    call = getattr(sll, "get_llm_call")({"smart_ziw_llm_provider": "openai", "lightllm_api_key": "sk-openai"})
    call("s", "u")
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["api_key"] == "sk-openai"
    assert client.kwargs["base_url"] == "https://api.openai.com/v1"
    assert client.chat.completions.create.call_args.kwargs["model"] == "gpt-4o-mini"


def test_preset_uses_user_model_and_url_override(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    call = getattr(sll, "get_llm_call")({
        "smart_ziw_llm_provider": "openai",
        "lightllm_api_key": "k",
        "lightllm_base_url": "https://proxy.example/v1",
        "lightllm_model": "custom-model",
    })
    call("s", "u")
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["base_url"] == "https://proxy.example/v1"
    assert client.chat.completions.create.call_args.kwargs["model"] == "custom-model"


def test_anthropic_preset_routes_to_messages_endpoint(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        return _http_response(200, {"content": [{"type": "text", "text": "ok"}]})

    monkeypatch.setattr("smart_ziw_llm.requests.post", fake_post)
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    call = getattr(sll, "get_llm_call")({
        "smart_ziw_llm_provider": "anthropic",
        "lightllm_api_key": "ak",
        "lightllm_model": "claude-test",
    }, json_mode=False)
    assert call("s", "u") == "ok"
    assert captured["url"] == "https://api.anthropic.com/messages"
    assert captured["kwargs"]["headers"]["x-api-key"] == "ak"
    assert captured["kwargs"]["json"]["model"] == "claude-test"
    assert _FakeOpenAI.instances == []


def test_local_preset_uses_default_url_and_keyless_call(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    call = getattr(sll, "get_llm_call")({"smart_ziw_llm_provider": "local"})
    call("s", "u")
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["base_url"] == "http://localhost:8000/v1"
    assert client.kwargs["api_key"] == "EMPTY"


def test_custom_preset_openai_format(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    call = getattr(sll, "get_llm_call")({
        "smart_ziw_llm_provider": "custom",
        "lightllm_base_url": "https://custom.example/v1",
        "lightllm_api_key": "ck",
        "lightllm_model": "m",
    })
    call("s", "u")
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["base_url"] == "https://custom.example/v1"
    assert client.kwargs["api_key"] == "ck"
    assert client.chat.completions.create.call_args.kwargs["model"] == "m"


def test_custom_preset_anthropic_format(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        return _http_response(200, {"content": [{"type": "text", "text": "ok"}]})

    monkeypatch.setattr("smart_ziw_llm.requests.post", fake_post)
    call = getattr(sll, "get_llm_call")({
        "smart_ziw_llm_provider": "custom",
        "lightllm_base_url": "https://custom.example/v1",
        "lightllm_api_key": "ck",
        "lightllm_model": "claude-custom",
        "lightllm_provider": "anthropic_compatible",
    }, json_mode=False)
    assert call("s", "u") == "ok"
    assert captured["url"] == "https://custom.example/v1/messages"


def test_get_llm_provider_presets_returns_expected_shape():
    presets = sll.get_llm_provider_presets()
    ids = {p["id"] for p in presets}
    assert "openai" in ids
    assert "anthropic" in ids
    assert "gemini" in ids
    assert "groq" in ids
    assert "together" in ids
    assert "openrouter" in ids
    assert "deepseek_api" in ids
    assert "zai" in ids
    assert "kimi" in ids
    assert "local" in ids
    assert "custom" in ids
    assert all("id" in p and "name" in p and "base_url" in p for p in presets)


# --- preset model discovery ---


def test_discover_models_for_preset_unknown_preset():
    result = sll.discover_models_for_preset("unknown-preset")
    assert result == {"status": "error", "models": [], "detail": "Unknown provider preset"}


def test_discover_models_for_env_preset_is_unsupported():
    result = sll.discover_models_for_preset("deepseek")
    assert result["status"] == "unsupported"


def test_discover_models_for_openai_preset_uses_openai_sdk(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "")
    _FakeOpenAI.next_models_errors = [_status_error(401)]
    _FakeOpenAI.next_models = [{"id": "gpt-4o", "name": "GPT-4o"}]
    result = sll.discover_models_for_preset("openai", api_key="sk-openai")
    assert result == {"status": "ok", "models": [{"id": "gpt-4o", "name": "GPT-4o"}]}
    assert _FakeOpenAI.instances[0].kwargs["base_url"] == "https://api.openai.com/v1"
    assert _FakeOpenAI.instances[1].kwargs["api_key"] == "sk-openai"


def test_discover_models_for_anthropic_preset_uses_requests(monkeypatch):
    captured = {}

    def fake_get(url, **kwargs):
        captured["url"] = url
        return _http_response(200, {"data": [{"id": "claude-x", "display_name": "Claude X"}]})

    monkeypatch.setattr("smart_ziw_llm.requests.get", fake_get)
    result = sll.discover_models_for_preset("anthropic", api_key="ak")
    assert result == {"status": "ok", "models": [{"id": "claude-x", "name": "Claude X"}]}
    assert captured["url"] == "https://api.anthropic.com/models"


def test_discover_models_for_preset_falls_back_to_hardcoded(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    _FakeOpenAI.next_models_errors = [APIConnectionError(request=MagicMock())]
    preset = sll._PRESET_MAP["openai"]
    hardcoded = [{"id": "fallback", "name": "Fallback"}]
    try:
        # temporarily attach hardcoded models
        object.__setattr__(preset, "hardcoded_models", hardcoded)
        result = sll.discover_models_for_preset("openai", api_key="k")
        assert result == {"status": "ok", "models": hardcoded}
    finally:
        object.__setattr__(preset, "hardcoded_models", [])


def test_discover_models_for_preset_uses_user_base_url(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "")
    _FakeOpenAI.next_models = [{"id": "m1", "name": "Model 1"}]
    result = sll.discover_models_for_preset("local", base_url="http://127.0.0.1:9999/v1")
    assert result["status"] == "ok"
    assert _FakeOpenAI.instances[0].kwargs["base_url"] == "http://127.0.0.1:9999/v1"


# --- preset tool calls ---


def test_openai_preset_tool_call_uses_preset_client(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    tool_call = getattr(sll, "get_llm_tool_call")({
        "smart_ziw_llm_provider": "openai",
        "lightllm_api_key": "sk-openai",
        "lightllm_model": "gpt-4o-mini",
    })
    tool_call([{"role": "user", "content": "hi"}], None)
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["base_url"] == "https://api.openai.com/v1"
    assert client.kwargs["api_key"] == "sk-openai"
    assert client.chat.completions.create.call_args.kwargs["model"] == "gpt-4o-mini"


def test_anthropic_preset_tool_call_uses_requests(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["json"] = kwargs["json"]
        return _http_response(200, {"content": [{"type": "text", "text": "ok"}]})

    monkeypatch.setattr("smart_ziw_llm.requests.post", fake_post)
    tool_call = getattr(sll, "get_llm_tool_call")({
        "smart_ziw_llm_provider": "anthropic",
        "lightllm_api_key": "ak",
        "lightllm_model": "claude-test",
    })
    tool_call([{"role": "user", "content": "hi"}], None)
    assert captured["url"] == "https://api.anthropic.com/messages"
    assert captured["json"]["model"] == "claude-test"


def test_preset_tool_call_deepseek_env_still_uses_deepseek_client(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    created = {}

    def fake_create(**kwargs):
        created.update(kwargs)
        return _response('{"ok": true}')

    client = MagicMock()
    client.chat.completions.create.side_effect = fake_create
    monkeypatch.setattr(agent, "_deepseek_client", lambda: client)
    tool_call = getattr(sll, "get_llm_tool_call")({"smart_ziw_llm_provider": "deepseek"})
    tool_call([{"role": "user", "content": "hi"}], None)
    assert created["model"] == os.environ.get("DEEPSEEK_MODEL", os.environ.get("DEEPSEEK_WEB_MODEL", "deepseek-chat"))
    assert _FakeOpenAI.instances == []


# --- subscription / secondary key ---


def test_lightllm_uses_subscription_key_as_default_header(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    getattr(sll, "get_llm_call")({"lightllm_base_url": "http://localhost:8000/v1", "lightllm_subscription_key": "sub-123"})("s", "u")
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["default_headers"] == {"X-Subscription-Key": "sub-123"}


# --- Anthropic-compatible LLM client for the tool-loop ---


import asyncio


def test_client_calls_anthropic_sdk_with_tools(monkeypatch):
    from smart_ziw_llm import LLMClient

    calls = []
    class FakeTextBlock:
        type = "text"
        text = "done"

    class FakeMessage:
        content = [FakeTextBlock()]
        stop_reason = "end_turn"
        tool_calls = None

    class FakeMessages:
        def create(self, **kwargs):
            calls.append(kwargs)
            return FakeMessage()

    class FakeClient:
        messages = FakeMessages()

    client = LLMClient(base_url="https://api.kimi.com/coding", api_key="sk-test", model="kimi3")
    monkeypatch.setattr(client, "_client", FakeClient())
    result = asyncio.run(client.chat([{"role": "user", "content": "hello"}], tools=[]))
    assert result["role"] == "assistant"
    assert calls[0]["model"] == "kimi3"


def test_openai_preset_uses_subscription_key(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    getattr(sll, "get_llm_call")({"smart_ziw_llm_provider": "openai", "lightllm_api_key": "sk", "lightllm_subscription_key": "sub"})("s", "u")
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["default_headers"] == {"X-Subscription-Key": "sub"}


def test_anthropic_preset_sends_subscription_key_header(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured["headers"] = kwargs["headers"]
        return _http_response(200, {"content": [{"type": "text", "text": "ok"}]})

    monkeypatch.setattr("smart_ziw_llm.requests.post", fake_post)
    call = getattr(sll, "get_llm_call")({
        "smart_ziw_llm_provider": "anthropic",
        "lightllm_api_key": "ak",
        "lightllm_subscription_key": "sub",
    }, json_mode=False)
    assert call("s", "u") == "ok"
    assert captured["headers"]["X-Subscription-Key"] == "sub"


def test_discover_lightllm_sends_subscription_key(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "")
    monkeypatch.setattr(sll, "_stored_lightllm_subscription_key", lambda: "")
    _FakeOpenAI.next_models = [{"id": "m1", "name": "Model 1"}]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1", api_key="k", subscription_key="sub")
    assert result["status"] == "ok"
    assert _FakeOpenAI.instances[0].kwargs["default_headers"] == {"X-Subscription-Key": "sub"}
