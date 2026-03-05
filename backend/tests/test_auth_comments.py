import os
from fastapi.testclient import TestClient

import backend.server as server


def _mk_user(role="user", must_change=False):
    return {
        "id": "u1",
        "email": "u@example.com",
        "name": "User",
        "role": role,
        "passwordHash": "x",
        "avatarUrl": "",
        "mustChangePassword": must_change,
        "isActive": True,
    }


def test_admin_bootstrap_creation(monkeypatch):
    created = {}
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "Secret123!")
    monkeypatch.setenv("ADMIN_NAME", "Root")
    monkeypatch.setattr(server, "count_admin_users", lambda: 0)
    monkeypatch.setattr(server, "create_user_doc", lambda doc: created.setdefault("doc", doc))
    server._bootstrap_admin_if_needed()
    assert created["doc"]["email"] == "admin@example.com"
    assert created["doc"]["role"] == "admin"
    assert created["doc"]["mustChangePassword"] is True


def test_cannot_access_admin_without_admin_role(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: (_mk_user(role="user"), {"csrfToken": "t"}))
    client = TestClient(server.app)
    r = client.get("/api/admin/users")
    assert r.status_code == 403


def test_must_change_password_enforced(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: (_mk_user(must_change=True), {"csrfToken": "t"}))
    client = TestClient(server.app)
    r = client.get("/api/projects")
    assert r.status_code == 403
    assert r.json()["detail"] == "must_change_password"


def test_create_and_list_comments_for_entity(monkeypatch):
    store = []

    def fake_create(c):
        store.append(c)
        return c

    def fake_list(entity_type, entity_id):
        return [c for c in store if c["entityType"] == entity_type and c["entityId"] == entity_id]

    monkeypatch.setattr(server, "_get_request_user", lambda req: (_mk_user(role="user"), {"csrfToken": "t"}))
    monkeypatch.setattr(server, "create_comment", fake_create)
    monkeypatch.setattr(server, "list_comments", fake_list)
    monkeypatch.setattr(server, "list_users", lambda q="": [_mk_user(role="user")])

    client = TestClient(server.app)
    res = client.post(
        "/api/comments",
        json={"entityType": "project", "entityId": "p1", "body": "hello"},
        headers={"X-CSRF-Token": "t"},
    )
    assert res.status_code == 200

    res = client.get("/api/comments?entityType=project&entityId=p1")
    assert res.status_code == 200
    payload = res.json()
    assert len(payload) == 1
    assert payload[0]["body"] == "hello"
