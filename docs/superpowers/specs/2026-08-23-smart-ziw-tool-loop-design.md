# Smart-Ziw Tool-Loop Redesign

**Date:** 2026-08-23  
**Status:** Proposed — awaiting approval  
**Author:** Claude Code assistant  

## 1. Background

The current Smart-Ziw agent is a custom Python pipeline (`smart_ziw_agent.run` → `run_research` → `synthesize`) that is hard to extend and brittle to maintain. Recent work added HTTP fallbacks and MCP support, but the orchestration logic remains bespoke and the agent cannot dynamically adapt when a step fails (e.g., source found but documents not downloadable).

This spec proposes replacing the custom agent runtime with a backend LLM **tool-loop** using the Anthropic SDK (Anthropic-compatible endpoints only). The LLM chooses which tool to call next based on intermediate results, and every action is recorded in an audit trail.

## 2. Goals

1. Replace the custom agent orchestration with a standard tool-use loop.
2. Support any Anthropic-compatible LLM provider (Anthropic, Kimi, etc.) via configurable `base_url`, `api_key`, `model`.
3. Integrate **Brave Search** as the default web search tool.
4. Make Smart-Ziw actions observable: report the exact path taken, successes, partial failures, and skipped files.
5. Add `markitdown` to the Docker image for document-to-markdown conversion.
6. Keep registration/OTP automation (Phase 2) out of scope for the initial implementation.

## 3. Non-Goals

1. No support for non-Anthropic-compatible LLM APIs in Phase 1 (OpenAI-compatible providers can be added later behind a provider switch).
2. No browser automation, registration, or OTP handling in Phase 1.
3. No changes to the comments UI or notification system beyond what the backend comment API already provides.

## 4. High-Level Architecture

```
User clicks Smart-Ziw
        │
        ▼
backend/server.py::_run_smart_ziw(tender)
        │
        ▼
SmartZiwToolLoop.run(tender, config)
        │
        ├──► LLM call #1: system prompt + tender context
        │         LLM chooses a tool
        │
        ├──► Tool execution (Brave search, scrape, download, post comment, ...)
        │         Result appended to audit trail
        │
        ├──► LLM call #2: updated context
        │         LLM chooses next tool
        │
        ▼
   Loop until post_comment is called or max_iterations reached
        │
        ▼
Return final audit trail + comment (or error)
```

## 5. Tool Definitions

Each tool is a Python async function with a JSON schema exposed to the LLM.

### 5.1 `fetch_aggregator_tender`

Fetches the tender document from the aggregator site (e.g., Niger Marchés).

```json
{
  "name": "fetch_aggregator_tender",
  "description": "Fetch the original tender page from the aggregator website using the tender's project_id or db_id.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "tender_id": {"type": "string", "description": "Internal tender identifier"}
    },
    "required": ["tender_id"]
  }
}
```

**Returns:** `{"title": "...", "description": "...", "buyer_emails": [...], "aggregator_url": "...", "status": "ok|error", "error": "..."}`

### 5.2 `brave_web_search`

Searches the web using the Brave Search API.

```json
{
  "name": "brave_web_search",
  "description": "Search the public web for the buyer's official tender page or related documents.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string"},
      "count": {"type": "integer", "default": 10}
    },
    "required": ["query"]
  }
}
```

**Returns:** `{"results": [{"title": "...", "url": "...", "snippet": "..."}], "status": "ok|error", "error": "..."}`

### 5.3 `derive_buyer_site`

Derives a likely buyer website from email addresses found in the tender.

```json
{
  "name": "derive_buyer_site",
  "description": "Guess the buyer's official website from email domains in the tender.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "tender_id": {"type": "string"}
    },
    "required": ["tender_id"]
  }
}
```

**Returns:** `{"url": "https://bhn.ne", "confidence": "high|medium|low", "status": "ok|error"}`

### 5.4 `scrape_page`

Fetches and extracts text + links from a URL.

```json
{
  "name": "scrape_page",
  "description": "Scrape a web page and extract visible text and document links.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": {"type": "string"}
    },
    "required": ["url"]
  }
}
```

**Returns:** `{"title": "...", "text": "...", "links": [{"text": "...", "url": "..."}], "status": "ok|error", "error": "..."}`

### 5.5 `find_documents`

Given a source page URL or search results, identifies likely tender document URLs (PDF, ZIP, DOCX, etc.). Uses `scrape_page` internally and can fall back to `brave_web_search` if no documents are found on the source page.

```json
{
  "name": "find_documents",
  "description": "Find downloadable documents related to the tender. If the source page has none, searches the web.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "source_url": {"type": "string"},
      "tender_title": {"type": "string"},
      "tender_reference": {"type": "string"}
    },
    "required": ["source_url"]
  }
}
```

**Returns:** `{"documents": [{"url": "...", "filename": "...", "type": "pdf|zip|...", "source": "page|search"}], "status": "ok|error", "error": "..."}`

### 5.6 `download_document`

Downloads a document, converts it to markdown via `markitdown`, and stores it for attachment.

```json
{
  "name": "download_document",
  "description": "Download a document and convert it to markdown for analysis.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": {"type": "string"},
      "tender_id": {"type": "string"}
    },
    "required": ["url", "tender_id"]
  }
}
```

**Returns:** `{"local_path": "...", "markdown": "...", "filename": "...", "status": "ok|error", "error": "..."}`

**Partial-failure behavior:** If the URL is found but returns 403/404/timeout, the tool returns `status: "error"` with a descriptive message. The LLM may try an alternative URL or report the failure in the final comment.

### 5.7 `mcp_tool_call` *(optional, Phase 1)*

Calls a tool from an enabled MCP server configured in the admin UI.

```json
{
  "name": "mcp_tool_call",
  "description": "Call an external tool provided by a configured MCP server.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "server_id": {"type": "string"},
      "tool_name": {"type": "string"},
      "arguments": {"type": "object"}
    },
    "required": ["server_id", "tool_name", "arguments"]
  }
}
```

### 5.8 `post_smart_ziw_comment`

Terminating tool. Posts the final recap comment and attaches downloaded files.

```json
{
  "name": "post_smart_ziw_comment",
  "description": "Post the final Smart-Ziw analysis as a comment on the tender. Call this when ready.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "tender_id": {"type": "string"},
      "content": {"type": "string", "description": "Markdown recap"},
      "source_url": {"type": "string"},
      "downloaded_files": {"type": "array", "items": {"type": "string"}, "description": "List of local file paths to attach"},
      "failed_files": {"type": "array", "items": {"type": "string"}, "description": "URLs that could not be downloaded"}
    },
    "required": ["tender_id", "content", "source_url"]
  }
}
```

**Returns:** `{"comment_id": "...", "status": "ok|error", "error": "..."}`

## 6. Audit Trail / Path Reporting

Every tool call is recorded in a structured audit trail stored in memory and returned with the final result:

```json
{
  "run_id": "uuid",
  "tender_id": "...",
  "started_at": "...",
  "finished_at": "...",
  "steps": [
    {
      "step": 1,
      "tool": "fetch_aggregator_tender",
      "input": {"tender_id": "20572"},
      "output": {"title": "AVIS D'APPEL D'OFFRE INTERNATIONAL N°001/...", "buyer_emails": ["achats@bhn.ne"], "status": "ok"},
      "duration_ms": 450
    },
    {
      "step": 2,
      "tool": "derive_buyer_site",
      "input": {"tender_id": "20572"},
      "output": {"url": "https://bhn.ne", "confidence": "medium", "status": "ok"},
      "duration_ms": 120
    },
    {
      "step": 3,
      "tool": "find_documents",
      "input": {"source_url": "https://bhn.ne", "tender_title": "..."},
      "output": {
        "documents": [{"url": "https://bhn.ne/avis.pdf", "filename": "avis.pdf", "type": "pdf", "source": "page"}],
        "status": "ok"
      },
      "duration_ms": 980
    },
    {
      "step": 4,
      "tool": "download_document",
      "input": {"url": "https://bhn.ne/avis.pdf", "tender_id": "20572"},
      "output": {"local_path": "/tmp/...", "filename": "avis.pdf", "status": "ok"},
      "duration_ms": 1500
    },
    {
      "step": 5,
      "tool": "post_smart_ziw_comment",
      "input": {"tender_id": "20572", "content": "# Recap...", "source_url": "https://bhn.ne"},
      "output": {"comment_id": "...", "status": "ok"},
      "duration_ms": 220
    }
  ],
  "final_status": "success|partial|error",
  "summary": "Posted comment with 1 attachment. 0 files failed to download.",
  "error": null
}
```

**Reporting rules:**
- If a document URL is found but `download_document` fails, the URL is added to `failed_files` and included in the final comment under a "Files we could not retrieve" section.
- If the source URL cannot be found, the LLM must still call `post_smart_ziw_comment` with an honest explanation.
- If the LLM exceeds `max_iterations` without calling `post_smart_ziw_comment`, the loop terminates with `final_status: "error"` and the audit trail is logged.

## 7. Error Handling

- **Tool error:** tool returns `status: "error"` + message. LLM sees the error and decides next action.
- **LLM API error:** entire run fails; audit trail is persisted for debugging.
- **Loop timeout/max iterations:** run terminates with `final_status: "error"`; partial audit trail is saved.
- **Post-comment failure:** if `post_smart_ziw_comment` fails, the run fails; the audit trail and generated content are logged so an admin can retry.

## 8. Configuration

New settings stored in the existing config collection:

```json
{
  "_type": "smart_ziw_config",
  "llm_provider": {
    "base_url": "https://api.kimi.com/coding",
    "api_key": "***",
    "model": "kimi3"
  },
  "brave_api_key": "***",
  "max_iterations": 15,
  "tool_timeout_seconds": 60
}
```

Frontend admin UI needs fields for:
- LLM base URL
- LLM API key
- LLM model
- Brave API key
- Max iterations (optional, default 15)

## 9. Docker Dependencies

Add to `backend/requirements.txt`:

```text
markitdown>=0.1.6
```

`markitdown` is already installed on the host for development; adding it to `requirements.txt` ensures it is installed in the Docker image.

## 10. Files Changed

- `backend/smart_ziw_agent.py` — replace orchestration with tool-loop.
- `backend/smart_ziw_research.py` — refactor existing helpers into tool implementations (`brave_search`, `scrape_page`, `find_documents`, `download_document`).
- `backend/smart_ziw_tools.py` *(new)* — tool schemas and dispatch table.
- `backend/smart_ziw_loop.py` *(new)* — LLM tool-loop runner + audit trail.
- `backend/server.py` — new config endpoints/settings for LLM provider and Brave key; redact secrets.
- `backend/requirements.txt` — add `markitdown`.
- `frontend/src/App.jsx` — admin settings form for LLM provider + Brave key.
- `backend/tests/test_smart_ziw_*.py` — rewrite tests for tool-loop.

## 11. Testing

1. Unit tests for each tool in isolation (mocked HTTP, mocked Brave API).
2. Unit test for the tool-loop runner with a fake LLM that exercises success and error paths.
3. Integration test for the BHN tender end-to-end against the real Brave API (optional, manual).
4. Frontend test for settings form validation.

## 12. Phase 2: Registration / OTP Automation

Out of scope for Phase 1. When needed, add:

- `register_portal_account(site_url)` tool using Playwright.
- `check_temp_mail()` tool using a temp-mail API.
- `submit_otp(otp)` tool.
- A per-site configuration map because every portal has a different flow.

This should be gated behind an explicit admin opt-in per site and logged heavily.

## 13. Decisions

1. **Failed file URLs:** Include as clickable links in the final comment under a "Files we could not retrieve" section.
2. **Audit trail:** Posted inside the Smart-Ziw comment itself (collapsed under a "Path taken" section) so it is visible to users and persists with the tender.
3. **Source unknown:** If no buyer source is identified, the comment explicitly states "Original source: not identified" and does not fabricate a source URL.

---

**Next step:** approve this spec, then write the implementation plan.
