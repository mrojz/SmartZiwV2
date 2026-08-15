# Smart-Ziw v1.5 — Design Spec (LLM Provider, Human-Only Next Actions, @SmartZiw Chat)

**Date:** 2026-08-15
**Status:** Approved by Omar (design decisions 2026-08-15)
**Extends:** `docs/superpowers/specs/2026-08-14-smart-ziw-research-design.md` (agent flow, prompts, renderers) and `docs/superpowers/specs/2026-08-14-smart-ziw-integration-design.md` (comments, admin config, notifications). Anything not changed here stays in force.

## Goal

Three features on top of the v1.4 web-research agent:

1. **Human-only next actions** — `next-actions.md` must contain ONLY actions the LLM cannot perform itself. Anything automatable (drafting, reviewing, pricing models, document retrieval, eligibility analysis) is excluded, no matter what the LLM returns.
2. **@SmartZiw chat mention** — a user tagging `@SmartZiw` in a project comment passes that comment to the LLM; the answer is posted as a new bot-authored comment in the same thread.
3. **LightLLM provider module** — a new `smart_ziw_llm` module makes the LLM backend admin-configurable. Rule (user decision): **every Smart-Ziw LLM call goes through the lightllm configuration when one is configured; otherwise it falls back to the `.env` parameters (DeepSeek)**. An explicit provider selector exists for forcing either backend.

## Architecture

```
LLM call factory (smart_ziw_llm.py, new)
  get_llm_call(config, json_mode=True) -> callable(system, user) -> dict | str
    provider = config["smart_ziw_llm_provider"]   # "auto" | "deepseek" | "lightllm"
      auto (default): lightllm_base_url non-blank -> lightllm params
                      else                        -> .env (DEEPSEEK_API_KEY/BASE_URL/MODEL)
      deepseek: always .env
      lightllm: always lightllm params; blank base_url -> RuntimeError
  consumers: run_research, synthesize, _enrich, @SmartZiw chat — ALL agent LLM calls

next actions (smart_ziw_agent.py)
  SYNTHESIS_PROMPT / ENRICH_PROMPT: prompt asks for human-only actions
  _human_only_actions(rows) filter inside BOTH next-actions renderers (single rule, no bypass)

@SmartZiw chat (server.py)
  POST /api/comments -> if project comment body contains "@smartziw" (case-insensitive)
    -> gate on smart_ziw_enabled, claim per-project slot (_smart_ziw_running)
    -> daemon thread: get_llm_call(config, json_mode=False)(CHAT_PROMPT, context)
    -> bot comment reply (bot:smart-ziw) with requester as mention -> SSE bell
```

## Components

### 1. `backend/smart_ziw_llm.py` (new module)

The provider abstraction. Imports `_call_llm` and `_safe_json_loads` from `smart_ziw_agent` at module level. **`smart_ziw_agent.py` must never import `smart_ziw_llm` at module level** (it imports it lazily inside `run()` and nowhere else at top level) — this keeps the import graph acyclic, since `smart_ziw_research.py` imports `smart_ziw_agent` at module level.

- `get_llm_call(config: dict | None = None, json_mode: bool = True) -> Callable[[str, str], dict | str]`
  - Reads `smart_ziw_llm_provider` from config (default `"auto"`). Resolution per the table above. `"auto"` never raises; `"lightllm"` raises `RuntimeError("LightLLM base URL is not configured")` when `lightllm_base_url` is blank (stripped).
  - `"auto"` treats lightllm as configured iff `str(config.get("lightllm_base_url") or "").strip()` is non-blank. The API key is optional (blank is fine for local servers).
  - Returns the **existing** `_call_llm` (env-driven DeepSeek) unchanged for the deepseek/auto-fallback path when `json_mode=True`. For `json_mode=False` on that path, returns a new internal `_call_llm_text(system, user) -> str`: same env vars (`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, model via `DEEPSEEK_MODEL` → `DEEPSEEK_WEB_MODEL` → `deepseek-chat`), same `temperature=0.1`, `max_tokens=4000`, **no `response_format`**, returns `response.choices[0].message.content or ""`.
  - LightLLM path: `OpenAI(api_key=<lightllm_api_key or "EMPTY">, base_url=<lightllm_base_url>)` with `lightllm_model` (default `"default"` — the LightLLM convention; the served model is fixed at server start). **`response_format` is NEVER sent on this path** (compatibility with OpenAI-compatible servers that reject it); JSON prompts still work because `_safe_json_loads` strips fences and falls back. `json_mode=True` → `_safe_json_loads(content)`; `json_mode=False` → raw string.
  - No API key ever appears in an exception message or error string. Config errors name only the missing field.

### 2. Config surface (database.py, server.py, App.jsx)

Four new keys, added to `DEFAULT_SMART_ZIW_CONFIG` (database.py:433), `SmartZiwConfigUpdate` (server.py:979), and the frontend `smartZiwConfig` state (App.jsx:1967):

| Key | Default | Type | Notes |
|---|---|---|---|
| `smart_ziw_llm_provider` | `"auto"` | str | `"auto"` \| `"deepseek"` \| `"lightllm"` |
| `lightllm_base_url` | `""` | str | **Blank by default** — that is what makes `"auto"` fall back to `.env` until the admin configures it (reconciles the auto rule with existing deployments; zero behavior change until configured). Admin field placeholder suggests `http://localhost:8000/v1`. |
| `lightllm_api_key` | `""` | str | **Secret.** Redacted to `""` on GET and PUT responses; preserved-on-blank on PUT — exactly like `gitlab_token`/`firecrawl_api_key` (server.py:1641-1642, 1651-1654, 1656-1657). |
| `lightllm_model` | `"default"` | str | Only used on the lightllm path. |

Backend: add `lightllm_api_key` to BOTH redaction lists and the preservation block. Frontend (App.jsx): add the four keys to the `useState` object, add `lightllm_api_key: prev.lightllm_api_key` to the save-success prev-preserving merge (App.jsx:2042), and add a new **"LLM provider"** admin section after the Web research section (~line 2587), following the established conventions: inline-styled `<h4>` divider, `<select className="auth-input">` with three options — `Auto (LightLLM if configured, else DeepSeek env)` / `DeepSeek (env)` / `LightLLM` — base-URL text input (placeholder `http://localhost:8000/v1`), model text input, and a `type="password"` API-key input with placeholder `Leave blank to keep the stored key`.

### 3. Agent routing rewiring (smart_ziw_agent.py, smart_ziw_research.py)

- `smart_ziw_agent.py`:
  - `_enrich(project: dict, llm_call=None) -> dict` gains the injection param; the call at L198 becomes `(llm_call or _call_llm)(ENRICH_PROMPT, user_prompt)`. Error string `"DeepSeek enrichment failed"` → `"LLM enrichment failed"`.
  - `run()`: after the research gate, build the call once:
    ```python
    try:
        from smart_ziw_llm import get_llm_call
        llm_call = get_llm_call(config)
    except RuntimeError as exc:
        llm_call = None
        error = str(exc)      # forced "lightllm" with blank base_url
        research_ran = False  # and enrichment replaced by defaults below
    ```
    - Research path: `run_research(project, config, folder_path=folder_path, llm_call=llm_call)` and `synthesize(project, research, llm_call=llm_call)` — the injection seam already exists in both (research.py:440, 682).
    - Metadata path: `_enrich(project, llm_call=llm_call)`; when `llm_call is None` because the provider errored, use `_default_enrichment()` with `enrichment["error"] = error` so the run still produces the fallback files and the bot comment surfaces the provider error.
  - New `CHAT_PROMPT` module constant (plain-text answer contract, see §5).
- `smart_ziw_research.py`: `"DeepSeek synthesis failed"` (L708) → `"LLM synthesis failed"`. No other change — it already threads `llm_call` through every internal call via `_llm_json`.

### 4. Human-only next actions

Two layers, both mandatory:

**Prompt layer.** In `ENRICH_PROMPT` (agent.py:162) and `SYNTHESIS_PROMPT` (research.py:633), replace the `next_actions` line with:

> `- "next_actions": list of objects with keys action, priority, owner, deadline, notes. List ONLY actions that require human authority, legal accountability, physical presence, payment, signatures, team management, or official submission. Exclude anything the agent or LLM already does: drafting, reviewing, summarizing, pricing models, eligibility analysis, retrieving documents, compliance checks, preparing proposals. If every remaining action is automatable, return an empty list.`

**Filter layer — the guarantee.** New pure function in `smart_ziw_agent.py`:

- `_human_only_actions(rows: list) -> list[dict]` — rows are dicts with an `action` key (both renderers table it as `Action | Priority | Owner | Deadline | Notes`). Classification of each row, on `text = str(row.get("action") or "").strip().lower()`:
  1. Rows with no non-blank `action` (or non-dict rows) → **DROP** (they would render as `-`).
  2. `"send" in text and "email" in text` → **KEEP** (official emails are human-sent).
  3. Any KEEP_MARKERS substring present → **KEEP**: `submit, sign, pay, notariz, register, attend, meet, team, bank guarantee, bid bond, authorized, approval, call, negotiat`.
  4. First whitespace token of `text` ∈ DROP_VERBS → **DROP**: `draft, prepare, review, write, summarize, summarise, research, analyze, analyse, compare, compile, create, generate, obtain, retrieve, download, check, verify, assess, evaluate, estimate, calculate, develop, plan, translate, extract, gather, collect, find, list, outline`.
  5. Otherwise → **KEEP** (unknown phrasing passes through; the prompt is the primary enforcement).
- Choke points: BOTH renderers apply it — `render_next_actions_markdown` (metadata path, agent.py:236) and `_render_research_next_actions` (research path, agent.py:311) — immediately after reading `rows`, so no path bypasses the filter. When the filter empties a **non-empty** original list, the table is replaced by the line: `All identified next actions are automatable by the LLM; no human-only actions remain.` An originally empty list keeps the existing `No next actions identified.` line.

**Acceptance fixture** (user-supplied anti-pattern rows — must be unit-tested exactly):

| Row action | Verdict |
|---|---|
| Send clarification email to buyer | KEEP |
| Assemble bid team and assign responsibilities | KEEP |
| Submit proposal before deadline | KEEP |
| Draft and review proposal document | DROP |
| Review eligibility criteria and compliance requirements | DROP |
| Prepare pricing model | DROP |
| Develop technical solution proposal | DROP |
| Obtain full tender document from official SAWES eTender portal | DROP |

### 5. @SmartZiw chat mention (server.py)

**Detection** (in `post_comment`, server.py:1248, after the comment is created): fires only when `entityType == "project"`, the project dict resolved from `projectDbId` is not None, and `"@smartziw" in body.lower()`. No frontend changes — the reader maps confirm bot comments render via the stored `authorName` fallback and the 5s poll picks up the reply automatically.

**Hook `_maybe_start_smart_ziw_chat(comment, project, requester)`** — synchronous, in `post_comment`:

1. `config = get_smart_ziw_config()`; if `not config.get("smart_ziw_enabled", True)` → post bot comment: `Smart-Ziw is disabled by the administrator.`
2. Under `_smart_ziw_lock`: if `project_db_id in _smart_ziw_running` → post bot comment: `Smart-Ziw is already working on this project. Please wait for the current run to finish.` (no queueing). Else add to the set and spawn `threading.Thread(target=_answer_smart_ziw_mention, args=(project_db_id, project, requester, comment), daemon=True).start()`.

**Worker `_answer_smart_ziw_mention(project_db_id, project, requester, comment)`**:

1. Build the user prompt: project fields (name, buyer, country, deadline, description, source URL, current `smart_ziw_status` and `smart_ziw_folder` if set), the triggering comment body with the `@SmartZiw` token removed, and the **last 10 comments** in the thread (`list_comments(entityType, entityId)`, excluding the triggering comment by id, bodies only, each prefixed `"<authorName>: "`).
2. `config = get_smart_ziw_config()`; `call = get_llm_call(config, json_mode=False)`; `answer = call(CHAT_PROMPT, user_prompt)`.
3. `CHAT_PROMPT`: *"You are Smart-Ziw, the tender-bidding assistant for this procurement platform. Answer the user's comment about the project using only the provided context. Be concise (a short paragraph or bullet list). Cite project facts accurately. If the question needs full web research, tell the user to trigger the Smart-Ziw agent run for this project."* Answer is plain text, not JSON.
4. Reply: `_create_project_comment_and_notify(entity_type="project", entity_id=_project_entity_id(project), project=project, author_user={"id": "bot:smart-ziw", "name": "Smart-Ziw Bot", "email": "", "avatarUrl": ""}, body_text=capped_answer, mentions=[{"userId": requester["id"], "name": requester.get("name") or "", "email": requester.get("email") or ""}])` — the mention gives the requester a live SSE notification; everyone else sees the reply via the 5s poll.
   - Cap: answer truncated to 2000 chars (append `…` when truncated); empty answer → `Smart-Ziw has no answer for this question.`
5. Failure: on any exception, post bot comment `Smart-Ziw could not answer: {exc}` with the exception message only (never config secrets); the trigger comment stays.
6. `finally`: under `_smart_ziw_lock`, discard `project_db_id` from `_smart_ziw_running` (same convention as `_run_smart_ziw`, server.py:529-531).

No research run, no files, no `smart_ziw_status` state updates — chat is stateless apart from the comments.

### 6. Release notes / version

App.jsx: bump version `1.4` → `1.5` and add a release-notes entry covering the three features (follows the v1.4 convention).

## Global Constraints

- Existing 61 green tests stay green (the pre-existing uncollectable `test_auth_comments.py` remains out of scope); pytest runs from `backend/` as cwd; each test file self-contains its `sys.path` bootstrap.
- No new Python or npm dependencies — the `openai` SDK already in `requirements.txt` covers the lightllm path.
- `.env.example` unchanged (deepseek path stays env-driven).
- Error strings and comments never contain API keys (DeepSeek, Firecrawl, LightLLM, GitLab).
- The bot identity for all Smart-Ziw comments stays `{"id": "bot:smart-ziw", "name": "Smart-Ziw Bot", ...}`.
- All new comment creation goes through `_create_project_comment_and_notify` — never `database.create_comment` directly for user-visible comments.
- `smart_ziw_llm_provider` accepts any other value by treating it as `"auto"` (forward-compatible).

## Testing Plan (minimum)

- `backend/tests/test_smart_ziw_llm.py` (new): auto→env fallback with blank base_url; auto→lightllm with base_url set; forced deepseek ignores lightllm config; forced lightllm raises on blank base_url; lightllm client built with model/api-key/EMPTY-key wiring (monkeypatch `openai.OpenAI`); `response_format` absent from lightllm calls; `json_mode=False` returns raw text; keys never in error strings.
- `backend/tests/test_smart_ziw_agent.py`: `_human_only_actions` table tests with the 8-row acceptance fixture (exact KEEP/DROP split above) + empty/unknown/malformed-row cases; both renderers show the `All identified next actions are automatable…` note when filtering empties a non-empty list and keep `No next actions identified.` when originally empty; `_enrich` accepts and uses `llm_call` (and error text says "LLM enrichment failed"); `run()` passes `llm_call` into `run_research`/`synthesize` (fake them with `llm_call` in signature) and falls back to defaults + error when `get_llm_call` raises.
- `backend/tests/test_smart_ziw_server.py`: config GET redacts and PUT preserves `lightllm_api_key` (extend the existing three config tests); mention hook tests — tagged project comment spawns the worker (monkeypatched `threading.Thread` or direct `_answer_smart_ziw_mention` call with `get_llm_call` and `_create_project_comment_and_notify` monkeypatched in the established in-memory style): reply carries bot identity + requester mention + capped body; disabled path posts the disabled note and spawns nothing; busy path posts the busy note; error path posts the failure note; untagged comments and non-project entities spawn nothing; prompt builder includes project fields, last-10 thread comments (excluding the trigger), and no `@SmartZiw` token.
- Frontend: `npm run build` passes; the admin panel renders the provider select and three lightllm fields; save preserves `lightllm_api_key` on the success merge.

## Out of Scope

- The CLI paths (`ai_enrichment.py`, `ai_filter.py`, `utils/dgmarket_scraper.py`) keep their own env-driven DeepSeek clients — the provider selection governs the Smart-Ziw agent flow only.
- No bundling of a LightLLM inference server; the admin points `lightllm_base_url` at any OpenAI-compatible endpoint.
- No comment threading/reactions/edits; no mention highlighting in the UI.
- No queueing of @SmartZiw requests while the agent is running on the same project (busy note instead).
