# LLM Provider Admin Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the admin "LLM Provider" page into a simple Environment-vs-LightLLM choice with backend-driven model discovery, without changing runtime LLM routing or breaking existing configurations.

**Architecture:** A new `discover_lightllm_models()` function in the existing `smart_ziw_llm.py` module performs OpenAI-compatible model discovery (keyless first, then keyed retry on 401/403) and normalizes results to a common `[{id, name}]` list. Two new admin-only endpoints expose discovery and environment status. The frontend panel is reworked in place: a source radio, conditional LightLLM fields, and a Model control with six states plus Refresh.

**Tech Stack:** Python/FastAPI backend (openai>=1.6.0 SDK, no new dependencies), React frontend (no new dependencies), pytest.

**Spec:** `docs/superpowers/specs/2026-08-15-llm-provider-admin-refactor-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

**Base:** commit `2e58c65` on `main` (`docs: LLM provider admin refactor design spec`). Execute on a new branch in an isolated worktree (superpowers:using-git-worktrees at execution time). Record BASE (`git rev-parse HEAD`) before dispatching each task.

## Global Constraints

- **No new dependencies** — discovery uses the existing `openai` SDK (`>=1.6.0`); `backend/requirements.txt` and `frontend/package.json` stay untouched.
- **No changes to runtime LLM routing** — `smart_ziw_llm.get_llm_call()` and all its consumers are untouched.
- **No hard-coded model names in the frontend** — the Model dropdown options come only from the discovery response.
- **Secrets never exposed** — `lightllm_api_key` (and `gitlab_token`, `firecrawl_api_key`) remain redacted on GET/PUT; the key never appears in discovery responses, error details, or logs.
- **Existing configurations keep working** — `.env`-based and LightLLM configs (including legacy `"auto"`) behave exactly as before, in storage and at runtime.
- **Visual design unchanged** — same panel structure, field classes (`panel-card`, `profile-settings-grid`, `auth-field`, `auth-label`, `auth-input`, `profile-btn`), and button styling; only the configuration UX changes.
- **Admin-only endpoints** — both new endpoints call `_require_admin(request)`.
- **Test commands run from `backend/`** — `cd backend && python -m pytest ...`. Frontend build: `npm --prefix frontend run build` from the repo root.

## File Structure

| File | Responsibility |
|---|---|
| `backend/smart_ziw_llm.py` (modify) | `discover_lightllm_models()` + `_normalize_llm_models()` + `_stored_lightllm_api_key()` — model discovery over the OpenAI-compatible protocol |
| `backend/tests/test_smart_ziw_llm.py` (modify) | Unit tests for discovery (fake OpenAI client pattern already in the file) |
| `backend/database.py` (modify) | `DEFAULT_SMART_ZIW_CONFIG` gains `lightllm_provider` |
| `backend/server.py` (modify) | `SmartZiwConfigUpdate` gains `lightllm_provider`; new `LlmModelsRequest`; `POST /api/admin/llm-models`; `GET /api/admin/llm-env-status` |
| `backend/tests/test_smart_ziw_server.py` (modify) | Endpoint tests (403, passthrough, secret hygiene, env status) |
| `frontend/src/App.jsx` (modify) | Panel rework: source radio, conditional fields, model control with 6 states, Refresh, env info line, save-key clearing, version 1.6 + release note |
| `frontend/src/styles/app-shell.css` (modify) | Minimal CSS for the radio group and status line, using existing design tokens |

---

### Task 1: Model discovery function

**Files:**
- Modify: `backend/smart_ziw_llm.py`
- Test: `backend/tests/test_smart_ziw_llm.py`

**Interfaces:**
- Produces (consumed by Task 2):
  - `discover_lightllm_models(provider: str, base_url: str, api_key: str = "") -> dict` returning `{"status": "ok"|"no_models"|"auth_required"|"unsupported"|"error", "models": [{"id": str, "name": str}], "detail": str | None}`. `detail` is present only for `"error"` and never contains the API key. Unknown/non-`openai_compatible` providers and blank base URLs return without any network call.
  - `_normalize_llm_models(entries) -> list[dict]` — dedupe by id, sort by name case-insensitively.
  - `_stored_lightllm_api_key() -> str` — stored key from `get_smart_ziw_config()` (lazy import of `database`), `""` on any failure.

- [ ] **Step 1: Extend the fake OpenAI client and reset helper**

In `backend/tests/test_smart_ziw_llm.py`, replace the existing `_FakeOpenAI` class and `_reset_fake_openai` function (lines 20-33) with:

```python
class _FakeOpenAI:
    instances = []
    next_content = '{"ok": true}'
    next_models = []            # returned by models.list() unless next_models_errors applies
    next_models_errors = []     # exceptions raised by successive models.list() calls

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.chat = MagicMock()
        self.chat.completions.create.return_value = _response(_FakeOpenAI.next_content)
        self.models = MagicMock()
        self.models.list.side_effect = _models_list_side_effect
        _FakeOpenAI.instances.append(self)


def _models_list_side_effect(*args, **kwargs):
    if _FakeOpenAI.next_models_errors:
        raise _FakeOpenAI.next_models_errors.pop(0)
    return MagicMock(data=list(_FakeOpenAI.next_models))


def _reset_fake_openai():
    _FakeOpenAI.instances = []
    _FakeOpenAI.next_content = '{"ok": true}'
    _FakeOpenAI.next_models = []
    _FakeOpenAI.next_models_errors = []
```

- [ ] **Step 2: Run the existing llm suite to verify nothing broke**

Run: `cd backend && python -m pytest tests/test_smart_ziw_llm.py -q`
Expected: PASS — 9 passed.

- [ ] **Step 3: Add the discovery tests**

Append to `backend/tests/test_smart_ziw_llm.py`:

```python
# --- model discovery (discover_lightllm_models) ---

from openai import APIConnectionError, APIStatusError


def _status_error(status_code):
    return APIStatusError("status", response=MagicMock(status_code=status_code), body=None)


def test_discover_keyless_success_normalizes_models(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    _FakeOpenAI.next_models = ["gpt-4o", {"id": "", "name": "Empty"}, {"id": "a1", "name": "Alpha"},
                                {"id": "a1", "name": "Alpha Dupe"}, {"id": "b1"}]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "ok", "models": [
        {"id": "a1", "name": "Alpha"},
        {"id": "b1", "name": "b1"},
        {"id": "gpt-4o", "name": "gpt-4o"},
    ]}
    assert len(_FakeOpenAI.instances) == 1
    client = _FakeOpenAI.instances[0]
    assert client.kwargs["api_key"] == "EMPTY"
    assert client.kwargs["base_url"] == "http://localhost:8000/v1"


def test_discover_returns_no_models_on_empty_list(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    _FakeOpenAI.next_models = []
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "no_models", "models": []}


def test_discover_401_retries_with_stored_key(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "stored-key")
    _FakeOpenAI.next_models_errors = [_status_error(401)]
    _FakeOpenAI.next_models = [{"id": "m1", "name": "Model One"}]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "ok", "models": [{"id": "m1", "name": "Model One"}]}
    assert len(_FakeOpenAI.instances) == 2
    assert _FakeOpenAI.instances[0].kwargs["api_key"] == "EMPTY"
    assert _FakeOpenAI.instances[1].kwargs["api_key"] == "stored-key"


def test_discover_401_without_key_returns_auth_required(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "")
    _FakeOpenAI.next_models_errors = [_status_error(401)]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "auth_required", "models": []}
    assert len(_FakeOpenAI.instances) == 1


def test_discover_typed_key_preferred_over_stored_key(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "stored-key")
    _FakeOpenAI.next_models_errors = [_status_error(401)]
    _FakeOpenAI.next_models = [{"id": "m1", "name": "Model One"}]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1", "typed-key")
    assert result["status"] == "ok"
    assert len(_FakeOpenAI.instances) == 2
    assert _FakeOpenAI.instances[1].kwargs["api_key"] == "typed-key"


def test_discover_404_returns_unsupported_without_retry(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    monkeypatch.setattr(sll, "_stored_lightllm_api_key", lambda: "stored-key")
    _FakeOpenAI.next_models_errors = [_status_error(404)]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1")
    assert result == {"status": "unsupported", "models": []}
    assert len(_FakeOpenAI.instances) == 1  # no keyed retry on 404


def test_discover_connection_error_returns_sanitized_error(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    _FakeOpenAI.next_models_errors = [APIConnectionError(request=MagicMock())]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1", "my-secret-key")
    assert result["status"] == "error"
    assert result["models"] == []
    assert "my-secret-key" not in result["detail"]
    assert result["detail"] == "Connection to the LightLLM server failed"


def test_discover_http_500_returns_sanitized_error(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    _FakeOpenAI.next_models_errors = [_status_error(500)]
    result = sll.discover_lightllm_models("openai_compatible", "http://localhost:8000/v1", "my-secret-key")
    assert result["status"] == "error"
    assert "my-secret-key" not in result["detail"]
    assert result["detail"] == "The server returned HTTP 500"


def test_discover_custom_provider_no_network(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    result = sll.discover_lightllm_models("custom", "http://localhost:8000/v1")
    assert result == {"status": "unsupported", "models": []}
    assert _FakeOpenAI.instances == []


def test_discover_unknown_provider_no_network(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    result = sll.discover_lightllm_models("ollama", "http://localhost:8000/v1")
    assert result == {"status": "unsupported", "models": []}
    assert _FakeOpenAI.instances == []


def test_discover_blank_base_url_no_network(monkeypatch):
    _reset_fake_openai()
    monkeypatch.setattr("smart_ziw_llm.OpenAI", _FakeOpenAI)
    result = sll.discover_lightllm_models("openai_compatible", "   ")
    assert result["status"] == "error"
    assert result["models"] == []
    assert result["detail"] == "LightLLM base URL is not set"
    assert _FakeOpenAI.instances == []
```

- [ ] **Step 4: Run the suite to verify the new tests fail**

Run: `cd backend && python -m pytest tests/test_smart_ziw_llm.py -q`
Expected: FAIL — the 11 new tests fail with `AttributeError: module 'smart_ziw_llm' has no attribute 'discover_lightllm_models'` (the 9 existing tests still pass).

- [ ] **Step 5: Implement discovery in `backend/smart_ziw_llm.py`**

Change the import on line 17 from:

```python
from openai import OpenAI
```

to:

```python
from openai import APIConnectionError, APITimeoutError, APIStatusError, OpenAI
```

Append at the end of the file:

```python
_LIGHTLLM_DISCOVERY_TIMEOUT = 8.0


def _stored_lightllm_api_key() -> str:
    """Stored LightLLM API key from the admin config; empty on any failure."""
    try:
        from database import get_smart_ziw_config
        return str(get_smart_ziw_config().get("lightllm_api_key") or "")
    except Exception:
        return ""


def _normalize_llm_models(entries) -> list[dict]:
    """Normalize a models listing into [{"id", "name"}] — deduped by id, sorted by name."""
    models: list[dict] = []
    seen: set = set()
    for entry in entries or []:
        if isinstance(entry, str):
            model_id = entry.strip()
            name = ""
        elif isinstance(entry, dict):
            model_id = str(entry.get("id") or "").strip()
            name = str(entry.get("name") or "").strip()
        else:
            continue
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append({"id": model_id, "name": name or model_id})
    models.sort(key=lambda m: (m["name"] or m["id"]).lower())
    return models


def discover_lightllm_models(provider: str, base_url: str, api_key: str = "") -> dict:
    """Discover models on a LightLLM server (OpenAI-compatible).

    Attempts keyless discovery first; on 401/403 retries with the resolved
    key (the provided api_key when non-blank, else the stored
    lightllm_api_key). Returns {"status", "models", ...} with status one of
    ok | no_models | auth_required | unsupported | error. The API key never
    appears in the returned dict.
    """
    if str(provider or "").strip() != "openai_compatible":
        return {"status": "unsupported", "models": []}
    base_url = str(base_url or "").strip()
    if not base_url:
        return {"status": "error", "models": [], "detail": "LightLLM base URL is not set"}
    resolved_key = str(api_key or "").strip() or _stored_lightllm_api_key()
    keys = [_LIGHTLLM_PLACEHOLDER_KEY]
    if resolved_key:
        keys.append(resolved_key)
    for key in keys:
        try:
            client = OpenAI(api_key=key, base_url=base_url, timeout=_LIGHTLLM_DISCOVERY_TIMEOUT)
            listing = client.models.list()
            entries = listing.data if hasattr(listing, "data") else listing
            models = _normalize_llm_models(entries)
            if models:
                return {"status": "ok", "models": models}
            return {"status": "no_models", "models": []}
        except APIStatusError as exc:
            if exc.status_code in (401, 403):
                continue
            if exc.status_code == 404:
                return {"status": "unsupported", "models": []}
            return {"status": "error", "models": [], "detail": f"The server returned HTTP {exc.status_code}"}
        except (APIConnectionError, APITimeoutError):
            return {"status": "error", "models": [], "detail": "Connection to the LightLLM server failed"}
        except Exception:
            return {"status": "error", "models": [], "detail": "Failed to discover models from the LightLLM server"}
    return {"status": "auth_required", "models": []}
```

- [ ] **Step 6: Run the suite to verify all tests pass**

Run: `cd backend && python -m pytest tests/test_smart_ziw_llm.py -q`
Expected: PASS — 20 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/smart_ziw_llm.py backend/tests/test_smart_ziw_llm.py
git commit -m "feat: LightLLM model discovery function"
```

---

### Task 2: Config key + admin discovery endpoints

**Files:**
- Modify: `backend/database.py` (DEFAULT_SMART_ZIW_CONFIG, line ~433-451)
- Modify: `backend/server.py` (SmartZiwConfigUpdate ~1071-1088; import line 81; after the smart-ziw-config endpoints ~1763)
- Test: `backend/tests/test_smart_ziw_server.py`

**Interfaces:**
- Consumes: `discover_lightllm_models(provider, base_url, api_key)` from Task 1.
- Produces (consumed by Task 3):
  - `POST /api/admin/llm-models` — body `{provider: str, base_url: str, api_key: str}` (all optional, defaults `"openai_compatible"`/`""`/`""`); returns the discovery dict verbatim with HTTP 200; 403 for non-admin.
  - `GET /api/admin/llm-env-status` — returns `{"model": str, "api_key_set": bool}` where `model` = `os.environ["DEEPSEEK_MODEL"] or os.environ["DEEPSEEK_WEB_MODEL"] or "deepseek-chat"`; 403 for non-admin.
  - Config key `lightllm_provider` (default `"openai_compatible"`) present in GET/PUT config responses and persisted via the existing whitelist.

- [ ] **Step 1: Add the failing server tests**

Append to `backend/tests/test_smart_ziw_server.py`:

```python
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


def test_llm_models_endpoint_forbidden_for_non_admin(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user())
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"provider": "openai_compatible", "base_url": "http://localhost:8000/v1"})
    assert r.status_code == 403


def test_llm_models_endpoint_returns_discovery_result(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "discover_lightllm_models",
                        lambda provider, base_url, api_key: {"status": "ok", "models": [{"id": "m1", "name": "Model One"}]})
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"provider": "openai_compatible", "base_url": "http://localhost:8000/v1"})
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "models": [{"id": "m1", "name": "Model One"}]}


def test_llm_models_endpoint_forwards_typed_key_and_never_returns_it(monkeypatch):
    captured = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())

    def fake_discover(provider, base_url, api_key):
        captured["provider"] = provider
        captured["base_url"] = base_url
        captured["api_key"] = api_key
        return {"status": "auth_required", "models": []}

    monkeypatch.setattr(server, "discover_lightllm_models", fake_discover)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={
        "provider": "openai_compatible",
        "base_url": "http://localhost:8000/v1",
        "api_key": "TYPED-SECRET",
    })
    assert r.status_code == 200
    assert captured["api_key"] == "TYPED-SECRET"
    assert captured["base_url"] == "http://localhost:8000/v1"
    assert "TYPED-SECRET" not in r.text


def test_llm_models_endpoint_passes_blank_key_through(monkeypatch):
    captured = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())

    def fake_discover(provider, base_url, api_key):
        captured["api_key"] = api_key
        return {"status": "unsupported", "models": []}

    monkeypatch.setattr(server, "discover_lightllm_models", fake_discover)
    client = TestClient(server.app)
    r = client.post("/api/admin/llm-models", json={"provider": "custom", "base_url": ""})
    assert r.status_code == 200
    assert captured["api_key"] == ""


def test_llm_env_status_returns_model_and_bool_only(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-x")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "SUPER-SECRET")
    monkeypatch.delenv("DEEPSEEK_WEB_MODEL", raising=False)
    client = TestClient(server.app)
    r = client.get("/api/admin/llm-env-status")
    assert r.status_code == 200
    assert r.json() == {"model": "deepseek-x", "api_key_set": True}
    assert "SUPER-SECRET" not in r.text


def test_llm_env_status_defaults_without_env_vars(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.delenv("DEEPSEEK_MODEL", raising=False)
    monkeypatch.delenv("DEEPSEEK_WEB_MODEL", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    client = TestClient(server.app)
    r = client.get("/api/admin/llm-env-status")
    assert r.status_code == 200
    assert r.json() == {"model": "deepseek-chat", "api_key_set": False}


def test_llm_env_status_forbidden_for_non_admin(monkeypatch):
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_user())
    client = TestClient(server.app)
    r = client.get("/api/admin/llm-env-status")
    assert r.status_code == 403


def test_admin_update_defaults_lightllm_provider(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"firecrawl_api_key": ""})
    assert r.status_code == 200
    assert saved["lightllm_provider"] == "openai_compatible"


def test_admin_update_stores_lightllm_provider(monkeypatch):
    saved = {}
    monkeypatch.setattr(server, "_get_request_user", lambda req: _mk_admin())
    monkeypatch.setattr(server, "get_smart_ziw_config", _config_with_secrets)

    def fake_save(config):
        saved.update(config)
        return config

    monkeypatch.setattr(server, "save_smart_ziw_config", fake_save)
    client = TestClient(server.app)
    r = client.put("/api/admin/smart-ziw-config", json={"lightllm_provider": "custom"})
    assert r.status_code == 200
    assert saved["lightllm_provider"] == "custom"
```

- [ ] **Step 2: Run the server suite to verify the new tests fail**

Run: `cd backend && python -m pytest tests/test_smart_ziw_server.py -q`
Expected: FAIL — 9 failures (404 Not Found on the six new-endpoint tests; the two `lightllm_provider` PUT tests fail because pydantic drops the unknown field). The 6 existing tests still pass.

- [ ] **Step 3: Add the config key to `backend/database.py`**

In `DEFAULT_SMART_ZIW_CONFIG` (line ~433), after the line:

```python
    'lightllm_model': 'default',
```

insert:

```python
    'lightllm_provider': 'openai_compatible',
```

- [ ] **Step 4: Add the config field and endpoints to `backend/server.py`**

4a. In `SmartZiwConfigUpdate` (line ~1071-1088), after the line:

```python
    lightllm_model: str = "default"
```

insert:

```python
    lightllm_provider: str = "openai_compatible"
```

4b. Directly after the `SmartZiwConfigUpdate` class (before `class SavedSearchItem`), insert:

```python
class LlmModelsRequest(BaseModel):
    provider: str = "openai_compatible"
    base_url: str = ""
    api_key: str = ""
```

4c. Change the import on line 81 from:

```python
from smart_ziw_llm import get_llm_call
```

to:

```python
from smart_ziw_llm import discover_lightllm_models, get_llm_call
```

4d. After the `admin_update_smart_ziw_config` function (line ~1763, before `@app.get("/api/download")`), insert:

```python
@app.post("/api/admin/llm-models")
def admin_discover_llm_models(body: LlmModelsRequest, request: Request):
    _require_admin(request)
    return discover_lightllm_models(body.provider, body.base_url, body.api_key)


@app.get("/api/admin/llm-env-status")
def admin_llm_env_status(request: Request):
    _require_admin(request)
    model = os.environ.get("DEEPSEEK_MODEL") or os.environ.get("DEEPSEEK_WEB_MODEL") or "deepseek-chat"
    return {"model": model, "api_key_set": bool(os.environ.get("DEEPSEEK_API_KEY"))}
```

(`os` is already imported at server.py line 9.)

- [ ] **Step 5: Run the server suite to verify all tests pass**

Run: `cd backend && python -m pytest tests/test_smart_ziw_server.py -q`
Expected: PASS — 15 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/database.py backend/server.py backend/tests/test_smart_ziw_server.py
git commit -m "feat: llm-models discovery and llm-env-status admin endpoints"
```

---

### Task 3: Frontend LLM Provider panel rework

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles/app-shell.css`

**Interfaces:**
- Consumes: `POST /api/admin/llm-models` (returns `{status, models, detail}`), `GET /api/admin/llm-env-status` (returns `{model, api_key_set}`), config key `lightllm_provider` in GET/PUT responses (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Bump the version and add the release note**

In `frontend/src/App.jsx`, change line 19:

```jsx
const APP_RELEASE_VERSION = '1.5';
```

to:

```jsx
const APP_RELEASE_VERSION = '1.6';
```

Insert a new release-note entry as the first item of `DEFAULT_RELEASE_NOTES` (right after `const DEFAULT_RELEASE_NOTES = [` and before the `version: '1.5'` entry):

```jsx
    {
        version: '1.6',
        title: 'Simplified LLM Provider configuration',
        summary: 'Choose between environment or LightLLM configuration with a click, and discover available models automatically from your LightLLM server.',
        items: [
            'LLM provider settings now use a simple Environment / LightLLM choice.',
            'Models are discovered automatically from your LightLLM server — no need to know model names.',
            'The environment configuration now shows which model and API key are in use.',
        ],
    },
```

- [ ] **Step 2: Add the config key and discovery state**

2a. In the `smartZiwConfig` useState initial value (line ~1994), after:

```jsx
        lightllm_model: 'default',
```

insert:

```jsx
        lightllm_provider: 'openai_compatible',
```

2b. Directly after the `const [savingSmartZiwConfig, setSavingSmartZiwConfig] = useState(false);` line (~1996), insert:

```jsx
    const llmSource = smartZiwConfig.smart_ziw_llm_provider === 'lightllm' ? 'lightllm'
        : smartZiwConfig.smart_ziw_llm_provider === 'deepseek' ? 'environment'
        : (smartZiwConfig.lightllm_base_url.trim() ? 'lightllm' : 'environment');
    const llmDiscoverySeq = useRef(0);
    const [llmModels, setLlmModels] = useState({ status: 'idle', models: [], detail: null });
    const [llmModelsLoading, setLlmModelsLoading] = useState(false);
    const [llmEnvStatus, setLlmEnvStatus] = useState({ model: '', api_key_set: false });
```

- [ ] **Step 3: Add the discovery and env-status handlers**

Insert directly after the `loadSmartZiwConfig` useCallback block (ends ~line 2030 with `}, [apiFetch]);`) and before the `useEffect(() => { loadUsers(); }, [loadUsers]);` block:

```jsx
    const discoverLlmModels = useCallback(async (provider, baseUrl, apiKey) => {
        const seq = ++llmDiscoverySeq.current;
        setLlmModelsLoading(true);
        setLlmModels({ status: 'loading', models: [], detail: null });
        try {
            const res = await apiFetch('/api/admin/llm-models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, base_url: baseUrl, api_key: apiKey || '' }),
            });
            const data = res.ok ? await res.json() : { status: 'error', models: [], detail: null };
            if (seq === llmDiscoverySeq.current) {
                setLlmModels({ status: data?.status || 'error', models: Array.isArray(data?.models) ? data.models : [], detail: data?.detail || null });
            }
        } catch (error) {
            if (seq === llmDiscoverySeq.current) {
                setLlmModels({ status: 'error', models: [], detail: null });
            }
        } finally {
            if (seq === llmDiscoverySeq.current) setLlmModelsLoading(false);
        }
    }, [apiFetch]);

    useEffect(() => {
        if (adminTab !== 'llm') return;
        if (llmSource !== 'lightllm' || smartZiwConfig.lightllm_provider !== 'openai_compatible' || !smartZiwConfig.lightllm_base_url.trim()) {
            setLlmModels({ status: 'idle', models: [], detail: null });
            return;
        }
        discoverLlmModels(smartZiwConfig.lightllm_provider, smartZiwConfig.lightllm_base_url, smartZiwConfig.lightllm_api_key);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [adminTab, llmSource, smartZiwConfig.lightllm_provider]);

    useEffect(() => {
        if (adminTab !== 'llm') return;
        let cancelled = false;
        apiFetch('/api/admin/llm-env-status')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (data && !cancelled) setLlmEnvStatus({ model: data.model || '', api_key_set: !!data.api_key_set });
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [adminTab, apiFetch]);
```

- [ ] **Step 4: Clear the API key field after a successful save**

In `saveSmartZiwConfig` (~line 2056), change:

```jsx
            setSmartZiwConfig((prev) => ({ ...prev, ...data, gitlab_token: prev.gitlab_token, firecrawl_api_key: prev.firecrawl_api_key, lightllm_api_key: prev.lightllm_api_key }));
```

to:

```jsx
            setSmartZiwConfig((prev) => ({ ...prev, ...data, gitlab_token: prev.gitlab_token, firecrawl_api_key: prev.firecrawl_api_key, lightllm_api_key: '' }));
```

- [ ] **Step 5: Replace the LLM Provider panel**

Replace the entire existing panel block in `frontend/src/App.jsx` — from `{adminTab === 'llm' ? (` (line ~2612) through its closing `) : null}` (line ~2649) — with:

```jsx
            {adminTab === 'llm' ? (
                <div className="panel-card">
                    <div className="profile-card-head">
                        <div>
                            <h3>LLM Provider</h3>
                            <p className="profile-card-description">Configure the LLM backend used by the Smart-Ziw agent.</p>
                        </div>
                    </div>
                    {message ? <div className="admin-users-message">{message}</div> : null}
                    <div className="profile-settings-grid">
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">Configuration source</label>
                            <div className="llm-source-options">
                                <label className="llm-source-option">
                                    <input type="radio" name="llm-source" checked={llmSource === 'environment'} onChange={() => { llmDiscoverySeq.current += 1; setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_llm_provider: 'deepseek' }); }} />
                                    <span>
                                        <strong>Environment (.env)</strong>
                                        <em>Use the DeepSeek settings from the backend .env file.</em>
                                    </span>
                                </label>
                                <label className="llm-source-option">
                                    <input type="radio" name="llm-source" checked={llmSource === 'lightllm'} onChange={() => { llmDiscoverySeq.current += 1; setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_llm_provider: 'lightllm' }); }} />
                                    <span>
                                        <strong>LightLLM</strong>
                                        <em>Use your own OpenAI-compatible LightLLM server.</em>
                                    </span>
                                </label>
                            </div>
                        </div>
                        {llmSource === 'environment' ? (
                            <div className="auth-field profile-field-span-2">
                                <label className="auth-label">Environment configuration</label>
                                <p className="llm-env-info">
                                    {llmEnvStatus.model
                                        ? <>Using model <code>{llmEnvStatus.model}</code> from environment configuration ({llmEnvStatus.api_key_set ? 'API key set' : 'no API key set'}). To change these values, edit the .env file on the server and restart the backend.</>
                                        : 'Loading environment status…'}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="auth-field profile-field-span-2">
                                    <label className="auth-label">LightLLM base URL</label>
                                    <input className="auth-input" value={smartZiwConfig.lightllm_base_url} onChange={(e) => { llmDiscoverySeq.current += 1; setSmartZiwConfig({ ...smartZiwConfig, lightllm_base_url: e.target.value }); }} placeholder="http://localhost:8000/v1" />
                                </div>
                                <div className="auth-field">
                                    <label className="auth-label">LightLLM API key</label>
                                    <input className="auth-input" type="password" value={smartZiwConfig.lightllm_api_key} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_api_key: e.target.value })} placeholder="Leave blank to keep the stored key" />
                                </div>
                                <div className="auth-field">
                                    <label className="auth-label">Provider (server type)</label>
                                    <select className="auth-input" value={smartZiwConfig.lightllm_provider} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_provider: e.target.value })}>
                                        <option value="openai_compatible">OpenAI-compatible</option>
                                        <option value="custom">Custom (enter model manually)</option>
                                    </select>
                                </div>
                                <div className="auth-field profile-field-span-2">
                                    <label className="auth-label">LightLLM model</label>
                                    {smartZiwConfig.lightllm_provider === 'openai_compatible' && llmModels.status === 'ok' ? (
                                        <select className="auth-input" value={smartZiwConfig.lightllm_model} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_model: e.target.value })}>
                                            {!llmModels.models.some((m) => m.id === smartZiwConfig.lightllm_model) && smartZiwConfig.lightllm_model ? (
                                                <option value={smartZiwConfig.lightllm_model}>{smartZiwConfig.lightllm_model} (current)</option>
                                            ) : null}
                                            {llmModels.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    ) : (
                                        <input className="auth-input" value={smartZiwConfig.lightllm_model} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_model: e.target.value })} />
                                    )}
                                    <p className="llm-models-status">
                                        {llmModels.status === 'loading' ? 'Loading available models…'
                                            : llmModels.status === 'ok' ? 'Models loaded.'
                                            : llmModels.status === 'no_models' ? 'No models available from this server. You can type the model name manually.'
                                            : llmModels.status === 'auth_required' ? 'This provider requires an API key to retrieve available models. Enter the API key and refresh.'
                                            : llmModels.status === 'unsupported' ? 'This provider does not support automatic model discovery. Enter the model name manually.'
                                            : llmModels.status === 'error' ? (llmModels.detail || 'Unable to connect to the LightLLM server. Check the base URL.')
                                            : ''}
                                    </p>
                                    <button type="button" className="profile-btn" onClick={() => discoverLlmModels(smartZiwConfig.lightllm_provider, smartZiwConfig.lightllm_base_url, smartZiwConfig.lightllm_api_key)} disabled={llmModelsLoading || smartZiwConfig.lightllm_provider === 'custom' || !smartZiwConfig.lightllm_base_url.trim()}>
                                        Refresh models
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="profile-card-footer profile-card-footer-end">
                        <button type="button" className="profile-btn profile-btn-primary" onClick={saveSmartZiwConfig} disabled={savingSmartZiwConfig}>
                            {savingSmartZiwConfig ? 'Saving...' : 'Save config'}
                        </button>
                    </div>
                </div>
            ) : null}
```

- [ ] **Step 6: Add the panel CSS**

Append at the end of `frontend/src/styles/app-shell.css`:

```css
.llm-source-options { display: flex; flex-direction: column; gap: 10px; }
.llm-source-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
}
.llm-source-option input { margin-top: 3px; accent-color: #1f7bf6; }
.llm-source-option strong { display: block; color: var(--text-primary); }
.llm-source-option em { display: block; font-style: normal; color: var(--text-muted); font-size: 0.85rem; }
.llm-env-info { color: var(--text-muted); font-size: 0.9rem; margin: 0; }
.llm-env-info code { color: var(--text-primary); }
.llm-models-status { color: var(--text-muted); font-size: 0.85rem; margin: 6px 0; }
```

- [ ] **Step 7: Build the frontend**

Run: `npm --prefix frontend run build`
Expected: exit 0 (build completes; the two pre-existing warnings are unrelated).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.jsx frontend/src/styles/app-shell.css
git commit -m "feat: simplified LLM Provider admin panel with model discovery"
```

---

### Task 4: Full verification

**Files:** none expected (fix commits only if something fails).

- [ ] **Step 1: Run all five smart-ziw suites**

Run: `cd backend && python -m pytest tests/test_smart_ziw_llm.py tests/test_smart_ziw_agent.py tests/test_smart_ziw_research.py tests/test_smart_ziw_server.py tests/test_smart_ziw_mention.py -q`
Expected: PASS — 115 passed (20 llm + 33 agent + 36 research + 15 server + 11 mention).

- [ ] **Step 2: Rebuild the frontend**

Run: `npm --prefix frontend run build`
Expected: exit 0.

- [ ] **Step 3: Spec checklist sweep** — verify with greps (all must return matches):

```bash
grep -n "discover_lightllm_models" backend/smart_ziw_llm.py backend/server.py
grep -n "llm-models\|llm-env-status" backend/server.py
grep -n "lightllm_provider" backend/database.py backend/server.py frontend/src/App.jsx
grep -n "Configuration source" frontend/src/App.jsx
grep -n "Refresh models" frontend/src/App.jsx
grep -n "requires an API key to retrieve available models" frontend/src/App.jsx
grep -n "does not support automatic model discovery" frontend/src/App.jsx
grep -n "APP_RELEASE_VERSION = '1.6'" frontend/src/App.jsx
```

Also verify the runtime routing is untouched: `git diff <BASE> -- backend/smart_ziw_llm.py` must show NO changes inside `get_llm_call` / `_lightllm_call` / `_call_llm_text` (only the import-line change plus the appended discovery functions).

- [ ] **Step 4: Confirm no stray edits and no new dependencies**

Run: `git status --short` (empty) and `git diff <BASE> -- backend/requirements.txt frontend/package.json` (empty). The only changed files must be the seven listed in File Structure.

- [ ] **Step 5: Report**

Summarize test counts, the commit list (`git log --oneline <BASE>..HEAD`), and reproduce the spec §5 manual verification checklist (environment mode, LightLLM mode, provider selection, dynamic discovery, auth error, connection error, refresh, saving, restore after reload) as the pending live checks that need the user's deployment.
