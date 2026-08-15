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


def test_admin_update_preserves_empty_tokens(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"firecrawl_api_key": "", "gitlab_token": ""})
    assert r.status_code == 200
    assert saved["firecrawl_api_key"] == "SECRET-FC-KEY"
    assert saved["gitlab_token"] == "SECRET-GL-TOKEN"
    assert r.json()["firecrawl_api_key"] == ""
    assert r.json()["gitlab_token"] == ""


def test_admin_update_stores_new_firecrawl_key(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"firecrawl_api_key": "NEW-KEY"})
    assert r.status_code == 200
    assert saved["firecrawl_api_key"] == "NEW-KEY"


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
