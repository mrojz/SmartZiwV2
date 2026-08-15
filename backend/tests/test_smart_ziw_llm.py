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

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.chat = MagicMock()
        self.chat.completions.create.return_value = _response(_FakeOpenAI.next_content)
        _FakeOpenAI.instances.append(self)


def _reset_fake_openai():
    _FakeOpenAI.instances = []
    _FakeOpenAI.next_content = '{"ok": true}'


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
