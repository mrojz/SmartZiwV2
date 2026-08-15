import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

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
    assert getattr(sll, "get_llm_call")({"smart_ziw_llm_provider": "mistral"}) is agent._call_llm


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
