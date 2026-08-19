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
        "gitlab_token": "SECRET-GL-TOKEN",
        "lightllm_api_key": "SECRET-LL-KEY",
        "lightllm_subscription_key": "SECRET-SUB-KEY",
        "smart_ziw_research_enabled": True,
        "smart_ziw_research_timeout_seconds": 900,
        "forvis_mazars_presence_countries": ["tunisia", "france"],
    }


def test_admin_get_redacts_gitlab_and_lightllm_keys(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)
    client = TestClient(server.app)
    r = client.get("/api/admin/smart-ziw-config")
    assert r.status_code == 200
    data = r.json()
    assert data["gitlab_token"] == ""
    assert data["lightllm_api_key"] == ""
    assert data["lightllm_subscription_key"] == ""


def test_admin_update_preserves_empty_tokens(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={
        "gitlab_token": "",
        "lightllm_api_key": "",
        "lightllm_subscription_key": "",
    })
    assert r.status_code == 200
    assert saved["gitlab_token"] == "SECRET-GL-TOKEN"
    assert saved["lightllm_api_key"] == "SECRET-LL-KEY"
    assert saved["lightllm_subscription_key"] == "SECRET-SUB-KEY"
    assert r.json()["gitlab_token"] == ""
    assert r.json()["lightllm_api_key"] == ""
    assert r.json()["lightllm_subscription_key"] == ""


def test_admin_update_preserves_presence_list_when_empty(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"gitlab_token": "NEW-GL-TOKEN"})
    assert r.status_code == 200
    assert saved["gitlab_token"] == "NEW-GL-TOKEN"
    assert saved["forvis_mazars_presence_countries"] == ["tunisia", "france"]


def test_admin_update_stores_new_lightllm_key(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"lightllm_api_key": "NEW-LL-KEY"})
    assert r.status_code == 200
    assert saved["lightllm_api_key"] == "NEW-LL-KEY"


def test_admin_update_stores_subscription_key(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"lightllm_subscription_key": "NEW-SUB-KEY"})
    assert r.status_code == 200
    assert saved["lightllm_subscription_key"] == "NEW-SUB-KEY"
    assert r.json()["lightllm_subscription_key"] == ""


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
        "research_verdict": "GO-CONDITIONAL",
        "documents": ["dce.pdf"],
        "research_timed_out": False,
    }
    body = server._format_smart_ziw_comment(result)
    assert "12 queries" in body
    assert "9 pages scraped" in body
    assert "3 documents captured" in body
    assert "Recommendation: GO-CONDITIONAL" in body
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
        "research_verdict": "GO-CONDITIONAL",
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
                        lambda provider, base_url, api_key, subscription_key: {"status": "ok", "models": [{"id": "m1", "name": "Model One"}]})
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"provider": "openai_compatible", "base_url": "http://localhost:8000/v1"})
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "models": [{"id": "m1", "name": "Model One"}]}


def test_llm_models_preset_endpoint_routes_to_preset_discovery(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())

    def fake_discover(preset_id, base_url, api_key, subscription_key):
        return {"status": "ok", "models": [{"id": preset_id, "name": "Preset Model"}]}

    monkeypatch.setattr(server, "discover_models_for_preset", fake_discover)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"preset_id": "groq", "base_url": "", "api_key": "k"})
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "models": [{"id": "groq", "name": "Preset Model"}]}


def test_llm_models_preset_endpoint_forwards_user_url_and_key(monkeypatch):
    captured = {}

    def fake_discover(preset_id, base_url, api_key, subscription_key):
        captured.update({"preset_id": preset_id, "base_url": base_url, "api_key": api_key, "subscription_key": subscription_key})
        return {"status": "unsupported", "models": []}

    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "discover_models_for_preset", fake_discover)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"preset_id": "openai", "base_url": "https://proxy.example/v1", "api_key": "TYPED-SECRET", "subscription_key": "TYPED-SUB"})
    assert r.status_code == 200
    assert captured["preset_id"] == "openai"
    assert captured["base_url"] == "https://proxy.example/v1"
    assert captured["api_key"] == "TYPED-SECRET"
    assert captured["subscription_key"] == "TYPED-SUB"
    assert "TYPED-SECRET" not in r.text
    assert "TYPED-SUB" not in r.text


def test_llm_providers_endpoint_returns_presets(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    client = TestClient(server.app)
    r = client.get("/api/admin/llm-providers")
    assert r.status_code == 200
    data = r.json()
    ids = {p["id"] for p in data}
    assert "openai" in ids
    assert "anthropic" in ids
    assert "groq" in ids
    assert "local" in ids
    assert "custom" in ids


def test_llm_providers_endpoint_forbidden_for_non_admin(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user())
    client = TestClient(server.app)
    r = client.get("/api/admin/llm-providers")
    assert r.status_code == 403


def test_llm_models_endpoint_forwards_typed_key_and_never_returns_it(monkeypatch):
    captured = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())

    def fake_discover(provider, base_url, api_key, subscription_key):
        captured["provider"] = provider
        captured["base_url"] = base_url
        captured["api_key"] = api_key
        captured["subscription_key"] = subscription_key
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
    assert captured["subscription_key"] == ""
    assert "TYPED-SECRET" not in r.text


def test_llm_models_endpoint_passes_blank_key_through(monkeypatch):
    captured = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())

    def fake_discover(provider, base_url, api_key, subscription_key):
        captured["api_key"] = api_key
        captured["subscription_key"] = subscription_key
        return {"status": "unsupported", "models": []}

    monkeypatch.setattr(server, "discover_lightllm_models", fake_discover)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"provider": "custom", "base_url": ""})
    assert r.status_code == 200
    assert captured["api_key"] == ""
    assert captured["subscription_key"] == ""


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
    r = client.put("/api/admin/smart-ziw-config", json={"gitlab_token": ""})
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


class _FakeSkill:
    def __init__(self, skill_id, built_in=True, enabled=True):
        self.id = skill_id
        self.name = skill_id.replace("_", " ").title()
        self.description = f"Description for {skill_id}"
        self.parameters = {"type": "object", "properties": {}}
        self.source_url = "" if built_in else "http://example.com/skill.py"
        self.built_in = built_in
        self.enabled = enabled
        self.handler = lambda **kwargs: {"ok": True}


class _FakeRegistry:
    def __init__(self, skills):
        self._skills = skills

    def by_id(self, skill_id):
        for skill in self._skills:
            if skill.id == skill_id:
                return skill
        return None


class _FakeDB:
    pass


def test_admin_list_skills_requires_admin(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user_no_admin())
    client = TestClient(server.app)
    r = client.get("/api/admin/smart-ziw-skills")
    assert r.status_code == 403


def test_admin_list_skills_returns_serialized_skills(monkeypatch):
    skills = [_FakeSkill("builtin_a"), _FakeSkill("custom_a", built_in=False)]
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)
    monkeypatch.setattr(server.smart_ziw_skill_store, "get_registry", lambda config: _FakeRegistry(skills))
    client = TestClient(server.app)
    r = client.get("/api/admin/smart-ziw-skills")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert data[0]["id"] == "builtin_a"
    assert data[0]["built_in"] is True
    assert data[1]["id"] == "custom_a"
    assert data[1]["built_in"] is False
    assert "handler" not in data[0]


def test_admin_update_skills_persists_state(monkeypatch):
    saved = []
    skills = [_FakeSkill("builtin_a", enabled=True), _FakeSkill("custom_a", built_in=False, enabled=True)]

    def fake_save(db, states):
        saved.extend(states)
        for state in states:
            for skill in skills:
                if skill.id == state["id"]:
                    skill.enabled = state["enabled"]
        return {"updated": len(states)}

    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)
    monkeypatch.setattr(server, "get_db", lambda: _FakeDB())
    monkeypatch.setattr(server.smart_ziw_skill_store, "get_registry", lambda config: _FakeRegistry(skills))
    monkeypatch.setattr(server.smart_ziw_skill_store, "save_skills_state", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-skills", json={"skills": [{"id": "builtin_a", "enabled": False}]})
    assert r.status_code == 200
    assert saved == [{"id": "builtin_a", "enabled": False}]
    assert r.json()[0]["enabled"] is False


def test_admin_fetch_skill_saves_and_returns_skills(monkeypatch):
    fetched = [_FakeSkill("fetched_custom", built_in=False, enabled=True)]
    all_skills = [_FakeSkill("builtin_a"), _FakeSkill("fetched_custom", built_in=False, enabled=True)]
    saved = []
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)
    monkeypatch.setattr(server, "get_db", lambda: _FakeDB())
    monkeypatch.setattr(server.smart_ziw_skill_store, "fetch_skill_from_url", lambda url, config=None: fetched)
    monkeypatch.setattr(server.smart_ziw_skill_store, "save_skills_state", lambda db, states: saved.extend(states) or {"updated": len(states)})
    monkeypatch.setattr(server.smart_ziw_skill_store, "get_registry", lambda config: _FakeRegistry(all_skills))
    client = TestClient(server.app)
    r = client.post("/api/admin/smart-ziw-skills/fetch", json={"url": "http://example.com/skill.py"})
    assert r.status_code == 200
    ids = {item["id"] for item in r.json()}
    assert "fetched_custom" in ids
    assert len(saved) == 1
    assert saved[0]["id"] == "fetched_custom"


def test_admin_delete_skill_forbidden_for_builtin(monkeypatch):
    skills = [_FakeSkill("builtin_a")]
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)
    monkeypatch.setattr(server.smart_ziw_skill_store, "get_registry", lambda config: _FakeRegistry(skills))
    client = TestClient(server.app)
    r = client.delete("/api/admin/smart-ziw-skills/builtin_a")
    assert r.status_code == 403


def test_admin_delete_skill_removes_custom(monkeypatch):
    skills = [_FakeSkill("custom_a", built_in=False)]
    deleted = []
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)
    monkeypatch.setattr(server.smart_ziw_skill_store, "get_registry", lambda config: _FakeRegistry(skills))
    monkeypatch.setattr(server.smart_ziw_skill_store, "delete_custom_skill", lambda skill_id: deleted.append(skill_id) or True)
    client = TestClient(server.app)
    r = client.delete("/api/admin/smart-ziw-skills/custom_a")
    assert r.status_code == 200
    assert deleted == ["custom_a"]


def test_admin_delete_skill_returns_404_when_missing(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)
    monkeypatch.setattr(server.smart_ziw_skill_store, "get_registry", lambda config: _FakeRegistry([]))
    client = TestClient(server.app)
    r = client.delete("/api/admin/smart-ziw-skills/missing")
    assert r.status_code == 404
