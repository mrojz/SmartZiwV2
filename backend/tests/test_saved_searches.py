import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

import server as server


def _mk_user(role="analyst"):
    return {
        "id": "u1", "email": "user@example.com", "name": "User", "role": role,
        "passwordHash": "x", "avatarUrl": "", "mustChangePassword": False, "isActive": True,
    }


def test_saved_searches_roundtrip_preserves_last_seen(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user())
    monkeypatch.setattr(server, "db_save_saved_searches", lambda uid, searches: searches)
    client = TestClient(server.app)
    r = client.put("/api/saved-searches", json={"searches": [
        {
            "id": "s1",
            "name": "Firewalls",
            "filters": {"freeText": "firewall"},
            "createdAt": "2026-09-01T08:00:00",
            "updatedAt": "2026-09-01T08:00:00",
            "lastSeenAt": "2026-09-05T08:00:00",
        },
    ]})
    assert r.status_code == 200
    item = r.json()["searches"][0]
    assert item["lastSeenAt"] == "2026-09-05T08:00:00"
    assert item["name"] == "Firewalls"
    assert item["filters"] == {"freeText": "firewall"}


def test_saved_searches_drops_blank_names(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user())
    monkeypatch.setattr(server, "db_save_saved_searches", lambda uid, searches: searches)
    client = TestClient(server.app)
    r = client.put("/api/saved-searches", json={"searches": [
        {"id": "s1", "name": "   ", "lastSeenAt": "2026-09-05T08:00:00"},
        {"id": "s2", "name": "Valid"},
    ]})
    assert r.status_code == 200
    assert [s["id"] for s in r.json()["searches"]] == ["s2"]
