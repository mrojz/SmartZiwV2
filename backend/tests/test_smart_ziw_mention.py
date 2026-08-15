import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

import server as server


def _mk_requester():
    return {"id": "u1", "name": "User One", "email": "u1@example.com"}


def _mk_project():
    return {
        "db_id": "p1",
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_description": "Audit and pentesting.",
        "project_url": "https://example.com/tender",
        "smart_ziw_status": "completed",
        "smart_ziw_folder": "2026-07-13-IS-Security-Audit",
    }


def _mk_comment(body="@SmartZiw what is the deadline?", comment_id="c1"):
    return {"id": comment_id, "entityType": "project", "entityId": "e1", "body": body, "authorName": "User One"}


def _no_thread(*args, **kwargs):
    raise AssertionError("no thread should be spawned")


def test_chat_prompt_strips_mention_token_and_includes_project_fields():
    prompt = server._build_smart_ziw_chat_prompt(_mk_project(), _mk_comment(), [])
    assert "@SmartZiw" not in prompt
    assert "what is the deadline?" in prompt
    assert "Project name: IS Security Audit" in prompt
    assert "Smart-Ziw status: completed" in prompt


def test_chat_prompt_includes_last_10_comments_excluding_trigger():
    trigger = _mk_comment("@SmartZiw tell me more", comment_id="c11")
    thread = [{"id": f"c{i}", "body": f"prior note {i}", "authorName": f"user{i}"} for i in range(10)]
    thread.extend([trigger, {"id": "c12", "body": "", "authorName": "empty"}])
    prompt = server._build_smart_ziw_chat_prompt(_mk_project(), trigger, thread)
    assert "prior note 1" in prompt
    assert "prior note 9" in prompt
    assert "prior note 0" not in prompt
    assert "empty" not in prompt
    assert "@SmartZiw" not in prompt


def test_hook_spawns_worker_for_tagged_project_comment(monkeypatch):
    monkeypatch.setattr(server, "_smart_ziw_running", set())
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {"smart_ziw_enabled": True})
    spawned = {}

    class _FakeThread:
        def __init__(self, target, args, daemon):
            spawned["target"] = target
            spawned["args"] = args
            spawned["daemon"] = daemon

        def start(self):
            pass

    monkeypatch.setattr("threading.Thread", _FakeThread)
    server._maybe_start_smart_ziw_chat(_mk_comment(), _mk_project(), _mk_requester())
    assert spawned["target"] is server._answer_smart_ziw_mention
    assert spawned["args"][0] == "p1"
    assert spawned["daemon"] is True
    assert "p1" in server._smart_ziw_running


def test_hook_ignores_untagged_non_project_and_missing_context(monkeypatch):
    monkeypatch.setattr(server, "_smart_ziw_running", set())
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {"smart_ziw_enabled": True})
    monkeypatch.setattr("threading.Thread", _no_thread)
    server._maybe_start_smart_ziw_chat(_mk_comment("just chatting"), _mk_project(), _mk_requester())
    server._maybe_start_smart_ziw_chat({**_mk_comment(), "entityType": "tender"}, _mk_project(), _mk_requester())
    server._maybe_start_smart_ziw_chat(_mk_comment(), None, _mk_requester())
    server._maybe_start_smart_ziw_chat(_mk_comment(), _mk_project(), None)
    assert server._smart_ziw_running == set()


def test_hook_posts_disabled_note_when_agent_disabled(monkeypatch):
    monkeypatch.setattr(server, "_smart_ziw_running", set())
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {"smart_ziw_enabled": False})
    posted = {}
    monkeypatch.setattr(server, "_smart_ziw_bot_note", lambda project, body_text: posted.update(body=body_text))
    monkeypatch.setattr("threading.Thread", _no_thread)
    server._maybe_start_smart_ziw_chat(_mk_comment(), _mk_project(), _mk_requester())
    assert "disabled" in posted["body"]


def test_hook_posts_busy_note_when_already_running(monkeypatch):
    monkeypatch.setattr(server, "_smart_ziw_running", {"p1"})
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {"smart_ziw_enabled": True})
    posted = {}
    monkeypatch.setattr(server, "_smart_ziw_bot_note", lambda project, body_text: posted.update(body=body_text))
    monkeypatch.setattr("threading.Thread", _no_thread)
    server._maybe_start_smart_ziw_chat(_mk_comment(), _mk_project(), _mk_requester())
    assert "already working" in posted["body"]


def test_answer_posts_bot_reply_with_requester_mention(monkeypatch):
    monkeypatch.setattr(server, "_smart_ziw_running", {"p1"})
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {"smart_ziw_enabled": True})
    monkeypatch.setattr(server, "get_llm_call", lambda config, json_mode=False: lambda system, user: "Here is the answer.")
    monkeypatch.setattr(server, "list_comments", lambda entity_type, entity_id: [])
    captured = {}

    def fake_create(*, entity_type, entity_id, project, author_user, body_text, attachments=None, mentions=None):
        captured.update(entity_type=entity_type, entity_id=entity_id, project=project,
                        author_user=author_user, body_text=body_text, mentions=mentions)
        return {}

    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    server._answer_smart_ziw_mention("p1", _mk_project(), _mk_requester(), _mk_comment())
    assert captured["author_user"] == server.SMART_ZIW_BOT_USER
    assert captured["body_text"] == "Here is the answer."
    assert captured["mentions"] == [{"userId": "u1", "name": "User One", "email": "u1@example.com"}]
    assert "p1" not in server._smart_ziw_running


def test_answer_truncates_long_replies(monkeypatch):
    monkeypatch.setattr(server, "_smart_ziw_running", {"p1"})
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {"smart_ziw_enabled": True})
    monkeypatch.setattr(server, "get_llm_call", lambda config, json_mode=False: lambda system, user: "x" * 3000)
    monkeypatch.setattr(server, "list_comments", lambda entity_type, entity_id: [])
    captured = {}

    def fake_create(*, entity_type, entity_id, project, author_user, body_text, attachments=None, mentions=None):
        captured["body_text"] = body_text
        return {}

    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    server._answer_smart_ziw_mention("p1", _mk_project(), _mk_requester(), _mk_comment())
    assert len(captured["body_text"]) == 2001
    assert captured["body_text"].endswith("…")


def test_answer_uses_fallback_text_when_llm_returns_empty(monkeypatch):
    monkeypatch.setattr(server, "_smart_ziw_running", {"p1"})
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {"smart_ziw_enabled": True})
    monkeypatch.setattr(server, "get_llm_call", lambda config, json_mode=False: lambda system, user: "")
    monkeypatch.setattr(server, "list_comments", lambda entity_type, entity_id: [])
    captured = {}

    def fake_create(*, entity_type, entity_id, project, author_user, body_text, attachments=None, mentions=None):
        captured["body_text"] = body_text
        return {}

    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    server._answer_smart_ziw_mention("p1", _mk_project(), _mk_requester(), _mk_comment())
    assert captured["body_text"] == "Smart-Ziw has no answer for this question."


def test_answer_posts_error_note_on_llm_failure(monkeypatch):
    monkeypatch.setattr(server, "_smart_ziw_running", {"p1"})
    monkeypatch.setattr(server, "get_smart_ziw_config", lambda: {"smart_ziw_enabled": True})

    def _boom(config, json_mode=False):
        raise RuntimeError("provider down")

    monkeypatch.setattr(server, "get_llm_call", _boom)
    monkeypatch.setattr(server, "list_comments", lambda entity_type, entity_id: [])
    captured = {}

    def fake_create(*, entity_type, entity_id, project, author_user, body_text, attachments=None, mentions=None):
        captured.update(author_user=author_user, body_text=body_text)
        return {}

    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    server._answer_smart_ziw_mention("p1", _mk_project(), _mk_requester(), _mk_comment())
    assert captured["body_text"].startswith("Smart-Ziw could not answer")
    assert "provider down" in captured["body_text"]
    assert captured["author_user"] == server.SMART_ZIW_BOT_USER
    assert "p1" not in server._smart_ziw_running


def test_post_comment_triggers_mention_hook(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_requester())
    monkeypatch.setattr(server, "_active_users_by_id", lambda: {})
    monkeypatch.setattr(server, "get_project_by_db_id", lambda db_id: _mk_project())
    called = {}

    def fake_create(*, entity_type, entity_id, project, author_user, body_text, attachments=None, mentions=None):
        return {"id": "c1", "entityType": entity_type, "entityId": entity_id,
                "authorUserId": author_user.get("id"), "body": body_text}

    monkeypatch.setattr(server, "_create_project_comment_and_notify", fake_create)
    monkeypatch.setattr(server, "_maybe_start_smart_ziw_chat",
                        lambda comment, project, requester: called.update(project=project, requester=requester))
    client = TestClient(server.app)
    r = client.post("/api/comments", json={
        "entityType": "project", "entityId": "e1", "projectDbId": "p1", "body": "@SmartZiw hello",
    })
    assert r.status_code == 200
    assert called["project"]["db_id"] == "p1"
    assert called["requester"]["id"] == "u1"
