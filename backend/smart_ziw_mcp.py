"""MCP server integration for Smart-Ziw.

Admins configure external MCP servers from the admin UI. Each enabled server's
tools are exposed as Smart-Ziw skills with IDs like ``mcp:{server_id}:{tool_name}``.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import re
import uuid
from typing import Any

from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client

from smart_ziw_skills.base import Skill

_MCP_SERVERS_DOC = {"_type": "smart_ziw_mcp_servers"}

# Only remote transports are supported (no local processes in the container).
SUPPORTED_TRANSPORTS = ("sse", "http")

# Built-in hosted MCP servers. Endpoints/headers verified 2026-09:
# - Brave Search: native REST integration against the LLM Context API
#   (https://api.search.brave.com/res/v1/llm/context); auth via the Brave
#   Search API subscription token header. The hosted Brave MCP endpoint
#   (api.search.brave.com/mcp) is AWS-WAF-blocked from typical datacenter
#   egress IPs, so the built-in brave_web_search tool calls this REST API
#   directly and the admin connection test probes it — no MCP discovery.
# - Firecrawl MCP: hosted at https://mcp.firecrawl.dev/v2/mcp (streamable
#   HTTP); auth via `Authorization: Bearer <FIRECRAWL_API_KEY>`.
# This tuple is the single place to correct preset url/header facts.
BUILTIN_MCP_SERVERS: tuple[dict, ...] = (
    {
        "id": "brave-search",
        "name": "Brave Search",
        "transport": "http",
        "url": "https://api.search.brave.com/res/v1/llm/context",
        "api_key_header": "X-Subscription-Token",
        "api_key_prefix": "",
    },
    {
        "id": "firecrawl",
        "name": "Firecrawl",
        "transport": "http",
        "url": "https://mcp.firecrawl.dev/v2/mcp",
        "api_key_header": "Authorization",
        "api_key_prefix": "Bearer ",
    },
)

_BUILTIN_MCP_IDS = {p["id"] for p in BUILTIN_MCP_SERVERS}


def load_mcp_servers() -> list[dict]:
    """Load the configured MCP servers, with built-in presets always present.

    Built-ins are merged on top of the stored doc: their ``url``/``transport``
    come from the preset (not user-editable) while ``enabled``, ``timeout``,
    ``tools`` and the API-key header persist in the stored entry.
    """
    from database import get_db

    db = get_db()
    doc = db.config.find_one(_MCP_SERVERS_DOC) or {}
    stored = [s for s in (doc.get("servers") or []) if isinstance(s, dict)]

    servers: list[dict] = []
    for preset in BUILTIN_MCP_SERVERS:
        entry = next((s for s in stored if s.get("id") == preset["id"]), {})
        stored_headers = entry.get("headers") or {}
        key_header = preset["api_key_header"]
        key_value = str(stored_headers.get(key_header) or "").strip()
        servers.append({
            "id": preset["id"],
            "name": preset["name"],
            "transport": preset["transport"],
            "url": preset["url"],
            "headers": {key_header: key_value} if key_value else {},
            "enabled": entry.get("enabled", True) is not False,
            "timeout": int(entry.get("timeout") or 30),
            "tools": list(entry.get("tools") or []),
            "builtin": True,
            "api_key_header": key_header,
            "api_key_prefix": preset["api_key_prefix"],
            "api_key_configured": bool(key_value),
        })

    servers.extend(s for s in stored if s.get("id") not in _BUILTIN_MCP_IDS)
    return servers


def save_mcp_servers(db, servers: list[dict]) -> None:
    """Persist the full list of MCP servers."""
    db.config.update_one(
        _MCP_SERVERS_DOC,
        {"$set": {"servers": list(servers or [])}},
        upsert=True,
    )


def _server_headers(server: dict) -> dict[str, str] | None:
    """Authentication headers sent with the SSE connection."""
    headers = server.get("headers")
    if not headers:
        return None
    return {str(key): str(value) for key, value in headers.items()}


def _strip_dollar_keys(value: Any) -> Any:
    """Recursively drop $-prefixed keys (e.g. JSON Schema's ``$schema``).

    MongoDB ≤ 4.4 forbids dollar-prefixed field names in stored documents,
    and hosted MCP servers (Firecrawl) ship tool schemas that include them.
    The keys are dialect metadata the LLM never uses.
    # ponytail: also drops $ref/$defs if a server ever uses them — none of
    # the built-in presets do; reintroduce escaping here if that changes.
    """
    if isinstance(value, dict):
        return {k: _strip_dollar_keys(v) for k, v in value.items() if not str(k).startswith("$")}
    if isinstance(value, list):
        return [_strip_dollar_keys(item) for item in value]
    return value


def _serialize_tools(tools: list[Any]) -> list[dict]:
    """Normalize a list of MCP Tool objects or dicts to plain dicts."""
    out: list[dict] = []
    for tool in tools or []:
        if hasattr(tool, "model_dump"):
            data = tool.model_dump()
        elif isinstance(tool, dict):
            data = tool
        else:
            data = {
                "name": getattr(tool, "name", None),
                "description": getattr(tool, "description", None),
                "inputSchema": getattr(tool, "inputSchema", None),
            }
        out.append({
            "name": data.get("name") or "",
            "description": data.get("description") or "",
            "inputSchema": _strip_dollar_keys(data.get("inputSchema") or {"type": "object", "properties": {}}),
        })
    return out


def _leaf_error(exc: Exception) -> str:
    """Best-effort single-line message, unwrapping ExceptionGroup noise."""
    seen = exc
    while isinstance(seen, ExceptionGroup) and seen.exceptions:
        seen = seen.exceptions[0]
    return str(seen)[:300]


def _client_for(transport: str, url: str, timeout: int, headers: dict | None):
    """Pick the MCP client matching the transport (legacy SSE vs streamable HTTP)."""
    if transport == "http":
        return streamablehttp_client(url, headers=headers, timeout=timeout)
    return sse_client(url, timeout=timeout, headers=headers)


async def test_mcp_server(config: dict) -> dict:
    """Connect to an SSE/streamable-HTTP MCP server, initialize a session, and discover tools.

    Returns a dict with ``status`` ("ok" or "error"), ``tools``, and ``detail``.
    """
    transport = config.get("transport") or "sse"
    timeout = int(config.get("timeout") or 30)

    try:
        if transport not in SUPPORTED_TRANSPORTS:
            return {
                "status": "error",
                "tools": [],
                "detail": f"Unsupported transport {transport!r}; expected one of {SUPPORTED_TRANSPORTS}",
            }
        url = config.get("url") or ""
        client_cm = _client_for(transport, url, timeout, _server_headers(config))

        tools: list[dict] = []
        async with asyncio.timeout(timeout):
            async with client_cm as streams:
                async with ClientSession(streams[0], streams[1]) as session:
                    await session.initialize()
                    result = await session.list_tools()
                    tools = _serialize_tools(result.tools)

        return {
            "status": "ok",
            "tools": tools,
            "detail": f"Discovered {len(tools)} tool(s)",
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "tools": [], "detail": _leaf_error(exc)}


def _make_mcp_handler(server_id: str, tool_name: str, parameters: dict) -> Any:
    """Return a synchronous Skill handler that calls an MCP tool."""
    def handler(**kwargs: Any) -> Any:
        # The tool loop passes both the LLM arguments and extra context keys.
        # Only forward keys declared by the tool's inputSchema.
        allowed = set()
        if isinstance(parameters, dict):
            allowed = set(parameters.get("properties", {}).keys())
        arguments = {k: v for k, v in kwargs.items() if k in allowed}
        return call_tool_sync(server_id, tool_name, arguments)

    return handler


def tools_to_skills(server_id: str, server_name: str, tools: list[dict]) -> list[Skill]:
    """Convert cached MCP tool schemas into Smart-Ziw Skill objects."""
    skills: list[Skill] = []
    for tool in tools or []:
        name = tool.get("name") or ""
        if not name:
            continue
        parameters = tool.get("inputSchema") or {"type": "object", "properties": {}}
        skills.append(Skill(
            id=f"mcp:{server_id}:{name}",
            name=f"{server_name}/{name}",
            description=tool.get("description") or "",
            parameters=parameters,
            handler=_make_mcp_handler(server_id, name, parameters),
            source_url="",
            built_in=False,
            enabled=True,
        ))
    return skills


def get_mcp_skills(config: dict | None = None) -> list[Skill]:  # noqa: ARG001
    """Load enabled MCP servers and convert their cached tools to skills."""
    skills: list[Skill] = []
    for server in load_mcp_servers():
        if not server.get("enabled"):
            continue
        tools = server.get("tools") or []
        if not tools:
            continue
        skills.extend(tools_to_skills(
            server.get("id") or "",
            server.get("name") or server.get("id") or "",
            tools,
        ))
    return skills


def _serialize_call_tool_result(result: Any) -> dict:
    """Extract a usable dict from an MCP CallToolResult."""
    content_blocks = getattr(result, "content", None) or []
    if not content_blocks:
        structured = getattr(result, "structuredContent", None)
        if structured is not None:
            return {"content": structured}
        return {"content": ""}

    texts: list[str] = []
    for block in content_blocks:
        if isinstance(block, dict):
            if block.get("type") == "text":
                texts.append(str(block.get("text", "")))
        elif getattr(block, "type", None) == "text":
            texts.append(str(getattr(block, "text", "")))

    if len(texts) == 1:
        return {"content": texts[0]}
    if texts:
        return {"content": "\n".join(texts)}

    return {"content": str(content_blocks)}


async def _call_tool_async(server_id: str, tool_name: str, arguments: dict) -> dict:
    """Resolve a server config and call an MCP tool asynchronously."""
    server = next(
        (s for s in load_mcp_servers() if s.get("id") == server_id),
        None,
    )
    if server is None:
        raise ValueError(f"MCP server {server_id!r} not found")

    transport = server.get("transport") or "sse"
    timeout = int(server.get("timeout") or 30)

    if transport not in SUPPORTED_TRANSPORTS:
        raise ValueError(f"Unsupported transport {transport!r} for server {server_id!r}")
    client_cm = _client_for(transport, server.get("url") or "", timeout, _server_headers(server))

    async with asyncio.timeout(timeout):
        async with client_cm as streams:
            async with ClientSession(streams[0], streams[1]) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments)
                return _serialize_call_tool_result(result)


def _run_sync(coro: Any) -> Any:
    """Run a coroutine synchronously, handling nested event loops."""
    try:
        return asyncio.run(coro)
    except RuntimeError as exc:
        msg = str(exc).lower()
        if "event loop is already running" in msg or "cannot be called from a running event loop" in msg:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(asyncio.run, coro).result()
        raise


def call_tool_sync(server_id: str, tool_name: str, arguments: dict) -> dict:
    """Synchronous entry point used by MCP Skill handlers."""
    try:
        return _run_sync(_call_tool_async(server_id, tool_name, arguments))
    except Exception as exc:  # noqa: BLE001
        return {"error": _leaf_error(exc)}
