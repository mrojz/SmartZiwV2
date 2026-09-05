import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

import pytest

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


def test_admin_update_llm_status_uses_unredacted_key(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    config = {**_config_with_secrets(), "smart_ziw_llm_provider": "openai"}
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: config)
    monkeypatch.setattr(server, "save_smart_ziw_config", lambda c: dict(c))
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"smart_ziw_llm_provider": "openai", "lightllm_api_key": ""})
    assert r.status_code == 200
    status = r.json()["llm_status"]
    # llm_status must be computed before the response key is blanked; the
    # preserved stored key means the preset provider is configured.
    assert status["provider"] == "openai"
    assert status["configured"] is True
    assert status["missing_fields"] == []


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


def test_run_smart_ziw_saves_structured_fields(monkeypatch):
    project = {"db_id": "p1", "project_id": "id1", "project_name": "n1"}
    updates = []

    def fake_update(db_id, u):
        updates.append(u)
        return {**project, **u}

    def fake_run(*args, **kwargs):
        return {
            "folder": "f",
            "files": ["recap.md"],
            "repo_path": "/r",
            "gitlab_pushed": False,
            "gitlab_message": "disabled",
            "research": True,
            "research_verdict": "GO",
            "research_stats": {"queries_run": 5, "pages_scraped": 3},
            "recap_markdown": "# Tender Recap",
            "references": [{"number": 1, "title": "Source", "url_or_path": "https://example.com"}],
        }

    monkeypatch.setattr(server, "update_project_smart_ziw_state_by_db_id", fake_update)
    monkeypatch.setattr(server, "run_smart_ziw_agent", fake_run)
    monkeypatch.setattr(server, "list_comments", lambda *args: [])
    monkeypatch.setattr(server, "_create_project_comment_and_notify", lambda **kwargs: None)
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)
    server._run_smart_ziw("p1", {"id": "u1", "name": "Admin"})
    completed_update = [u for u in updates if u.get("smart_ziw_status") == "completed"][0]
    assert completed_update["smart_ziw_research_verdict"] == "GO"
    assert completed_update["smart_ziw_analysis_markdown"] == "# Tender Recap"
    assert completed_update["smart_ziw_next_actions"] == []
    assert completed_update["smart_ziw_ai_source"] == "Web research"
    assert completed_update["smart_ziw_confidence"] == "high"


_PROJECT = {
    "db_id": "p1",
    "project_id": "id1",
    "project_name": "Tender One",
}


def _mk_smart_ziw_bot_comment(**kwargs):
    return {
        "id": kwargs.get("id", "c1"),
        "entityType": "project",
        "entityId": "id1",
        "authorUserId": "bot:smart-ziw",
        "authorName": "Smart-Ziw Bot",
        "authorAvatarUrl": "",
        "body": kwargs.get("body", ""),
        "attachments": kwargs.get("attachments", []),
        "mentions": [],
        "createdAt": "2026-08-28T00:00:00Z",
        "updatedAt": "2026-08-28T00:00:00Z",
    }


@pytest.mark.asyncio
async def test_post_smart_ziw_comment_returns_comment_id(monkeypatch):
    seen = {}

    def fake_create(**kwargs):
        seen.update(kwargs)
        return _mk_smart_ziw_bot_comment()

    monkeypatch.setattr(server, "get_project_by_db_id", lambda db_id: dict(_PROJECT))
    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    result = await server.post_smart_ziw_comment(
        tender_id="p1", content="# Recap", source_url="",
        downloaded_files=[], failed_files=[], user={"id": "u1"},
    )
    assert result["status"] == "ok"
    assert result["comment_id"] == "c1"
    assert result["comment"]["id"] == "c1"
    assert seen["entity_id"] == "id1"
    assert seen["author_user"] is server.SMART_ZIW_BOT_USER
    assert seen["body_text"] == "# Recap"
    assert seen["attachments"] == []


@pytest.mark.asyncio
async def test_post_smart_ziw_comment_renders_failed_files_as_links(monkeypatch):
    seen = {}

    def fake_create(**kwargs):
        seen.update(kwargs)
        return _mk_smart_ziw_bot_comment()

    monkeypatch.setattr(server, "get_project_by_db_id", lambda db_id: dict(_PROJECT))
    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    result = await server.post_smart_ziw_comment(
        tender_id="p1", content="Recap body", source_url="https://tender.example",
        downloaded_files=[], failed_files=["https://tender.example/a.pdf", "https://tender.example/b.pdf"],
        user={"id": "u1"},
    )
    assert result["status"] == "ok"
    body = seen["body_text"]
    assert "## Files we could not retrieve" in body
    assert "- [https://tender.example/a.pdf](https://tender.example/a.pdf)" in body
    assert "- [https://tender.example/b.pdf](https://tender.example/b.pdf)" in body


@pytest.mark.asyncio
async def test_post_smart_ziw_comment_uploads_downloaded_files(monkeypatch):
    seen = {}

    def fake_create(**kwargs):
        seen.update(kwargs)
        return _mk_smart_ziw_bot_comment(attachments=kwargs.get("attachments", []))

    def fake_upload(path):
        return {"fileId": "f1", "originalName": path.name, "size": 1, "mimeType": "text/plain", "url": f"/api/uploads/f1/{path.name}"}

    monkeypatch.setattr(server, "get_project_by_db_id", lambda db_id: dict(_PROJECT))
    monkeypatch.setattr(server, "_upload_local_file_to_comment_store", fake_upload)
    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    result = await server.post_smart_ziw_comment(
        tender_id="p1", content="Recap body", source_url="",
        downloaded_files=["/tmp/report.pdf"], failed_files=[], user={"id": "u1"},
    )
    assert result["status"] == "ok"
    assert seen["attachments"] == [{"fileId": "f1", "originalName": "report.pdf", "size": 1, "mimeType": "text/plain", "url": "/api/uploads/f1/report.pdf"}]
    assert "[report.pdf](/api/uploads/f1/report.pdf)" in seen["body_text"]


@pytest.mark.asyncio
async def test_post_smart_ziw_comment_blank_content_uses_fallback(monkeypatch):
    seen = {}

    def fake_create(**kwargs):
        seen.update(kwargs)
        return _mk_smart_ziw_bot_comment()

    monkeypatch.setattr(server, "get_project_by_db_id", lambda db_id: dict(_PROJECT))
    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    result = await server.post_smart_ziw_comment(
        tender_id="p1", content="   ", source_url="",
        downloaded_files=[], failed_files=[], user={"id": "u1"},
    )
    assert result["status"] == "ok"
    assert seen["body_text"] == "Smart-Ziw Agent finished, but no recap was generated."


@pytest.mark.asyncio
async def test_post_smart_ziw_comment_tender_not_found(monkeypatch):
    monkeypatch.setattr(server, "get_project_by_db_id", lambda db_id: None)
    result = await server.post_smart_ziw_comment(
        tender_id="missing", content="Recap body", source_url="",
        downloaded_files=[], failed_files=[], user={"id": "u1"},
    )
    assert result == {"status": "error", "error": "Tender not found"}


@pytest.mark.asyncio
async def test_post_smart_ziw_comment_swallows_posting_exception(monkeypatch):
    monkeypatch.setattr(server, "get_project_by_db_id", lambda db_id: dict(_PROJECT))

    def fake_create(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    result = await server.post_smart_ziw_comment(
        tender_id="p1", content="Recap body", source_url="",
        downloaded_files=[], failed_files=[], user={"id": "u1"},
    )
    assert result["status"] == "error"
    assert result["error"] == "boom"


def test_make_post_comment_handler_forwards_args(monkeypatch):
    import asyncio

    captured = {}

    async def fake_post(**kwargs):
        captured.update(kwargs)
        return {"status": "ok", "comment_id": "c1"}

    monkeypatch.setattr(server, "post_smart_ziw_comment", fake_post)
    handler = server.make_post_comment_handler({"id": "u1"})
    result = asyncio.run(handler({
        "tender_id": "p1", "content": "Recap", "source_url": "https://x.example",
    }))
    assert result["status"] == "ok"
    assert captured["tender_id"] == "p1"
    assert captured["content"] == "Recap"
    assert captured["source_url"] == "https://x.example"
    assert captured["downloaded_files"] == []
    assert captured["failed_files"] == []
    assert captured["user"] == {"id": "u1"}


# ---------- Auto-analyze after sync ----------

_AUTO_CFG = {
    "auto_analyze_enabled": True,
    "auto_analyze_sources": [],
    "auto_analyze_countries": [],
    "auto_analyze_max_per_run": 10,
}


def _auto_project(**over):
    project = {
        "db_id": "d1",
        "smart_ziw_status": "",
        "ai_verified": "Yes",
        "source": "NigerMarchés",
        "country": "Senegal",
        "effective_deadline": "2026-10-01",
    }
    project.update(over)
    return project


def test_auto_analyze_filter_disabled_returns_empty():
    assert server._auto_analyze_filter([_auto_project()], {**_AUTO_CFG, "auto_analyze_enabled": False}) == []


def test_auto_analyze_filter_skips_non_yes_verification_and_started_tenders():
    projects = [
        _auto_project(db_id="done", smart_ziw_status="completed"),
        _auto_project(db_id="err", smart_ziw_status="error"),
        _auto_project(db_id="running", smart_ziw_status="running"),
        _auto_project(db_id="no", ai_verified="No"),
        _auto_project(db_id="pending", ai_verified=""),
        _auto_project(db_id="ok"),
    ]
    out = server._auto_analyze_filter(projects, _AUTO_CFG)
    assert [p["db_id"] for p in out] == ["ok"]


def test_auto_analyze_filter_orders_by_deadline_and_caps():
    projects = [
        _auto_project(db_id="late", effective_deadline="2026-12-01"),
        _auto_project(db_id="soon", effective_deadline="2026-09-15"),
        _auto_project(db_id="none", effective_deadline=None, manual_deadline=None,
                      scraped_deadline=None, project_end_date=None),  # no deadline sorts last
        _auto_project(db_id="mid", effective_deadline="", project_end_date="2026-10-01"),
    ]
    out = server._auto_analyze_filter(projects, {**_AUTO_CFG, "auto_analyze_max_per_run": 2})
    assert [p["db_id"] for p in out] == ["soon", "mid"]


def test_auto_analyze_filter_source_and_country_allowlists():
    projects = [
        _auto_project(db_id="x", source="NigerMarchés", country="Niger"),
        _auto_project(db_id="y", source="dgmarket", country="Niger"),
        _auto_project(db_id="z", source="NigerMarchés", country="Senegal"),
    ]
    out = server._auto_analyze_filter(
        projects,
        {**_AUTO_CFG, "auto_analyze_sources": ["nigermarchés"], "auto_analyze_countries": ["NIGER"]},
    )
    assert [p["db_id"] for p in out] == ["x"]


def test_auto_analyze_filter_empty_lists_mean_all():
    projects = [_auto_project(db_id="a", source="anything", country="Nowhere")]
    assert [p["db_id"] for p in server._auto_analyze_filter(projects, _AUTO_CFG)] == ["a"]


def test_auto_analyze_filter_matches_any_part_of_merged_source():
    projects = [_auto_project(db_id="merged", source="DGCL, UNGM", country="Niger")]
    assert [p["db_id"] for p in server._auto_analyze_filter(projects, {**_AUTO_CFG, "auto_analyze_sources": ["ungm"]})] == ["merged"]
    assert server._auto_analyze_filter(projects, {**_AUTO_CFG, "auto_analyze_sources": ["world bank"]}) == []


def test_auto_analyze_filter_non_positive_cap_returns_empty():
    assert server._auto_analyze_filter([_auto_project()], {**_AUTO_CFG, "auto_analyze_max_per_run": 0}) == []


def test_maybe_auto_analyze_enqueues_and_skips_running(monkeypatch):
    captured = []

    class _FakeThread:
        def __init__(self, target=None, args=(), daemon=None):
            captured.append((target, args))

        def start(self):
            pass

    monkeypatch.setattr("threading.Thread", _FakeThread)
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {**_AUTO_CFG, "smart_ziw_enabled": True})
    monkeypatch.setattr(server, "get_all_projects", lambda: [_auto_project(db_id="d1")])
    try:
        assert server._maybe_auto_analyze() == 1
        assert captured == [(server._run_smart_ziw, ("d1", server.SMART_ZIW_BOT_USER))]
        assert server._maybe_auto_analyze() == 0  # already running → skipped
    finally:
        server._smart_ziw_running.discard("d1")


def test_maybe_auto_analyze_disabled_globally_starts_nothing(monkeypatch):
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {**_AUTO_CFG, "smart_ziw_enabled": False})
    monkeypatch.setattr(server, "get_all_projects", lambda: [_auto_project()])
    assert server._maybe_auto_analyze() == 0
