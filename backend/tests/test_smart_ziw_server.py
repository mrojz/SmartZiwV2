import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

import server as server


def _mk_admin():
    return {
        "id": "a1",
        "email": "admin@example.com",
        "name": "Admin",
        "role": "admin",
        "passwordHash": "x",
        "avatarUrl": "",
        "mustChangePassword": False,
        "isActive": True,
    }


def _config_with_secrets():
    return {
        "firecrawl_api_key": "SECRET-FC-KEY",
        "gitlab_token": "SECRET-GL-TOKEN",
        "lightllm_api_key": "SECRET-LL-KEY",
        "firecrawl_base_url": "https://api.firecrawl.dev",
        "smart_ziw_research_enabled": True,
        "smart_ziw_research_timeout_seconds": 900,
    }


def test_admin_get_redacts_firecrawl_and_gitlab_keys(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)
    client = TestClient(server.app)
    r = client.get("/api/admin/smart-ziw-config")
    assert r.status_code == 200
    data = r.json()
    assert data["firecrawl_api_key"] == ""
    assert data["gitlab_token"] == ""
    assert data["lightllm_api_key"] == ""


def test_admin_update_preserves_empty_tokens(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"firecrawl_api_key": "", "gitlab_token": "", "lightllm_api_key": ""})
    assert r.status_code == 200
    assert saved["firecrawl_api_key"] == "SECRET-FC-KEY"
    assert saved["gitlab_token"] == "SECRET-GL-TOKEN"
    assert saved["lightllm_api_key"] == "SECRET-LL-KEY"
    assert r.json()["firecrawl_api_key"] == ""
    assert r.json()["gitlab_token"] == ""
    assert r.json()["lightllm_api_key"] == ""


def test_admin_update_stores_new_firecrawl_key(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"firecrawl_api_key": "NEW-KEY", "lightllm_api_key": "NEW-LL-KEY"})
    assert r.status_code == 200
    assert saved["firecrawl_api_key"] == "NEW-KEY"
    assert saved["lightllm_api_key"] == "NEW-LL-KEY"


def test_admin_update_stores_llm_provider_fields(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={
        "smart_ziw_llm_provider": "lightllm",
        "lightllm_base_url": "http://localhost:8000/v1",
        "lightllm_model": "Qwen/Qwen2.5-7B-Instruct",
    })
    assert r.status_code == 200
    assert saved["smart_ziw_llm_provider"] == "lightllm"
    assert saved["lightllm_base_url"] == "http://localhost:8000/v1"
    assert saved["lightllm_model"] == "Qwen/Qwen2.5-7B-Instruct"
    assert saved["lightllm_api_key"] == "SECRET-LL-KEY"
    assert r.json()["lightllm_api_key"] == ""


def test_format_comment_includes_research_summary():
    result = {
        "folder": "f",
        "repo_path": "/r",
        "files": ["tender.md"],
        "gitlab_pushed": False,
        "gitlab_message": "GitLab push disabled",
        "research": True,
        "research_stats": {"queries_run": 12, "pages_scraped": 9, "documents_captured": 3},
        "research_verdict": "MONITOR",
        "documents": ["dce.pdf"],
        "research_timed_out": False,
    }
    body = server._format_smart_ziw_comment(result)
    assert "12 queries" in body
    assert "9 pages scraped" in body
    assert "3 documents captured" in body
    assert "Recommendation: MONITOR" in body
    assert "Documents: dce.pdf" in body


def test_format_comment_notes_research_timeout():
    result = {
        "folder": "f",
        "repo_path": "/r",
        "files": [],
        "gitlab_pushed": False,
        "gitlab_message": "GitLab push disabled",
        "research": True,
        "research_stats": {"queries_run": 1, "pages_scraped": 0, "documents_captured": 0},
        "research_verdict": "MONITOR",
        "research_timed_out": True,
    }
    body = server._format_smart_ziw_comment(result)
    assert "research time limit reached" in body


def _mk_user():
    return {
        "id": "u1",
        "email": "user@example.com",
        "name": "User",
        "role": "user",
        "passwordHash": "x",
        "avatarUrl": "",
        "mustChangePassword": False,
        "isActive": True,
    }


def test_llm_models_endpoint_forbidden_for_non_admin(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user())
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"provider": "openai_compatible", "base_url": "http://localhost:8000/v1"})
    assert r.status_code == 403


def test_llm_models_endpoint_returns_discovery_result(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "discover_lightllm_models",
                        lambda provider, base_url, api_key: {"status": "ok", "models": [{"id": "m1", "name": "Model One"}]})
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"provider": "openai_compatible", "base_url": "http://localhost:8000/v1"})
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "models": [{"id": "m1", "name": "Model One"}]}


def test_llm_models_endpoint_forwards_typed_key_and_never_returns_it(monkeypatch):
    captured = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())

    def fake_discover(provider, base_url, api_key):
        captured["provider"] = provider
        captured["base_url"] = base_url
        captured["api_key"] = api_key
        return {"status": "auth_required", "models": []}

    monkeypatch.setattr(server, "discover_lightllm_models", fake_discover)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={
        "provider": "openai_compatible",
        "base_url": "http://localhost:8000/v1",
        "api_key": "TYPED-SECRET",
    })
    assert r.status_code == 200
    assert captured["api_key"] == "TYPED-SECRET"
    assert captured["base_url"] == "http://localhost:8000/v1"
    assert "TYPED-SECRET" not in r.text


def test_llm_models_endpoint_passes_blank_key_through(monkeypatch):
    captured = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())

    def fake_discover(provider, base_url, api_key):
        captured["api_key"] = api_key
        return {"status": "unsupported", "models": []}

    monkeypatch.setattr(server, "discover_lightllm_models", fake_discover)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"provider": "custom", "base_url": ""})
    assert r.status_code == 200
    assert captured["api_key"] == ""


def test_llm_env_status_returns_model_and_bool_only(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-x")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "SUPER-SECRET")
    monkeypatch.delenv("DEEPSEEK_WEB_MODEL", raising=False)
    client = TestClient(server.app)
    r = client.get("/api/admin/llm-env-status")
    assert r.status_code == 200
    assert r.json() == {"model": "deepseek-x", "api_key_set": True}
    assert "SUPER-SECRET" not in r.text


def test_llm_env_status_defaults_without_env_vars(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.delenv("DEEPSEEK_MODEL", raising=False)
    monkeypatch.delenv("DEEPSEEK_WEB_MODEL", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    client = TestClient(server.app)
    r = client.get("/api/admin/llm-env-status")
    assert r.status_code == 200
    assert r.json() == {"model": "deepseek-chat", "api_key_set": False}


def test_llm_env_status_forbidden_for_non_admin(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user())
    client = TestClient(server.app)
    r = client.get("/api/admin/llm-env-status")
    assert r.status_code == 403


def test_admin_update_defaults_lightllm_provider(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"firecrawl_api_key": ""})
    assert r.status_code == 200
    assert saved["lightllm_provider"] == "openai_compatible"


def test_admin_update_stores_lightllm_provider(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"lightllm_provider": "custom"})
    assert r.status_code == 200
    assert saved["lightllm_provider"] == "custom"


def test_admin_update_stores_llm_params(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"llm_temperature": 1.0, "llm_max_tokens": 8000})
    assert r.status_code == 200
    assert saved["llm_temperature"] == 1.0
    assert saved["llm_max_tokens"] == 8000


def _mk_user_no_admin():
    return {
        "id": "u1",
        "email": "user@example.com",
        "name": "User",
        "role": "user",
        "passwordHash": "x",
        "avatarUrl": "",
        "mustChangePassword": False,
        "isActive": True,
    }


def test_llm_test_endpoint_ok(monkeypatch):
    seen = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_get_llm_call(config, json_mode=True):
        seen["config"] = config
        seen["json_mode"] = json_mode
        return lambda system_prompt, user_prompt: "OK"

    monkeypatch.setattr(server, "get_llm_call", fake_get_llm_call)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-test", json={
        "smart_ziw_llm_provider": "lightllm",
        "lightllm_base_url": "http://localhost:8000/v1",
        "lightllm_model": "m",
        "lightllm_provider": "anthropic_compatible",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert seen["json_mode"] is False
    assert seen["config"]["lightllm_api_key"] == "SECRET-LL-KEY"
    assert seen["config"]["lightllm_provider"] == "anthropic_compatible"


def test_llm_test_endpoint_resolves_blank_key(monkeypatch):
    seen = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_get_llm_call(config, json_mode=True):
        seen["config"] = config
        return lambda system_prompt, user_prompt: "OK"

    monkeypatch.setattr(server, "get_llm_call", fake_get_llm_call)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-test", json={
        "smart_ziw_llm_provider": "lightllm",
        "lightllm_base_url": "http://localhost:8000/v1",
        "lightllm_api_key": "",
    })
    assert r.status_code == 200
    assert seen["config"]["lightllm_api_key"] == "SECRET-LL-KEY"


def test_llm_test_endpoint_returns_sanitized_error(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def failing_call(system_prompt, user_prompt):
        raise RuntimeError("Anthropic-compatible LLM request failed with HTTP 401: sk-leaked-key-value")

    monkeypatch.setattr(server, "get_llm_call", lambda config, json_mode: failing_call)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-test", json={
        "smart_ziw_llm_provider": "lightllm",
        "lightllm_base_url": "http://localhost:8000/v1",
        "lightllm_api_key": "sk-leaked-key-value",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "error"
    assert "HTTP 401" in data["detail"]
    assert "sk-leaked-key-value" not in data["detail"]


def test_llm_test_endpoint_requires_admin(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user_no_admin())
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-test", json={"smart_ziw_llm_provider": "lightllm"})
    assert r.status_code == 403
