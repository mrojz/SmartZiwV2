# LLM Provider Admin Refactor — Design Spec (Simplified Configuration + Model Discovery)

**Date:** 2026-08-15
**Status:** Approved by Omar (design sections 2026-08-15)
**Extends:** `docs/superpowers/specs/2026-08-15-smart-ziw-v15-design.md` (LLM provider factory, admin config surface). Anything not changed here stays in force.

## Goal

Refactor the existing "LLM Provider" admin page so a non-technical admin can configure the Smart-Ziw LLM backend without touching `.env` or knowing model names:

1. **Configuration source** — a clear radio choice: **Environment (.env)** or **LightLLM**. Environment hides all LightLLM fields.
2. **LightLLM configuration** — Base URL, API Key, **Provider (server type)**, and **Model**, where the Model dropdown is populated dynamically through the backend. No model names are hard-coded in the frontend.
3. **Model discovery** — implemented in the backend, reusing the existing LLM/provider architecture, with five UI states: Loading, Models loaded, No models available, Unable to connect/discover, and Provider does not support automatic model discovery. A **Refresh models** action is always available.
4. **Optional API key** — discovery is attempted without authentication first; only if the provider requires a key does the UI say so and allow entering/updating one and retrying. An existing API key is never exposed in the UI, API responses, logs, or errors.
5. **Compatibility** — existing `.env`-based and LightLLM configurations must continue working, saved through the existing secure storage, and restored after reload.

## Architecture

```
Frontend (App.jsx — LLM Provider admin panel, reworked in place)
  radio: Environment (.env) | LightLLM
    Environment -> shows env info line (GET /api/admin/llm-env-status) + Save
    LightLLM    -> Base URL, API Key, Server type, Model control, Refresh models
                   model discovery: POST /api/admin/llm-models {provider, base_url, api_key?}

Backend
  smart_ziw_llm.py (extended — same module that builds the LightLLM OpenAI client)
    discover_lightllm_models(provider, base_url, api_key) -> {"status", "models"}
      statuses: ok | no_models | auth_required | unsupported | error
  server.py (extended)
    POST /api/admin/llm-models   (admin-only) -> discovery passthrough
    GET  /api/admin/llm-env-status (admin-only) -> {model, api_key_set}  (no secrets)
  database.py (extended)
    DEFAULT_SMART_ZIW_CONFIG += lightllm_provider   (whitelist auto-includes it)

Runtime LLM routing (get_llm_call) is UNCHANGED — lightllm_provider is
used only by discovery; every existing config behaves exactly as before.
```

## Components

### 1. Config model & compatibility

**New config key:** `lightllm_provider` — the server type behind the LightLLM Base URL.

- Values: `"openai_compatible"` (default) | `"custom"`
- Default `"openai_compatible"` reproduces today's behavior exactly.
- `"custom"` means "no automatic model discovery — the admin types the model name".

**Radio ↔ stored value mapping** (the radio is the only place the routing provider is chosen in the UI):

| Radio selection | Saved `smart_ziw_llm_provider` |
|---|---|
| Environment (.env) | `"deepseek"` (forces the `.env` path) |
| LightLLM | `"lightllm"` |

**Load-time mapping** (existing configs must keep working, including legacy `"auto"`):

| Stored `smart_ziw_llm_provider` | Radio shown |
|---|---|
| `"lightllm"` | LightLLM |
| `"deepseek"` | Environment |
| `"auto"` (legacy) | LightLLM if `lightllm_base_url` non-blank, else Environment |

Rationale: `auto` + blank URL behaved as env; `auto` + URL behaved as LightLLM — this mapping is 1:1 with the old runtime semantics. Nothing is migrated until the admin next saves; legacy `"auto"` values keep working at runtime because `get_llm_call` is untouched.

**Storage:** add `lightllm_provider: str = "openai_compatible"` to:
- `DEFAULT_SMART_ZIW_CONFIG` (backend/database.py) — the save whitelist derives from the defaults, so persistence needs no further plumbing.
- `SmartZiwConfigUpdate` (backend/server.py).
- `smartZiwConfig` useState initial value (frontend/src/App.jsx).

Secret handling for `lightllm_api_key` is unchanged: redacted to `""` on GET and PUT responses; preserved-on-blank on PUT; never in error strings.

### 2. Backend model discovery

**`POST /api/admin/llm-models`** — admin-only (`_require_admin`).

Request body (pydantic model `LlmModelsRequest`):

```python
class LlmModelsRequest(BaseModel):
    provider: str = "openai_compatible"   # "openai_compatible" | "custom" (anything else -> unsupported)
    base_url: str = ""
    api_key: str = ""                     # ONLY a key the admin just typed; otherwise blank
```

Response:

```python
{"status": "ok" | "no_models" | "auth_required" | "unsupported" | "error",
 "models": [{"id": str, "name": str}, ...],   # empty list unless status == "ok"
 "detail": str | None}                        # sanitized explanation for "error" only
```

**Security rules (binding):**
- The API key appears in NO response, NO error string, and NO log entry. `detail` strings must never contain the key or any Authorization header value.
- The endpoint never returns the stored key; `api_key` in the request is used in-memory for the discovery attempt only and is never persisted by this endpoint.

**Discovery function** — `discover_lightllm_models(provider, base_url, api_key) -> dict` in `backend/smart_ziw_llm.py`, reusing the existing OpenAI SDK client construction (`_LIGHTLLM_PLACEHOLDER_KEY` convention; no new dependencies):

1. If `provider != "openai_compatible"` → return `{"status": "unsupported", "models": []}` with no network call.
2. If `base_url` is blank → return `{"status": "error", "detail": "LightLLM base URL is not set", "models": []}` with no network call.
3. Attempt keyless discovery first: OpenAI client with `api_key=_LIGHTLLM_PLACEHOLDER_KEY`, timeout 8s, `client.models.list()` against `{base_url}`.
4. On 401/403: retry with the resolved key — the request `api_key` if non-blank, else the stored `lightllm_api_key` from `get_smart_ziw_config()`. Success → `ok`. Failure again, or no key exists → `{"status": "auth_required", "models": []}`.
5. Success normalization: accept entries that are objects with an `id` (name = entry `name` if present and non-blank else the id) or bare strings (id = name = string). Skip entries without a usable id. Dedupe by id. Sort by name case-insensitively.
   - Non-empty list → `{"status": "ok", "models": [...]}`
   - Empty list → `{"status": "no_models", "models": []}`
6. Error mapping:
   - HTTP 404 from `/models` → `{"status": "unsupported", "models": []}` (the server does not implement model listing).
   - Connection errors, timeouts, other HTTP statuses, non-JSON responses → `{"status": "error", "detail": "<sanitized>", "models": []}`. Sanitized detail mentions only the failure class (e.g. "Connection to the LightLLM server failed", "The server returned HTTP 500"), never the key.

### 3. Environment status

**`GET /api/admin/llm-env-status`** — admin-only (`_require_admin`).

Response:

```python
{"model": "<resolved DEEPSEEK_MODEL / DEEPSEEK_WEB_MODEL / 'deepseek-chat'>",
 "api_key_set": bool}          # whether DEEPSEEK_API_KEY is non-blank — a boolean only, never the value
```

Used by the Environment mode info line so a non-technical admin can see what `.env` resolves to without reading server files.

### 4. Frontend UX

The LLM Provider panel (frontend/src/App.jsx, `adminTab === 'llm'`) is reworked **in place**, keeping the existing visual design (same `panel-card`, `profile-settings-grid`, `auth-field`, `auth-label`, `auth-input`, `profile-btn` classes; same Save button placement and message banner).

**Configuration source radio** — a two-option radio group at the top of the panel:
- **Environment (.env)** — subtitle: "Use the DeepSeek settings from the backend `.env` file."
- **LightLLM** — subtitle: "Use your own OpenAI-compatible LightLLM server."

Radio state derives from `smart_ziw_llm_provider` + `lightllm_base_url` per the load-time mapping table above; the user's selection updates the radio state immediately (saved on Save).

**Environment mode** — shows the radio, the env info line, and Save. Info line: "Using model `<model>` from environment configuration (API key set / not set)." fetched from `GET /api/admin/llm-env-status` when the tab opens in Environment mode. All LightLLM fields are hidden.

**LightLLM mode** — shows the radio, then:
- **LightLLM Base URL** — text input, placeholder `http://localhost:8000/v1`.
- **API Key** — password input, placeholder "Leave blank to keep the stored key". A freshly typed key lives in form state until saved; **after a successful save the field is cleared** so the UI never displays a persisted key.
- **Provider (server type)** — select with options *OpenAI-compatible* and *Custom (enter model manually)*, bound to `lightllm_provider`.
- **Model** — the dynamic control with a status line directly beneath it. Six states — the five from the request plus the auth-required state from the API-key flow:
  1. **Loading** — "Loading available models…", control disabled.
  2. **Models loaded** — dropdown populated from the discovery response; no hard-coded options.
  3. **No models available** — message + plain text input fallback.
  4. **Unable to connect** — "Unable to connect to the LightLLM server. Check the base URL." (+ `detail` when provided) + text input fallback.
  5. **Auth required** — "This provider requires an API key to retrieve available models." + text input fallback.
  6. **Unsupported** — "This provider does not support automatic model discovery." + text input fallback.

  The text-input fallback in states 3–6 holds the current `lightllm_model` value, so the admin can always set or keep a model manually — never stuck. (The initial `"default"` value is the stored config value, not a hard-coded option.)
- **Refresh models** button — beside the Model control. Disabled while a discovery fetch is in flight, when the server type is `custom`, or when the base URL is blank.

**Discovery triggers:** (a) opening the tab with LightLLM selected and a non-blank base URL, (b) switching the server type to OpenAI-compatible (with non-blank base URL), (c) pressing Refresh models. Refresh sends the just-typed API key in the discovery request when one is present, so the flow *auth required → type key → Refresh* works without saving first; the key is persisted only by Save.

**Stale responses:** a discovery response that arrives after the user switched the radio to Environment, changed the base URL, or changed the server type is ignored (the fetch closure captures the values it was sent with, and only an exact match against current form state applies the result).

**Save** — same `PUT /api/admin/smart-ziw-config` and `saveSmartZiwConfig` merge semantics as today, additionally writing the radio-derived `smart_ziw_llm_provider` (`"deepseek"` | `"lightllm"`) and `lightllm_provider`. After success: clear the API key field (it is now stored server-side) and show the existing success message. Secret re-pinning from `prev` state on save-merge is unchanged.

**Version:** bump the app version to 1.6 and add a release-notes entry: "LLM Provider configuration simplified: Environment/LightLLM source choice with automatic model discovery."

### 5. Testing & verification

**Backend unit tests** — extend `backend/tests/test_smart_ziw_llm.py` using the existing fake-OpenAI-client pattern (`_FakeOpenAI` class):
- keyless discovery success (normalization: object entries, bare strings, dedupe, sort)
- 401 → retry with resolved key → success
- 401 with no key available → `auth_required`
- 404 → `unsupported`
- connection error → `error` with sanitized detail (detail must not contain the key)
- empty model list → `no_models`
- `custom` (and any unknown provider) → `unsupported` with no network call (fake client must not be constructed)
- blank base URL → `error` with no network call

**Backend server tests** — extend `backend/tests/test_smart_ziw_server.py`:
- `POST /api/admin/llm-models` returns 403 for a non-admin user
- `ok` passthrough with the endpoint's response shape
- a non-blank request `api_key` is forwarded to `discover_lightllm_models` (monkeypatched) and the response never contains it
- `auth_required` passthrough
- `GET /api/admin/llm-env-status` returns the resolved model name and `api_key_set` boolean only — assert the DEEPSEEK_API_KEY value itself is not present
- existing config GET/PUT tests keep passing (new key `lightllm_provider` present, secrets still redacted)

**Existing suites must stay green** — all 95 existing tests (llm 9, agent 33, research 36, server 6, mention 11) pass unchanged; runtime routing (`get_llm_call`) is not modified by this work.

**Frontend** — `npm run build` exits 0 (no frontend test framework in this repo).

**Manual verification checklist** (final plan task; needs a live deployment for the LightLLM steps):
1. Environment mode: select Environment, save; reload the page → Environment still selected; info line shows the resolved model.
2. LightLLM mode: select LightLLM, enter base URL, save; reload → LightLLM selected, fields restored (API key field blank, stored key kept).
3. Provider selection: switch between OpenAI-compatible and Custom → model control shows dropdown vs unsupported message.
4. Dynamic model discovery: OpenAI-compatible + live server → dropdown shows the server's models; Refresh re-fetches.
5. Authentication error: live server requiring auth → "requires an API key" state; enter key + Refresh → models load.
6. Connection error: unreachable base URL → "Unable to connect" state.
7. Saving: change fields, save → success message; config persisted (verify via GET).
8. Restoring configuration after reload: all saved values return; API key never appears in the UI or in GET/PUT responses.

## Global Constraints

- **No new dependencies** — discovery uses the existing `openai` SDK (`>=1.6.0`).
- **No changes to runtime LLM routing** — `smart_ziw_llm.get_llm_call()` and all its consumers are untouched.
- **No hard-coded model names in the frontend** — the Model dropdown options come only from the discovery response.
- **Secrets never exposed** — `lightllm_api_key` (and `gitlab_token`, `firecrawl_api_key`) remain redacted on GET/PUT; the key never appears in discovery responses, error details, or logs.
- **Existing configurations keep working** — `.env`-based and LightLLM configs (including legacy `"auto"`) behave exactly as before, in storage and at runtime.
- **Visual design unchanged** — same panel structure, field classes, and button styling; only the configuration UX changes.
- **Admin-only endpoints** — both new endpoints call `_require_admin(request)`.
