# Smart-Ziw V2 — Remaining Work (handoff)

Status: 2026-08-28. Repo: github.com/mrojz/SmartZiwV2 (`main`; dev branch `worktree-smart-ziw-tool-loop`).
Worktree: `/home/kali/smartZiw/eProcScraper/.claude/worktrees/smart-ziw-tool-loop`

## What this is

Backend tool-loop redesign replacing the custom Smart-Ziw agent with an LLM-driven tool sequence:
fetch aggregator tender → find source (Brave Search) → find documents → download/analyze (markitdown) → post comment with audit trail.

- Spec: `docs/superpowers/specs/2026-08-23-smart-ziw-tool-loop-design.md`
- Plan: `docs/superpowers/plans/2026-08-23-smart-ziw-tool-loop.md`
- SDD ledger (read first — rulings + per-task history): `.superpowers/sdd/2026-08-23-smart-ziw-tool-loop/progress.md`

## Process (subagent-driven development)

Per task:
1. Record BASE: `git rev-parse HEAD > .superpowers/sdd/2026-08-23-smart-ziw-tool-loop/task-N-base.txt`
2. Extract brief: `bash <superpowers-dir>/scripts/task-brief docs/superpowers/plans/2026-08-23-smart-ziw-tool-loop.md N`
3. Dispatch a fresh implementer subagent (brief path + rulings below), then a reviewer over the diff (package: `scripts/review-package PLAN BASE HEAD`).
4. Fix rounds if review fails; update the ledger.
5. Push after each task: `git push v2 worktree-smart-ziw-tool-loop:main`

## Done

- [x] Task 1: Config model (`backend/smart_ziw_config.py`)
- [x] Task 2: Tool registry + schemas (`backend/smart_ziw_tools.py`)
- [x] Task 3: Anthropic-compatible LLM client (`backend/smart_ziw_llm.py` — `LLMClient.chat` async via `asyncio.to_thread`, `LLMError`, lazy `anthropic` import)
- [x] Task 4: Tool-loop runner + audit trail (`backend/smart_ziw_loop.py` — `SmartZiwToolLoop.run(tender, system_prompt)`)

## Remaining

- [ ] **Task 5: Implement Research Tools** — `brave_search` (Brave Search API) + wire handlers `brave_web_search`, `scrape_page`, `find_documents`, `download_document`, `derive_buyer_site` onto existing helpers in `backend/smart_ziw_research.py`. [IN PROGRESS 2026-08-28]
- [ ] **Task 6: Comment Posting Tool** — extract `post_smart_ziw_comment` handler from `backend/smart_ziw_agent.py`.
- [ ] **Task 7: Replace Agent Orchestration** — `smart_ziw_agent.run()` invokes `SmartZiwToolLoop` instead of the old research/synthesize flow. Core integration task.
- [ ] **Task 8: Server Config Endpoints** — GET/PUT Smart-Ziw config in `backend/server.py`, redact secrets.
- [ ] **Task 9: Frontend Admin Settings UI** — `frontend/src/App.jsx` form for LLM provider + Brave API key.
- [ ] **Task 10: Full Test Suite + Docker Verification** — backend + frontend build, docker rebuild.
- [ ] **Final whole-branch review** (most capable model), then finishing-a-development-branch: merge to main, delete worktree.
- [ ] **Docker rebuild (sudo) + live smoke test** on a real BHN tender.

## Key interfaces

- `smart_ziw_config`: `load_smart_ziw_config()` / `save_smart_ziw_config(db, config)` / `redact_config(config)`
- `smart_ziw_tools`: `REGISTRY: dict[str, Tool]`, `get_tool`, `list_tools`
- `LLMClient.chat(messages, tools, system=None)` → `{"role","content","tool_calls","stop_reason"}`
- `SmartZiwToolLoop.run(tender, system_prompt)` → `{"run_id","final_status","comment_id","audit","error"}`
- Tool handlers: async, take args dict, return `{"status": "ok"|"error", ...}` (never raise)

## Rulings (binding, from ledger)

1. LLM call wrapped with `asyncio.to_thread` (Anthropic SDK is sync).
2. Function-level imports in `smart_ziw_tools.py` handlers to avoid import cycles — `smart_ziw_research` imports `smart_ziw_agent` at module level, and Task 7 makes `smart_ziw_agent` import the loop.
3. Registration/OTP automation is Phase 2 — out of scope.
4. Tool-loop LLM must be Anthropic-compatible (`base_url`/`api_key`/`model`).
5. Failed file URLs must appear as clickable markdown links in the comment; `source_url` must be "unknown" when not identified; audit trail embedded in the final comment.
