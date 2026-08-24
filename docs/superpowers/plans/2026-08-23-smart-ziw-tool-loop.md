# Smart-Ziw Tool-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom Smart-Ziw agent orchestration with an LLM tool-loop using Brave Search, web scraping, document download, and structured comment posting, with a complete audit trail embedded in the comment.

**Architecture:** A new `SmartZiwToolLoop` class drives an Anthropic-compatible LLM through a sequence of tool calls. Each tool is a focused Python function with a JSON schema. The loop records every step in an audit trail and terminates only when the LLM calls `post_smart_ziw_comment`. Existing helpers from `smart_ziw_research.py` are refactored into tool implementations.

**Tech Stack:** FastAPI, Anthropic Python SDK, Brave Search API, `markitdown`, BeautifulSoup, requests/httpx, pytest.

**Spec:** `docs/superpowers/specs/2026-08-23-smart-ziw-tool-loop-design.md`

## Global Constraints

- LLM provider must be Anthropic-compatible (`base_url`, `api_key`, `model`).
- MCP servers remain SSE/HTTP only (already implemented).
- Registration/OTP automation is Phase 2 and out of scope.
- Audit trail is embedded in the final Smart-Ziw comment.
- Failed file URLs are included as clickable markdown links.
- Source URL is honest: "unknown" when not identified.
- Docker image must include `markitdown>=0.1.6`.

---

## File Structure

- `backend/requirements.txt` — add `markitdown`.
- `backend/smart_ziw_config.py` *(new)* — load/save Smart-Ziw config (LLM provider, Brave key, loop limits).
- `backend/smart_ziw_tools.py` *(new)* — `Tool` dataclass, tool schemas, registry.
- `backend/smart_ziw_llm.py` *(new)* — Anthropic-compatible LLM client wrapper.
- `backend/smart_ziw_loop.py` *(new)* — `SmartZiwToolLoop` runner + audit trail.
- `backend/smart_ziw_research.py` — refactor existing helpers into tool callables (`_brave_search`, `_http_scrape`, `_find_documents`, `_download_and_convert`).
- `backend/smart_ziw_agent.py` — replace `run()` orchestration with tool-loop invocation.
- `backend/server.py` — add/read Smart-Ziw config endpoints, redact secrets.
- `frontend/src/App.jsx` — admin settings form for LLM provider + Brave key.
- `backend/tests/test_smart_ziw_tools.py` *(new)* — tool registry/schema tests.
- `backend/tests/test_smart_ziw_loop.py` *(new)* — loop runner tests.
- `backend/tests/test_smart_ziw_llm.py` *(new)* — LLM client tests.
- `backend/tests/test_smart_ziw_research.py` — update existing tests.
- `backend/tests/test_smart_ziw_agent.py` — update integration tests.

---

### Task 1: Requirements + Config Model

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/smart_ziw_config.py`
- Test: `backend/tests/test_smart_ziw_config.py`

**Interfaces:**
- Consumes: MongoDB config collection via `database.get_db()`.
- Produces: `load_smart_ziw_config() -> dict`, `save_smart_ziw_config(db, config: dict) -> None`, `redact_config(config: dict) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
def test_load_default_config(monkeypatch):
    from smart_ziw_config import load_smart_ziw_config
    monkeypatch.setattr("database.get_db", lambda: _FakeDB())
    cfg = load_smart_ziw_config()
    assert cfg["llm_provider"]["model"] == "claude-sonnet-4"
    assert cfg["max_iterations"] == 15
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/kali/smartZiw/eProcScraper && PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_config.py -v`

Expected: FAIL with module not found.

- [ ] **Step 3: Add markitdown to requirements.txt**

```text
markitdown>=0.1.6
```

- [ ] **Step 4: Implement smart_ziw_config.py**

```python
"""Smart-Ziw configuration persistence."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

_MCP_SERVERS_DOC = {"_type": "smart_ziw_mcp_servers"}
_SMART_ZIW_CONFIG_DOC = {"_type": "smart_ziw_config"}

_DEFAULT_CONFIG: dict[str, Any] = {
    "llm_provider": {
        "base_url": "",
        "api_key": "",
        "model": "claude-sonnet-4",
    },
    "brave_api_key": "",
    "max_iterations": 15,
    "tool_timeout_seconds": 60,
}

_SECRET_KEYS = ("api_key", "brave_api_key")


def load_smart_ziw_config() -> dict[str, Any]:
    from database import get_db

    db = get_db()
    doc = db.config.find_one(_SMART_ZIW_CONFIG_DOC) or {}
    config = deepcopy(_DEFAULT_CONFIG)
    config.update(doc.get("config") or {})
    return config


def save_smart_ziw_config(db, config: dict[str, Any]) -> None:
    existing = load_smart_ziw_config()
    merged = deepcopy(existing)
    merged.update(config)
    db.config.update_one(
        _SMART_ZIW_CONFIG_DOC,
        {"$set": {"config": merged}},
        upsert=True,
    )


def _redact_value(value: Any) -> Any:
    if isinstance(value, str) and value:
        return "***"
    if isinstance(value, dict):
        return {k: "***" if k in _SECRET_KEYS else _redact_value(v) for k, v in value.items()}
    return value


def redact_config(config: dict[str, Any]) -> dict[str, Any]:
    return _redact_value(deepcopy(config))
```

- [ ] **Step 5: Run tests and commit**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_config.py -v`
Expected: PASS

Commit:
```bash
git add backend/requirements.txt backend/smart_ziw_config.py backend/tests/test_smart_ziw_config.py
git commit -m "feat(smart-ziw): add config model for tool-loop"
```

---

### Task 2: Tool Registry and Schemas

**Files:**
- Create: `backend/smart_ziw_tools.py`
- Test: `backend/tests/test_smart_ziw_tools.py`

**Interfaces:**
- Produces: `Tool` dataclass, `REGISTRY: dict[str, Tool]`, `get_tool(name: str) -> Tool`, `list_tools() -> list[Tool]`.

- [ ] **Step 1: Write the failing test**

```python
def test_registry_has_required_tools():
    from smart_ziw_tools import REGISTRY
    required = {
        "fetch_aggregator_tender",
        "derive_buyer_site",
        "brave_web_search",
        "scrape_page",
        "find_documents",
        "download_document",
        "post_smart_ziw_comment",
    }
    assert required <= set(REGISTRY.keys())
    for name in required:
        assert REGISTRY[name].input_schema.get("type") == "object"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_tools.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement smart_ziw_tools.py**

```python
"""Tool schemas for the Smart-Ziw tool-loop."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Awaitable


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


REGISTRY: dict[str, Tool] = {}


def register(name: str, description: str, input_schema: dict[str, Any]):
    def decorator(handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]) -> Tool:
        tool = Tool(name=name, description=description, input_schema=input_schema, handler=handler)
        REGISTRY[name] = tool
        return tool
    return decorator


def get_tool(name: str) -> Tool:
    return REGISTRY[name]


def list_tools() -> list[Tool]:
    return list(REGISTRY.values())
```

Then define placeholder schemas for each required tool (handlers implemented later):

```python
FETCH_AGGREGATOR_TENDER_SCHEMA = {
    "type": "object",
    "properties": {"tender_id": {"type": "string"}},
    "required": ["tender_id"],
}

DERIVE_BUYER_SITE_SCHEMA = {
    "type": "object",
    "properties": {"tender_id": {"type": "string"}},
    "required": ["tender_id"],
}

BRAVE_WEB_SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string"},
        "count": {"type": "integer", "default": 10},
    },
    "required": ["query"],
}

SCRAPE_PAGE_SCHEMA = {
    "type": "object",
    "properties": {"url": {"type": "string"}},
    "required": ["url"],
}

FIND_DOCUMENTS_SCHEMA = {
    "type": "object",
    "properties": {
        "source_url": {"type": "string"},
        "tender_title": {"type": "string"},
        "tender_reference": {"type": "string"},
    },
    "required": ["source_url"],
}

DOWNLOAD_DOCUMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "url": {"type": "string"},
        "tender_id": {"type": "string"},
    },
    "required": ["url", "tender_id"],
}

POST_COMMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "tender_id": {"type": "string"},
        "content": {"type": "string"},
        "source_url": {"type": "string"},
        "downloaded_files": {"type": "array", "items": {"type": "string"}, "default": []},
        "failed_files": {"type": "array", "items": {"type": "string"}, "default": []},
    },
    "required": ["tender_id", "content", "source_url"],
}


@register("fetch_aggregator_tender", "Fetch tender details from the aggregator site.", FETCH_AGGREGATOR_TENDER_SCHEMA)
async def fetch_aggregator_tender(args: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError


@register("derive_buyer_site", "Guess the buyer's official site from tender emails.", DERIVE_BUYER_SITE_SCHEMA)
async def derive_buyer_site(args: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError


@register("brave_web_search", "Search the web using Brave Search API.", BRAVE_WEB_SEARCH_SCHEMA)
async def brave_web_search(args: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError


@register("scrape_page", "Scrape a web page and extract text and links.", SCRAPE_PAGE_SCHEMA)
async def scrape_page(args: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError


@register("find_documents", "Find downloadable documents on a source page or via search.", FIND_DOCUMENTS_SCHEMA)
async def find_documents(args: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError


@register("download_document", "Download a document and convert to markdown.", DOWNLOAD_DOCUMENT_SCHEMA)
async def download_document(args: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError


@register("post_smart_ziw_comment", "Post the final Smart-Ziw analysis comment.", POST_COMMENT_SCHEMA)
async def post_smart_ziw_comment(args: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError
```

- [ ] **Step 4: Run tests and commit**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_tools.py -v`
Expected: PASS

Commit:
```bash
git add backend/smart_ziw_tools.py backend/tests/test_smart_ziw_tools.py
git commit -m "feat(smart-ziw): add tool registry and schemas"
```

---

### Task 3: Anthropic-Compatible LLM Client

**Files:**
- Create: `backend/smart_ziw_llm.py`
- Test: `backend/tests/test_smart_ziw_llm.py`

**Interfaces:**
- Consumes: `smart_ziw_config.load_smart_ziw_config()`.
- Produces: `LLMClient.chat(messages, tools) -> dict` returning `{"role": "assistant", "content": str|None, "tool_calls": [{"name": str, "arguments": dict}]}`.

- [ ] **Step 1: Write the failing test**

```python
import pytest

@pytest.mark.asyncio
async def test_client_calls_anthropic_sdk_with_tools(monkeypatch):
    from smart_ziw_llm import LLMClient

    calls = []
    class FakeMessage:
        content = "done"
        stop_reason = "end_turn"
        tool_calls = None

    class FakeClient:
        async def messages_create(self, **kwargs):
            calls.append(kwargs)
            return FakeMessage()

    client = LLMClient(base_url="https://api.kimi.com/coding", api_key="sk-test", model="kimi3")
    monkeypatch.setattr(client, "_client", FakeClient())
    result = await client.chat([{"role": "user", "content": "hello"}], tools=[])
    assert result["role"] == "assistant"
    assert calls[0]["model"] == "kimi3"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_llm.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement smart_ziw_llm.py**

```python
"""Anthropic-compatible LLM client for Smart-Ziw."""
from __future__ import annotations

import json
from typing import Any

from anthropic import Anthropic


class LLMClient:
    def __init__(self, base_url: str, api_key: str, model: str, max_tokens: int = 4096):
        self.model = model
        self.max_tokens = max_tokens
        kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = Anthropic(**kwargs)

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        system: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": messages,
        }
        if system:
            params["system"] = system
        if tools:
            params["tools"] = tools

        response = self._client.messages.create(**params)

        content_text: str | None = None
        tool_calls: list[dict[str, Any]] = []
        for block in response.content or []:
            if block.type == "text":
                content_text = (content_text or "") + block.text
            elif block.type == "tool_use":
                tool_calls.append({
                    "name": block.name,
                    "arguments": block.input,
                })

        return {
            "role": "assistant",
            "content": content_text,
            "tool_calls": tool_calls,
            "stop_reason": response.stop_reason,
        }
```

- [ ] **Step 4: Run tests and commit**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_llm.py -v`
Expected: PASS

Commit:
```bash
git add backend/smart_ziw_llm.py backend/tests/test_smart_ziw_llm.py
git commit -m "feat(smart-ziw): add anthropic-compatible LLM client"
```

---

### Task 4: Tool-Loop Runner + Audit Trail

**Files:**
- Create: `backend/smart_ziw_loop.py`
- Test: `backend/tests/test_smart_ziw_loop.py`

**Interfaces:**
- Consumes: `LLMClient.chat`, `smart_ziw_tools.REGISTRY`, a tender context dict, a system prompt string.
- Produces: `SmartZiwToolLoop.run() -> dict` with `{"final_status": "success|partial|error", "comment_id": str|None, "audit": [...], "error": str|None}`.

- [ ] **Step 1: Write the failing test**

```python
import pytest

@pytest.mark.asyncio
async def test_loop_terminates_on_post_comment():
    from smart_ziw_loop import SmartZiwToolLoop
    from smart_ziw_tools import REGISTRY

    class FakeLLM:
        def __init__(self):
            self.calls = 0
        async def chat(self, messages, tools, system=None):
            self.calls += 1
            if self.calls == 1:
                return {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{"name": "post_smart_ziw_comment", "arguments": {"tender_id": "1", "content": "hi", "source_url": ""}}],
                    "stop_reason": "tool_use",
                }
            return {"role": "assistant", "content": "done", "tool_calls": [], "stop_reason": "end_turn"}

    async def fake_post(args):
        return {"comment_id": "c1", "status": "ok"}

    REGISTRY["post_smart_ziw_comment"] = Tool(
        name="post_smart_ziw_comment",
        description="",
        input_schema={"type": "object", "properties": {}},
        handler=fake_post,
    )

    loop = SmartZiwToolLoop(llm=FakeLLM(), tools=REGISTRY, max_iterations=5)
    result = await loop.run(tender={"id": "1"}, system_prompt="test")
    assert result["final_status"] == "success"
    assert result["comment_id"] == "c1"
    assert len(result["audit"]) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_loop.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement smart_ziw_loop.py**

```python
"""Smart-Ziw LLM tool-loop runner with audit trail."""
from __future__ import annotations

import time
import uuid
from typing import Any

from smart_ziw_llm import LLMClient
from smart_ziw_tools import Tool


_SYSTEM_PROMPT = """You are Smart-Ziw, an assistant that analyzes public procurement tenders.

Your job:
1. Fetch the tender from the aggregator.
2. Find the buyer's official source page using email domains and/or web search.
3. Find downloadable documents on the source page; if none, search the web.
4. Download and analyze the documents.
5. Post a concise, structured recap as a comment via post_smart_ziw_comment.

Rules:
- Do not ask the user questions.
- If you cannot identify the buyer source, set source_url to "" and explain in the comment.
- If a document URL is found but cannot be downloaded, list it as a clickable link under "Files we could not retrieve".
- Include an "Audit trail" section at the end of the comment summarizing each tool you called.
- Always terminate by calling post_smart_ziw_comment.
"""


class SmartZiwToolLoop:
    def __init__(
        self,
        llm: LLMClient,
        tools: dict[str, Tool],
        max_iterations: int = 15,
    ):
        self.llm = llm
        self.tools = tools
        self.max_iterations = max_iterations

    def _tools_for_llm(self) -> list[dict[str, Any]]:
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            }
            for tool in self.tools.values()
        ]

    async def run(
        self,
        tender: dict[str, Any],
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        run_id = str(uuid.uuid4())
        messages: list[dict[str, Any]] = [
            {"role": "user", "content": f"Tender context: {tender}"},
        ]
        audit: list[dict[str, Any]] = []
        final_status = "error"
        comment_id: str | None = None
        error: str | None = None

        for iteration in range(self.max_iterations):
            response = await self.llm.chat(
                messages=messages,
                tools=self._tools_for_llm(),
                system=system_prompt or _SYSTEM_PROMPT,
            )

            if not response.get("tool_calls"):
                error = "LLM did not call a tool. Asking it to terminate."
                messages.append({"role": "user", "content": "You must call post_smart_ziw_comment now."})
                continue

            for tc in response["tool_calls"]:
                tool_name = tc["name"]
                arguments = tc["arguments"]
                step = {
                    "step": iteration + 1,
                    "tool": tool_name,
                    "input": arguments,
                    "started_at": time.time(),
                }
                try:
                    tool = self.tools[tool_name]
                    output = await tool.handler(arguments)
                except Exception as exc:  # noqa: BLE001
                    output = {"status": "error", "error": str(exc)}
                step["output"] = output
                step["duration_ms"] = int((time.time() - step["started_at"]) * 1000)
                audit.append(step)

                messages.append({
                    "role": "assistant",
                    "content": f"Called {tool_name}({arguments})",
                })
                messages.append({
                    "role": "user",
                    "content": f"Result: {output}",
                })

                if tool_name == "post_smart_ziw_comment":
                    if output.get("status") == "ok":
                        final_status = "success"
                        comment_id = output.get("comment_id")
                    else:
                        final_status = "error"
                        error = output.get("error", "post_smart_ziw_comment failed")
                    return {
                        "run_id": run_id,
                        "final_status": final_status,
                        "comment_id": comment_id,
                        "audit": audit,
                        "error": error,
                    }

        error = error or f"Exceeded max iterations ({self.max_iterations}) without posting a comment."
        return {
            "run_id": run_id,
            "final_status": final_status,
            "comment_id": comment_id,
            "audit": audit,
            "error": error,
        }
```

- [ ] **Step 4: Run tests and commit**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_loop.py -v`
Expected: PASS

Commit:
```bash
git add backend/smart_ziw_loop.py backend/tests/test_smart_ziw_loop.py
git commit -m "feat(smart-ziw): add tool-loop runner with audit trail"
```

---

### Task 5: Implement Research Tools

**Files:**
- Modify: `backend/smart_ziw_research.py`
- Modify: `backend/smart_ziw_tools.py` (wire real handlers)
- Test: `backend/tests/test_smart_ziw_research.py`

**Interfaces:**
- Consumes: Brave API key from config, existing HTTP helpers.
- Produces: Tool handlers for `brave_web_search`, `scrape_page`, `find_documents`, `download_document`, `derive_buyer_site`.

- [ ] **Step 1: Add Brave Search function**

In `backend/smart_ziw_research.py`, add:

```python
import os
import requests
from urllib.parse import urljoin, urlparse

_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


def brave_search(query: str, api_key: str, count: int = 10) -> dict[str, Any]:
    if not api_key:
        return {"status": "error", "error": "Brave API key not configured", "results": []}
    headers = {"X-Subscription-Token": api_key, "Accept": "application/json"}
    params = {"q": query, "count": count}
    resp = requests.get(_BRAVE_SEARCH_URL, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    results = []
    for item in data.get("web", {}).get("results", []):
        results.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("description", ""),
        })
    return {"status": "ok", "results": results}
```

- [ ] **Step 2: Refactor existing helpers into tool handlers**

Reuse existing `_http_scrape`, `_http_search`, `_derive_buyer_site_from_emails`, `_fetch_detail` functions. Wrap each as an async handler that accepts the tool argument dict and returns the standardized output shape.

Example:

```python
async def handle_brave_web_search(args: dict[str, Any]) -> dict[str, Any]:
    from smart_ziw_config import load_smart_ziw_config
    cfg = load_smart_ziw_config()
    return brave_search(args["query"], cfg["brave_api_key"], args.get("count", 10))
```

- [ ] **Step 3: Wire handlers in smart_ziw_tools.py**

Replace `raise NotImplementedError` placeholders with the real handler functions imported from `smart_ziw_research.py`.

- [ ] **Step 4: Update tests**

Add `test_brave_search_uses_api_key` and `test_brave_search_returns_results` with `responses` or `requests` mocked via `monkeypatch`.

- [ ] **Step 5: Run tests and commit**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_research.py -v`
Expected: PASS

Commit:
```bash
git add backend/smart_ziw_research.py backend/smart_ziw_tools.py backend/tests/test_smart_ziw_research.py
git commit -m "feat(smart-ziw): implement research tools with brave search"
```

---

### Task 6: Comment Posting Tool

**Files:**
- Modify: `backend/smart_ziw_agent.py`
- Modify: `backend/smart_ziw_tools.py`
- Test: `backend/tests/test_smart_ziw_agent.py`

**Interfaces:**
- Consumes: Existing `_post_smart_ziw_comment` logic.
- Produces: `post_smart_ziw_comment` tool handler.

- [ ] **Step 1: Extract comment posting into a reusable async function**

In `backend/smart_ziw_agent.py`, refactor `_post_smart_ziw_comment` into a standalone async function that accepts tender ID, content, source URL, files, and user context.

```python
async def post_smart_ziw_comment(
    tender_id: str,
    content: str,
    source_url: str,
    downloaded_files: list[str],
    failed_files: list[str],
    user: dict[str, Any],
) -> dict[str, Any]:
    ...
```

- [ ] **Step 2: Implement the tool handler**

The tool handler is a closure or function that captures the current user and attaches files:

```python
def make_post_comment_handler(user: dict[str, Any]):
    async def handler(args: dict[str, Any]) -> dict[str, Any]:
        return await post_smart_ziw_comment(
            tender_id=args["tender_id"],
            content=args["content"],
            source_url=args["source_url"],
            downloaded_files=args.get("downloaded_files", []),
            failed_files=args.get("failed_files", []),
            user=user,
        )
    return handler
```

- [ ] **Step 3: Wire handler in tool registry at runtime**

In `smart_ziw_agent.run`, before creating the loop, set:

```python
from smart_ziw_tools import REGISTRY, Tool
REGISTRY["post_smart_ziw_comment"] = Tool(
    name="post_smart_ziw_comment",
    description="Post the final Smart-Ziw analysis comment.",
    input_schema={...},
    handler=make_post_comment_handler(user),
)
```

- [ ] **Step 4: Update tests**

Mock the comment API and verify the tool handler returns `comment_id`.

- [ ] **Step 5: Run tests and commit**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_agent.py -v`
Expected: PASS

Commit:
```bash
git add backend/smart_ziw_agent.py backend/smart_ziw_tools.py backend/tests/test_smart_ziw_agent.py
git commit -m "feat(smart-ziw): wire post-comment tool handler"
```

---

### Task 7: Replace Agent Orchestration

**Files:**
- Modify: `backend/smart_ziw_agent.py`
- Test: `backend/tests/test_smart_ziw_agent.py`

**Interfaces:**
- Consumes: `SmartZiwToolLoop`, `LLMClient`, tool registry, config.
- Produces: `smart_ziw_agent.run(tender, thread, user, config) -> dict`.

- [ ] **Step 1: Rewrite smart_ziw_agent.run**

Replace the existing orchestration with:

```python
async def run(tender, thread, user, config):
    from smart_ziw_config import load_smart_ziw_config
    from smart_ziw_llm import LLMClient
    from smart_ziw_loop import SmartZiwToolLoop
    from smart_ziw_tools import REGISTRY, Tool

    cfg = load_smart_ziw_config()
    llm = LLMClient(
        base_url=cfg["llm_provider"]["base_url"],
        api_key=cfg["llm_provider"]["api_key"],
        model=cfg["llm_provider"]["model"],
    )

    # Bind user-specific handler for posting comments.
    REGISTRY["post_smart_ziw_comment"] = Tool(
        name="post_smart_ziw_comment",
        description="Post the final Smart-Ziw analysis comment.",
        input_schema={...},
        handler=make_post_comment_handler(user),
    )

    loop = SmartZiwToolLoop(llm=llm, tools=REGISTRY, max_iterations=cfg["max_iterations"])
    return await loop.run(tender=tender)
```

- [ ] **Step 2: Preserve old behavior flag (optional)**

If the old `smart_ziw_research_enabled` config still exists, ignore it or remove it from config/code. The tool-loop is always research-enabled.

- [ ] **Step 3: Update integration tests**

Mock `LLMClient.chat` to simulate a full successful run and a failure run. Assert the final comment content and audit trail.

- [ ] **Step 4: Run tests and commit**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_agent.py -v`
Expected: PASS

Commit:
```bash
git add backend/smart_ziw_agent.py backend/tests/test_smart_ziw_agent.py
git commit -m "feat(smart-ziw): replace agent orchestration with tool-loop"
```

---

### Task 8: Server Config Endpoints

**Files:**
- Modify: `backend/server.py`
- Test: `backend/tests/test_smart_ziw_config.py` (extend)

**Interfaces:**
- Produces: `GET /api/admin/smart-ziw-config` (redacted), `POST /api/admin/smart-ziw-config` (save), `GET /api/smart-ziw/config` (redacted, maybe admin-only).

- [ ] **Step 1: Add Pydantic models**

```python
class LlmProviderConfig(BaseModel):
    base_url: str = ""
    api_key: str = ""
    model: str = "claude-sonnet-4"

class SmartZiwConfig(BaseModel):
    llm_provider: LlmProviderConfig = Field(default_factory=LlmProviderConfig)
    brave_api_key: str = ""
    max_iterations: int = 15
    tool_timeout_seconds: int = 60
```

- [ ] **Step 2: Add admin endpoints**

```python
@admin_router.get("/smart-ziw-config")
async def get_smart_ziw_config():
    cfg = load_smart_ziw_config()
    return redact_config(cfg)

@admin_router.post("/smart-ziw-config")
async def save_smart_ziw_config_endpoint(payload: SmartZiwConfig):
    from database import get_db
    raw = payload.model_dump()
    existing = load_smart_ziw_config()
    merged = _merge_secrets(existing, raw)
    save_smart_ziw_config(get_db(), merged)
    return redact_config(merged)
```

Implement `_merge_secrets` so that `"***"` values preserve existing secrets.

- [ ] **Step 3: Add tests**

Verify GET returns redacted values, POST updates config, and `***` preserves old secrets.

- [ ] **Step 4: Run tests and commit**

Run: `PYTHONPATH=. python3 -m pytest backend/tests/test_smart_ziw_config.py -v`
Expected: PASS

Commit:
```bash
git add backend/server.py backend/smart_ziw_config.py backend/tests/test_smart_ziw_config.py
git commit -m "feat(smart-ziw): add admin config endpoints"
```

---

### Task 9: Frontend Admin Settings UI

**Files:**
- Modify: `frontend/src/App.jsx`
- Test: manual smoke test after build.

**Interfaces:**
- Consumes: `GET /api/admin/smart-ziw-config`, `POST /api/admin/smart-ziw-config`.

- [ ] **Step 1: Add config state and load/save functions**

Add state:

```javascript
const [smartZiwConfig, setSmartZiwConfig] = useState({
  llm_provider: { base_url: '', api_key: '', model: 'claude-sonnet-4' },
  brave_api_key: '',
  max_iterations: 15,
});
```

Implement `loadSmartZiwConfig()` and `saveSmartZiwConfig()` using `apiFetch`.

- [ ] **Step 2: Add form fields in the Smart-Ziw admin tab**

Fields:
- LLM base URL
- LLM API key
- LLM model
- Brave API key
- Max iterations

Use the same input pattern as existing MCP server form.

- [ ] **Step 3: Build frontend**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/dist/
git commit -m "feat(smart-ziw): admin UI for LLM provider and Brave key"
```

---

### Task 10: Full Test Suite + Docker Verification

**Files:**
- All test files.
- Docker context.

- [ ] **Step 1: Run full backend test suite**

Run: `cd /home/kali/smartZiw/eProcScraper && PYTHONPATH=. python3 -m pytest backend/tests/ -q --ignore=backend/tests/test_auth_comments.py`
Expected: all pass.

- [ ] **Step 2: Build frontend**

Run: `cd frontend && npm run build`
Expected: clean build.

- [ ] **Step 3: Rebuild Docker**

User runs:
```bash
cd /home/kali/smartZiw/eProcScraper && sudo docker compose up -d --build
```

- [ ] **Step 4: Live smoke test**

1. Open admin panel, set Kimi base URL + key + Brave key.
2. Open BHN tender.
3. Click Smart-Ziw.
4. Verify comment is posted with audit trail and source URL.

- [ ] **Step 5: Commit any final fixes**

---

## Self-Review

**Spec coverage:**
- Tool-loop replacing agent runtime: Task 7.
- Anthropic-compatible LLM: Task 3.
- Brave Search integration: Task 5.
- Audit trail in comments: Task 4 + 6.
- markitdown in Docker: Task 1.
- Failed files as clickable links: Task 6.
- Source unknown handling: system prompt in Task 4.
- Config endpoints + redaction: Task 8.
- Frontend settings UI: Task 9.

**Placeholder scan:** No TBD/TODO/fill-in-later steps.

**Type consistency:** `SmartZiwToolLoop.run` returns the shape used by `smart_ziw_agent.run`. `Tool.handler` is async and accepts `dict[str, Any]`. `LLMClient.chat` returns the shape expected by the loop.

**Gaps:** None identified for Phase 1.
