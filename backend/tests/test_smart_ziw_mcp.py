import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

import smart_ziw_mcp
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


class _FakeConfigCollection:
    def __init__(self):
        self._doc = None

    def find_one(self, query):
        return self._doc

    def update_one(self, query, update, upsert=False):
        servers = update.get("$set", {}).get("servers", [])
        if self._doc is None:
            self._doc = {}
        self._doc["_type"] = query.get("_type", "smart_ziw_mcp_servers")
        self._doc["servers"] = list(servers)


class _FakeDB:
    def __init__(self):
        self.config = _FakeConfigCollection()


def test_tools_to_skills_returns_correct_ids_and_parameters():
    tools = [
        {"name": "echo", "description": "Echo input", "inputSchema": {"type": "object", "properties": {"msg": {"type": "string"}}}},
        {"name": "add", "description": "Add numbers", "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}}},
    ]
    skills = smart_ziw_mcp.tools_to_skills("srv1", "My Server", tools)
    assert len(skills) == 2
    assert skills[0].id == "mcp:srv1:echo"
    assert skills[0].name == "My Server/echo"
    assert skills[0].description == "Echo input"
    assert skills[0].parameters == tools[0]["inputSchema"]
    assert skills[0].built_in is False
    assert skills[0].enabled is True
    assert skills[1].id == "mcp:srv1:add"


def test_call_tool_sync_routes_to_async_impl(monkeypatch):
    async def fake_call(server_id, tool_name, arguments):
        return {"content": f"{server_id}:{tool_name}:{arguments}"}

    monkeypatch.setattr(smart_ziw_mcp, "_call_tool_async", fake_call)
    result = smart_ziw_mcp.call_tool_sync("srv", "echo", {"msg": "hi"})
    assert result == {"content": "srv:echo:{'msg': 'hi'}"}


def test_call_tool_sync_returns_error_on_failure(monkeypatch):
    async def fake_call(server_id, tool_name, arguments):
        raise RuntimeError("boom")

    monkeypatch.setattr(smart_ziw_mcp, "_call_tool_async", fake_call)
    result = smart_ziw_mcp.call_tool_sync("srv", "echo", {})
    assert result.get("error") == "boom"


def test_load_and_save_mcp_servers(monkeypatch):
    fake_db = _FakeDB()
    monkeypatch.setattr("database.get_db", lambda: fake_db)

    servers = smart_ziw_mcp.load_mcp_servers()
    assert [s["id"] for s in servers] == ["brave-search", "firecrawl"]
    assert all(s["builtin"] for s in servers)
    assert not any(s["api_key_configured"] for s in servers)

    smart_ziw_mcp.save_mcp_servers(fake_db, [{"id": "s1", "name": "Server 1"}])
    servers = smart_ziw_mcp.load_mcp_servers()
    assert [s["id"] for s in servers] == ["brave-search", "firecrawl", "s1"]
    assert not servers[2].get("builtin")

    # Stored API keys merge into the built-in presets.
    smart_ziw_mcp.save_mcp_servers(fake_db, [
        {"id": "s1", "name": "Server 1"},
        {"id": "brave-search", "headers": {"X-Subscription-Token": "BSA-key"}, "tools": [{"name": "t", "description": "", "inputSchema": {}}]},
    ])
    servers = smart_ziw_mcp.load_mcp_servers()
    brave = next(s for s in servers if s["id"] == "brave-search")
    assert brave["headers"] == {"X-Subscription-Token": "BSA-key"}
    assert brave["api_key_configured"] is True
    assert brave["url"] == "https://api.search.brave.com/mcp"
    assert brave["transport"] == "http"
    assert brave["tools"][0]["name"] == "t"
    firecrawl = next(s for s in servers if s["id"] == "firecrawl")
    assert firecrawl["headers"] == {}
    assert firecrawl["api_key_configured"] is False


def test_builtin_servers_use_expected_headers():
    presets = {p["id"]: p for p in smart_ziw_mcp.BUILTIN_MCP_SERVERS}
    assert presets["brave-search"]["url"] == "https://api.search.brave.com/mcp"
    assert presets["brave-search"]["api_key_header"] == "X-Subscription-Token"
    assert presets["brave-search"]["api_key_prefix"] == ""
    assert presets["firecrawl"]["url"] == "https://mcp.firecrawl.dev/v2/mcp"
    assert presets["firecrawl"]["api_key_header"] == "Authorization"
    assert presets["firecrawl"]["api_key_prefix"] == "Bearer "


def test_test_mcp_server_reports_unsupported_transport():
    result = asyncio.run(smart_ziw_mcp.test_mcp_server({"transport": "ws"}))
    assert result["status"] == "error"
    assert "Unsupported transport" in result["detail"]
    assert result["tools"] == []


def test_get_mcp_skills_skips_disabled_and_empty_servers(monkeypatch):
    fake_db = _FakeDB()
    fake_db.config._doc = {
        "_type": "smart_ziw_mcp_servers",
        "servers": [
            {"id": "enabled", "name": "Enabled", "enabled": True, "tools": [{"name": "t1", "description": "", "inputSchema": {}}]},
            {"id": "disabled", "name": "Disabled", "enabled": False, "tools": [{"name": "t2", "description": "", "inputSchema": {}}]},
            {"id": "empty", "name": "Empty", "enabled": True, "tools": []},
        ],
    }
    monkeypatch.setattr("database.get_db", lambda: fake_db)
    skills = smart_ziw_mcp.get_mcp_skills()
    assert len(skills) == 1
    assert skills[0].id == "mcp:enabled:t1"


# ---------------------------------------------------------------------------
# Server endpoint tests
# ---------------------------------------------------------------------------


def _client_with_admin(monkeypatch, fake_db=None):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    if fake_db is not None:
        monkeypatch.setattr("database.get_db", lambda: fake_db)
        monkeypatch.setattr(server, "get_db", lambda: fake_db)
    return server.app


def test_admin_list_mcp_servers_requires_admin(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user())
    from fastapi.testclient import TestClient
    client = TestClient(server.app)
    r = client.get("/api/admin/smart-ziw-mcp-servers")
    assert r.status_code == 403


def test_admin_list_mcp_servers_redacts_headers(monkeypatch):
    fake_db = _FakeDB()
    fake_db.config._doc = {
        "_type": "smart_ziw_mcp_servers",
        "servers": [{"id": "s1", "name": "S1", "headers": {"Authorization": "Bearer secret"}, "enabled": True, "tools": []}],
    }
    app = _client_with_admin(monkeypatch, fake_db)
    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.get("/api/admin/smart-ziw-mcp-servers")
    assert r.status_code == 200
    data = r.json()
    s1 = next(s for s in data if s["id"] == "s1")
    assert s1["headers"] == {"Authorization": "***"}
    # Header values on built-ins are redacted too, presence preserved.
    brave = next(s for s in data if s["id"] == "brave-search")
    assert brave["builtin"] is True
    assert brave["headers"] == {}


def test_admin_create_mcp_server_rejects_stdio(monkeypatch):
    fake_db = _FakeDB()
    app = _client_with_admin(monkeypatch, fake_db)
    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.post("/api/admin/smart-ziw-mcp-servers", json={
        "name": "Legacy",
        "transport": "stdio",
        "command": "python",
        "url": "",
    })
    assert r.status_code == 400
    assert "SSE/HTTP" in r.json()["detail"]


def test_admin_create_mcp_server_tests_and_caches_tools(monkeypatch):
    fake_db = _FakeDB()
    app = _client_with_admin(monkeypatch, fake_db)

    async def fake_test(config):
        return {
            "status": "ok",
            "tools": [{"name": "hello", "description": "Say hi", "inputSchema": {"type": "object", "properties": {}}}],
            "detail": "ok",
        }

    monkeypatch.setattr(server.smart_ziw_mcp, "test_mcp_server", fake_test)

    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.post("/api/admin/smart-ziw-mcp-servers", json={
        "name": "Test Server",
        "transport": "sse",
        "url": "https://mcp.example.com/sse",
        "headers": {"Authorization": "Bearer value"},
    })
    assert r.status_code == 200
    data = r.json()
    created = next(s for s in data["servers"] if s["id"] == "test-server")
    assert created["tools"][0]["name"] == "hello"
    assert created["headers"] == {"Authorization": "***"}
    assert data["test"]["status"] == "ok"

    # persisted unredacted
    raw = next(s for s in fake_db.config._doc["servers"] if s["id"] == "test-server")
    assert raw["headers"] == {"Authorization": "Bearer value"}
    assert raw["tools"][0]["name"] == "hello"


def test_admin_create_mcp_server_saves_and_reports_test_failure(monkeypatch):
    fake_db = _FakeDB()
    app = _client_with_admin(monkeypatch, fake_db)

    async def fake_test(config):
        return {"status": "error", "tools": [], "detail": "connection refused"}

    monkeypatch.setattr(server.smart_ziw_mcp, "test_mcp_server", fake_test)

    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.post("/api/admin/smart-ziw-mcp-servers", json={
        "name": "Bad Server",
        "transport": "sse",
        "url": "http://localhost:9999",
    })
    # The save must not be blocked by an unreachable endpoint: the config is
    # persisted and the failed test is reported for the UI to warn about.
    assert r.status_code == 200
    body = r.json()
    assert body["test"]["status"] == "error"
    assert "connection refused" in body["test"]["detail"]
    saved = next(s for s in body["servers"] if s["id"] == "bad-server")
    assert saved["tools"] == []


def test_admin_update_builtin_key_saves_even_when_hosted_mcp_unreachable(monkeypatch):
    """Regression: saving the Brave/Firecrawl API key must persist even when
    the hosted MCP endpoint is network-blocked — the built-in tools read the
    key from this stored config regardless of endpoint reachability."""
    fake_db = _FakeDB()
    app = _client_with_admin(monkeypatch, fake_db)

    async def fake_test(config):
        return {"status": "error", "tools": [], "detail": "Client error '403 Forbidden' for url 'https://api.search.brave.com/mcp'"}

    monkeypatch.setattr(server.smart_ziw_mcp, "test_mcp_server", fake_test)

    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.put("/api/admin/smart-ziw-mcp-servers/brave-search", json={
        "id": "brave-search",
        "name": "Brave Search",
        "transport": "http",
        "url": "https://api.search.brave.com/mcp",
        "headers": {"X-Subscription-Token": "BSA-real-key"},
        "enabled": True,
        "timeout": 30,
        "tools": [],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["test"]["status"] == "error"
    brave = next(s for s in body["servers"] if s["id"] == "brave-search")
    assert brave["headers"] == {"X-Subscription-Token": "***"}
    assert brave["api_key_configured"] is True
    raw = next(s for s in fake_db.config._doc["servers"] if s["id"] == "brave-search")
    assert raw["headers"] == {"X-Subscription-Token": "BSA-real-key"}


def test_admin_update_preserves_redacted_headers(monkeypatch):
    fake_db = _FakeDB()
    fake_db.config._doc = {
        "_type": "smart_ziw_mcp_servers",
        "servers": [{"id": "s1", "name": "S1", "transport": "sse", "url": "https://mcp.example.com/sse", "headers": {"Authorization": "Bearer keep-me"}, "enabled": True, "tools": []}],
    }
    app = _client_with_admin(monkeypatch, fake_db)

    async def fake_test(config):
        return {"status": "ok", "tools": [{"name": "t", "description": "", "inputSchema": {}}], "detail": "ok"}

    monkeypatch.setattr(server.smart_ziw_mcp, "test_mcp_server", fake_test)

    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.put("/api/admin/smart-ziw-mcp-servers/s1", json={
        "name": "S1 updated",
        "transport": "sse",
        "url": "https://mcp.example.com/sse",
        "headers": {"Authorization": "***"},
    })
    assert r.status_code == 200
    raw = next(s for s in fake_db.config._doc["servers"] if s["id"] == "s1")
    assert raw["name"] == "S1 updated"
    assert raw["headers"] == {"Authorization": "Bearer keep-me"}


def test_admin_update_rejects_stdio(monkeypatch):
    fake_db = _FakeDB()
    fake_db.config._doc = {
        "_type": "smart_ziw_mcp_servers",
        "servers": [{"id": "s1", "name": "S1", "transport": "sse", "url": "https://mcp.example.com/sse", "enabled": True, "tools": []}],
    }
    app = _client_with_admin(monkeypatch, fake_db)
    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.put("/api/admin/smart-ziw-mcp-servers/s1", json={
        "name": "S1",
        "transport": "stdio",
        "url": "",
    })
    assert r.status_code == 400
    assert "SSE/HTTP" in r.json()["detail"]


def test_admin_delete_mcp_server(monkeypatch):
    fake_db = _FakeDB()
    fake_db.config._doc = {
        "_type": "smart_ziw_mcp_servers",
        "servers": [{"id": "s1", "name": "S1"}, {"id": "s2", "name": "S2"}],
    }
    app = _client_with_admin(monkeypatch, fake_db)
    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.delete("/api/admin/smart-ziw-mcp-servers/s1")
    assert r.status_code == 200
    assert [s["id"] for s in r.json()] == ["brave-search", "firecrawl", "s2"]


def test_admin_delete_builtin_mcp_server_rejected(monkeypatch):
    fake_db = _FakeDB()
    app = _client_with_admin(monkeypatch, fake_db)
    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.delete("/api/admin/smart-ziw-mcp-servers/brave-search")
    assert r.status_code == 400
    assert "Built-in" in r.json()["detail"]


def test_admin_update_builtin_server_only_stores_api_key(monkeypatch):
    fake_db = _FakeDB()
    fake_db.config._doc = {
        "_type": "smart_ziw_mcp_servers",
        "servers": [{"id": "brave-search", "headers": {"X-Subscription-Token": "BSA-old"}, "tools": [{"name": "t", "description": "", "inputSchema": {}}]}],
    }
    app = _client_with_admin(monkeypatch, fake_db)
    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.put("/api/admin/smart-ziw-mcp-servers/brave-search", json={
        "id": "brave-search",
        "name": "Brave Search",
        "transport": "http",
        "url": "https://attacker.example.com/mcp",
        "headers": {"X-Subscription-Token": "BSA-new"},
        "enabled": True,
        "tools": [{"name": "t", "description": "", "inputSchema": {}}],
    })
    assert r.status_code == 200
    raw = fake_db.config._doc["servers"][0]
    # url/transport snap back to the preset; only the key is user-editable.
    assert raw["url"] == "https://api.search.brave.com/mcp"
    assert raw["transport"] == "http"
    assert raw["headers"] == {"X-Subscription-Token": "BSA-new"}
    returned = next(s for s in r.json()["servers"] if s["id"] == "brave-search")
    assert returned["headers"] == {"X-Subscription-Token": "***"}
    assert returned["api_key_configured"] is True


def test_admin_test_mcp_server_endpoint(monkeypatch):
    fake_db = _FakeDB()
    app = _client_with_admin(monkeypatch, fake_db)

    async def fake_test(config):
        return {"status": "ok", "tools": [{"name": "echo", "description": "", "inputSchema": {}}], "detail": "ok"}

    monkeypatch.setattr(server.smart_ziw_mcp, "test_mcp_server", fake_test)

    from fastapi.testclient import TestClient
    client = TestClient(app)
    r = client.post("/api/admin/smart-ziw-mcp-servers/test", json={
        "name": "Probe",
        "transport": "sse",
        "url": "https://mcp.example.com/sse",
    })
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["tools"][0]["name"] == "echo"


def test_serialize_tools_strips_dollar_prefixed_keys():
    """MongoDB 4.4 (pinned in docker-compose) rejects $-prefixed field names;
    Firecrawl ships inputSchemas containing $schema. Serialization must strip
    them at the choke point so saves never fail on storage."""
    tools = [{
        "name": "firecrawl_scrape",
        "description": "Scrape",
        "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {
                "url": {"type": "string", "$comment": "nested too"},
            },
            "required": ["url"],
        },
    }]
    out = smart_ziw_mcp._serialize_tools(tools)
    schema = out[0]["inputSchema"]
    assert "$schema" not in schema
    assert schema["type"] == "object"
    assert "$comment" not in schema["properties"]["url"]
    assert schema["required"] == ["url"]


def test_serialize_tools_handles_mcp_objects_with_dollar_schema():
    class FakeTool:
        name = "t"
        description = "d"
        inputSchema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object"}

    out = smart_ziw_mcp._serialize_tools([FakeTool()])
    assert out[0]["inputSchema"] == {"type": "object"}
