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

from smart_ziw_skills.base import Skill

_MCP_SERVERS_DOC = {"_type": "smart_ziw_mcp_servers"}

# Only remote transports are supported (no local processes in the container).
SUPPORTED_TRANSPORTS = ("sse", "http")


def load_mcp_servers() -> list[dict]:
    """Load the list of configured MCP servers from the config document."""
    from database import get_db

    db = get_db()
    doc = db.config.find_one(_MCP_SERVERS_DOC) or {}
    servers = doc.get("servers") or []
    return [s for s in servers if isinstance(s, dict)]


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
            "inputSchema": data.get("inputSchema") or {"type": "object", "properties": {}},
        })
    return out


async def test_mcp_server(config: dict) -> dict:
    """Connect to an SSE MCP server, initialize a session, and discover tools.

    Returns a dict with ``status`` ("ok" or "error"), ``tools``, and ``detail``.
    """
    transport = config.get("transport") or "sse"
    timeout = int(config.get("timeout") or 30)

    try:
        if transport not in SUPPORTED_TRANSPORTS:
            return {
                "status": "error",
                "tools": [],
                "detail": f"Unsupported transport {transport!r}; expected 'sse'",
            }
        url = config.get("url") or ""
        client_cm = sse_client(url, timeout=timeout, headers=_server_headers(config))

        tools: list[dict] = []
        async with asyncio.timeout(timeout):
            async with client_cm as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.list_tools()
                    tools = _serialize_tools(result.tools)

        return {
            "status": "ok",
            "tools": tools,
            "detail": f"Discovered {len(tools)} tool(s)",
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "tools": [], "detail": str(exc)}


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
    client_cm = sse_client(server.get("url") or "", timeout=timeout, headers=_server_headers(server))

    async with asyncio.timeout(timeout):
        async with client_cm as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
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
        return {"error": str(exc)}
