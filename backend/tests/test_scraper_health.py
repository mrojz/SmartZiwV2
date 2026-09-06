import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

import server as server


REGISTRY = {
    "a": {"label": "Alpha"},
    "b": {"label": "Beta"},
    "c": {"label": "Gamma"},
}


def _log(at, scrapers, success=True, trigger="manual"):
    return {
        "started_at": at,
        "success": success,
        "trigger": trigger,
        "summary": {"scrapers": scrapers},
    }


def _block(label, count=0, error=None, duration=1.0):
    return {"label": label, "count": count, "error": error, "duration": duration}


def test_health_empty_logs_marks_everything_never():
    health = server._compute_scraper_health([], REGISTRY)
    assert [h["key"] for h in health] == ["a", "b", "c"]  # sorted by label
    assert all(h["status"] == "never" for h in health)
    assert all(h["recent"] == [] for h in health)


def test_health_computes_status_failures_and_trend():
    logs = [
        _log("2026-09-06T08:00:00", {
            "a": _block("Alpha", count=5),
            "b": _block("Beta", error="boom"),
        }),
        _log("2026-09-05T08:00:00", {
            "a": _block("Alpha", count=0),
            "b": _block("Beta", count=2),
            "c": _block("Gamma", count=1),
        }),
        _log("2026-09-04T08:00:00", {
            "a": _block("Alpha", count=3),
            "b": _block("Beta", count=1),
        }),
    ]
    health = {h["key"]: h for h in server._compute_scraper_health(logs, REGISTRY)}

    alpha = health["a"]
    assert alpha["status"] == "ok"
    assert alpha["last_count"] == 5
    assert alpha["last_run_at"] == "2026-09-06T08:00:00"
    assert alpha["consecutive_failures"] == 0
    assert alpha["last_success_at"] == "2026-09-06T08:00:00"
    assert alpha["zero_runs"] == 1
    assert [r["status"] for r in alpha["recent"]] == ["ok", "ok", "ok"]

    beta = health["b"]
    assert beta["status"] == "error"
    assert beta["error"] == "boom"
    assert beta["consecutive_failures"] == 1
    assert beta["last_success_at"] == "2026-09-05T08:00:00"
    assert [r["status"] for r in beta["recent"]] == ["ok", "ok", "error"]

    gamma = health["c"]
    assert gamma["status"] == "ok"
    assert gamma["last_run_at"] == "2026-09-05T08:00:00"
    assert [r["status"] for r in gamma["recent"]] == ["miss", "ok", "miss"]


def test_health_counts_consecutive_failures_and_zero_runs():
    logs = [
        _log("2026-09-06T08:00:00", {"a": _block("Alpha", error="x"), "b": _block("Beta", count=0)}),
        _log("2026-09-05T08:00:00", {"a": _block("Alpha", error="y"), "b": _block("Beta", count=0)}),
        _log("2026-09-04T08:00:00", {"a": _block("Alpha", count=1), "b": _block("Beta", count=0)}),
    ]
    health = {h["key"]: h for h in server._compute_scraper_health(logs, REGISTRY)}
    assert health["a"]["consecutive_failures"] == 2
    assert health["a"]["last_success_at"] == "2026-09-04T08:00:00"
    # zero_runs counts only error-free runs with 0 tenders
    assert health["b"]["zero_runs"] == 3
    assert health["b"]["status"] == "ok"


def test_health_includes_scrapers_only_seen_in_logs():
    logs = [_log("2026-09-06T08:00:00", {"ghost": _block("Ghost Source", count=7)})]
    health = {h["key"]: h for h in server._compute_scraper_health(logs, REGISTRY)}
    assert health["ghost"]["label"] == "Ghost Source"
    assert health["ghost"]["last_count"] == 7


def _mk_admin():
    return {
        "id": "a1", "email": "admin@example.com", "name": "Admin", "role": "admin",
        "passwordHash": "x", "avatarUrl": "", "mustChangePassword": False, "isActive": True,
    }


def test_scraper_health_endpoint_requires_admin(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: {**_mk_admin(), "role": "viewer"})
    client = TestClient(server.app)
    r = client.get("/api/admin/scraper-health")
    assert r.status_code == 403


def test_scraper_health_endpoint_returns_health(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_sync_logs", lambda limit=10: [
        _log("2026-09-06T08:00:00", {"iadb": _block("IADB", count=4)}, trigger="scheduled"),
    ])
    client = TestClient(server.app)
    r = client.get("/api/admin/scraper-health")
    assert r.status_code == 200
    data = r.json()
    assert data["last_sync"]["trigger"] == "scheduled"
    assert data["last_sync"]["success"] is True
    by_key = {s["key"]: s for s in data["scrapers"]}
    # Registry (14 scrapers) plus anything observed in logs
    assert len(data["scrapers"]) >= 14
    assert by_key["iadb"]["status"] == "ok"
    assert by_key["iadb"]["last_count"] == 4
