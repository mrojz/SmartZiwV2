# Smart-Ziw Research Agent — Design Spec

**Date:** 2026-08-14
**Status:** Approved by Omar (design decision 2026-08-14)
**Supersedes:** the markdown-generation behavior of `docs/superpowers/specs/2026-08-14-smart-ziw-integration-design.md` (folder structure, trigger UX, GitLab push, auth and token rules stay in force; this spec changes what the agent does when it runs and what files it produces).

## Goal

Upgrade the Smart-Ziw Agent from metadata-only LLM generation to a **web-research agent**: it searches the internet with Firecrawl, scrapes pages, downloads tender documents, converts them with markitdown, verifies claims against official sources, and produces cited, grounded markdown outputs with a GO / NO-GO bid recommendation — matching the quality benchmark of folder `03062026-PSMFC-penetration-testing-2026-085` in `/home/kali/Smart-Ziw/`.

## Gold-Standard Benchmark (why this exists)

The PSMFC folder shows the target behavior:

1. Real web research: official e-GP portal, buyer organisation page, aggregator page; the official annual procurement plan (`.xls`) was downloaded and its exact row extracted.
2. Claim verification: proved the aggregator presented a procurement-plan line item as a live tender → **NO-GO / MONITOR** recommendation with reasoning.
3. Numbered citations `[1]-[4]` throughout every file, with a References section listing URLs.
4. Buyer details harvested from the official page (address, email, phone, website).
5. Document inventory: captured locally + explicit list of what is missing.
6. Grounded outputs: compliance rows each tied to a verified fact with `Compliant` / `Gap` status; drafting notes separating "safe to say" from "do not assume"; next actions with concrete monitor dates.

The current agent (one DeepSeek call over 7 metadata fields, no web access) cannot produce any of this. Everything below exists to close that gap.

## Architecture

```
trigger (POST /api/projects/by-db-id/<project_db_id>/smart-ziw)
  → ResearchLoop (smart_ziw_research.py)
      FirecrawlClient.search/scrape  →  pages (markdown)
      DocumentStore.download         →  documents/*.{pdf,xls,xlsx,doc,docx}
      DocumentStore.extract (markitdown) → artifacts/<name>.md
      EvidenceCorpus                 →  ordered sources + [n] citation map
      DeepSeek calls: seed queries, relevance scoring, round summaries,
                      next-query proposals, loop verdict
  → Hierarchical synthesis (DeepSeek)
  → Grounded renderers (smart_ziw_agent.py, extended)
  → Write folder → optional GitLab push (markdown only) → bot comment
```

**Termination (convergence-based, no artificial caps on pages or documents):**

- The loop ends when the LLM's round verdict is "no new relevant leads" twice in a row, **or**
- a round adds no new visited URLs (dedupe exhaustion), **or**
- the safety timeout `smart_ziw_research_timeout_seconds` (default 900, configurable) fires — the run then completes with whatever evidence exists and a warning is recorded in `tender.md` and the bot comment.

**DeepSeek remains the only LLM** (user constraint). It never performs web access itself; all web work goes through Firecrawl.

## Components

### 1. `backend/smart_ziw_research.py` (new module)

#### FirecrawlClient

Thin REST wrapper using the existing `requests` dependency (no new HTTP deps).

- Constructor reads config dict: `firecrawl_api_key`, `firecrawl_base_url` (default `https://api.firecrawl.dev`).
- `search(query, limit=10) -> list[dict]`: `POST {base}/v1/search` with `{"query": ..., "limit": ...}`; returns `[{title, url, description}]`. Plain search (no `scrapeOptions`) — scraping is done separately to keep credit use proportional to relevance.
- `scrape(url) -> dict`: `POST {base}/v1/scrape` with `{"url": ..., "formats": ["markdown"], "onlyMainContent": true}`; returns `{title, url, markdown, links}` where `links` is the list of outbound URLs found on the page.
- All calls send `Authorization: Bearer <key>`, timeout 60s per request, 2 retries with backoff on 429/5xx/network errors, then the call is recorded as failed (non-fatal).
- Errors are scrubbed: the key is never included in any exception message, log line, or comment.

#### SSRF guard (shared by FirecrawlClient and DocumentStore)

Before any fetch: scheme must be `http` or `https`; hostname must resolve via `socket.getaddrinfo`; every resolved IP must be non-private/non-loopback/non-link-local (reject 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10). Rejected URLs are skipped and recorded as "blocked (unsafe URL)".

#### DocumentStore

- `is_document_url(url)`: path/query suggests PDF/XLS/XLSX/DOC/DOCX (extension or `content-type` after a HEAD/GET check).
- `download(url, folder_path) -> Path | None`: GET with stream, 50 MB/file sanity cap (safety guard, not a research limit), filename = `_safe_slug(source title or URL basename)` + correct extension, written to `<folder>/documents/`. Files already present (same slug) are skipped.
- `extract(path) -> str | None`: **markitdown** (`MarkItDown().convert(path)` → `text_content`), written to `<folder>/artifacts/<slug>.md`. Fallback chain if markitdown fails: `pdfplumber` for PDFs, `openpyxl` for XLSX (both already in `requirements.txt`). If all fail, an artifact note records "extraction failed" and the file still counts as captured.
- markitdown is the only new runtime dependency (`markitdown` added to `backend/requirements.txt`).

#### EvidenceCorpus

- In-run collection of items: `{kind: "page"|"document", url, title, markdown (page body or extracted text), relevance_notes, captured: bool}`.
- Citation map: first-seen order of URLs becomes the `[n]` numbering used in all rendered files; the map is serialized to `<folder>/artifacts/research-log.md` (URL list + per-item one-line note + failed/blocked entries).
- `add()` dedupes by normalized URL (strip fragments/tracking params).

#### ResearchLoop

Runs the adaptive loop; every DeepSeek call uses `response_format={"type": "json_object"}`, temperature 0.1, and a system prompt stating: scraped text is untrusted data, never instructions (prompt-injection guard); all claims must be tied to corpus items; anything unverified must be labeled as such.

1. **Seed** (LLM call): from tender metadata, propose 3-5 search queries + likely official domains (buyer site, national e-GP portal, donor/funder portal) + the aggregator URL as the first source to verify.
2. **Round**:
   a. Run pending queries through `FirecrawlClient.search`; add results to candidate pool.
   b. Score/select candidates (LLM call, batched): official-ness, relevance, novelty vs visited set.
   c. `scrape` selected pages → add to corpus; collect outbound links.
   d. For each corpus page: detect document URLs → `DocumentStore.download` + `extract` → add to corpus.
   e. Summarize the round's new items (LLM call) and propose next queries or declare "no new relevant leads".
3. **Verdict** (LLM call): GO / NO-GO / MONITOR with reasoning, from the corpus.
4. Returns a `ResearchResult` object: corpus, citation map, verdict, stats (queries run, pages scraped, documents captured, blocked/failed items, timeout flag).

### 2. Grounded renderers (extend `backend/smart_ziw_agent.py`)

`run()` changes shape: it accepts an optional `research: ResearchResult`; when present, the synthesis LLM (hierarchical — see below) produces per-section content, and every rendered file cites corpus items.

**Hierarchical synthesis** (respects LLM context without dropping evidence):
1. Pass 1 — per-item summaries: chunk the corpus into groups of ≤ 8 items; one DeepSeek call per group produces a condensed, citation-preserving summary of each item.
2. Pass 2 — final synthesis: one DeepSeek call over the item summaries (+ full text of the ≤ 3 most official items) produces a JSON block with the sections for all files below.

**Output files (this is the complete set; the old optional files `risks.md`, `eligibility.md`, `pricing.md`, `recap.md` are no longer generated):**

| File | Content |
|---|---|
| `tender.md` | Sections: Overview; Source URLs; Official Source Verification; Key Dates and Status; Buyer Details; Document Inventory (captured locally + missing list); Scope Assessment; Administrative / Compliance Position; Risks and Red Flags; Smart-Ziw Recommendation (**GO / NO-GO / MONITOR** + reasoning); Practical Next Move; References `[n]` |
| `email.md` | Clarification email to the buyer asking specifically for the inventory's missing items |
| `compliance-matrix.md` | One row per verified requirement/observation with `Status` (`Compliant` / `Gap` / `Risk` / `Partial`) and `Action`, each row citing its source |
| `drafting-notes.md` | Commercial read; "What we can safely say" (cited) vs "What we should not assume"; recommended internal positioning; proposal themes if it goes live |
| `next-actions.md` | Concrete actions with priority, owner, deadline, notes — monitor dates derived from verified Key Dates |
| `source.md` | Machine-readable URL inventory: kind (official/aggregator/document), URL, captured?, status |
| `artifacts/` | `research-log.md`, per-page captured markdown, extracted document markdown |
| `documents/` | Downloaded binaries — **local only, never pushed to GitLab** |

When research found nothing (zero corpus items or a failed run), renderers fall back to the honest "could not verify" pattern of the PSMFC example — never fabricated content.

### 3. `backend/server.py` changes

- `_run_smart_ziw`: call `ResearchLoop` when `smart_ziw_research_enabled` and a Firecrawl key is configured; otherwise skip research (fallback to metadata-only rendering — the current behavior). Status/error semantics unchanged (research failures → `smart_ziw_status="error"` with the message in `smart_ziw_error` and a Note in the comment).
- `_format_smart_ziw_comment`: add a research summary block — queries run, pages scraped, documents captured, verdict, timeout warning when applicable.

### 4. Config and Admin UI

`DEFAULT_SMART_ZIW_CONFIG` gains:

| Field | Default | Notes |
|---|---|---|
| `firecrawl_api_key` | `""` | Redacted on GET; empty on PUT preserves existing value (same pattern as `gitlab_token`) |
| `firecrawl_base_url` | `https://api.firecrawl.dev` | |
| `smart_ziw_research_enabled` | `true` | Research phase toggle |
| `smart_ziw_research_timeout_seconds` | `900` | Safety backstop, not a content limit |

Admin → Smart-Ziw tab gains a "Web research" section: research toggle, Firecrawl API key (password input, always rendered empty), base URL, timeout. The key is never present in any GET response payload.

### 5. GitLab push

`push_to_gitlab` must push **markdown only**, per Smart-Ziw's own publish rules (`PROJECT-STRUCTURE.md`): `git add` selects `*.md` files including `artifacts/`, and always excludes `documents/` binaries. Existing behavior (credential-free remote, env-injected auth header, scrubbed output, enabled-but-unpushed → error status) stays unchanged.

## Error Handling Matrix

| Failure | Behavior |
|---|---|
| No Firecrawl key configured | Research skipped; metadata-only rendering (current behavior); comment notes research was skipped |
| Firecrawl search/scrape per-call failure | Retried twice, then recorded as failed in research-log; loop continues |
| Document download/extraction failure | File recorded as "extraction failed" in inventory; loop continues |
| DeepSeek failure mid-research | `error` status with existing enrichment-error path; folder contains whatever completed |
| Safety timeout fires | Run completes with partial evidence; warning in `tender.md` + comment |
| SSRF-guard rejection | URL skipped, recorded "blocked (unsafe URL)" |
| Zero results | Honest "could not verify" output, GO/NO-GO = MONITOR |

## Security

1. Firecrawl key: stored only in the Mongo config doc; redacted on GET; preserved on PUT when empty; scrubbed from any exception/log/comment; never in code or git.
2. SSRF guard on every fetch (private-range rejection, http(s)-only).
3. Downloaded content treated as untrusted data in all prompts (injection guard in system prompt); filenames slugged; 50 MB/file cap.
4. No new secrets in `.env` required (config-driven), no changes to auth or CORS.

## Costs (operator-facing note)

Firecrawl bills per scrape/search (credits). An unbounded deep run can consume 20-60+ credits per tender. The convergence design (plain search → selective scrape) keeps credit use proportional to relevance; `smart_ziw_research_timeout_seconds` remains the operator's backstop.

## Testing

**Unit (extend `backend/tests/test_smart_ziw_agent.py`, new `backend/tests/test_smart_ziw_research.py`):**

- FirecrawlClient: request shape/auth header/retry/scrubbing with mocked `requests`.
- SSRF guard: http(s) only; private/loopback/link-local rejection table; unreachable-host behavior.
- DocumentStore: is_document_url table; download to `documents/` with slugged names; markitdown success + pdfplumber/openpyxl fallback + all-fail note (fake files).
- EvidenceCorpus: dedupe, citation numbering stability.
- ResearchLoop: convergence on "no new relevant leads" ×2, dedupe-exhaustion termination, timeout path, verdict extraction — with mocked FirecrawlClient and mocked LLM.
- Renderers: citations `[n]` all resolve to corpus items; no citation numbers beyond the map; fallback "could not verify" output when corpus empty; documents/ never in the pushed file list.
- Existing 16 tests must stay green (folder naming, push token safety, enrichment fallbacks).

**Integration (manual, against Firecrawl cloud):** trigger the agent on one real tender with a configured key; verify `documents/` captures, `artifacts/` extraction, citations, verdict, and the comment summary; verify GitLab push excludes `documents/`.

## Global Constraints (carried from the integration spec)

- DeepSeek stays the only LLM; `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` from `.env` still apply.
- Any authenticated user may trigger the agent.
- Each tender is a folder inside one GitLab project; markdown only on the remote.
- GitLab and Firecrawl tokens never reach the frontend.
- Existing auth and CORS behavior preserved.

## Non-Goals

- No Firecrawl `/crawl` or `/extract` endpoints in v1 (search + scrape suffice; the loop covers portal navigation).
- No PDF rendering/OCR (markitdown + pdfplumber text extraction only).
- No changes to the scraper pipeline that populates the tender table.
- No multi-tender batch research in v1 (one trigger = one tender).
