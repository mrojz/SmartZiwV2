# Smart-Ziw Agent Integration Design

## Goal

Remove the **Deep Dive** feature from Procurement Watch and replace it with a **Smart-Ziw Agent** that turns a tender record into a Smart-Ziw project mirror (markdown files under a dated folder). The agent must also be configurable to push project info and files to a single local GitLab repository, with each tender as a folder inside that repo.

## Scope

### In scope

- Remove Deep Dive from the backend and frontend.
- Add a backend Smart-Ziw agent module that generates markdown project mirrors.
- Add a backend endpoint so any authenticated user can run the agent for a project.
- Add admin settings UI + endpoints for GitLab configuration.
- Push generated/updated folders to a configured GitLab project when enabled.
- Post a summary comment in the project discussion thread after the agent runs.

### Out of scope

- Creating a new GitLab project per tender.
- Migrating old Deep Dive comments or status history.
- Support for GitHub push (only local GitLab in this change).
- OCR or download of external tender documents.

## Existing context

- Smart-Ziw repo root: `/home/kali/Smart-Ziw/`
- Smart-Ziw repo is on branch `main` and currently targets `https://github.com/mrojz/Smart-Ziw`.
- Existing Smart-Ziw folders follow the pattern `DDMMYYYY-ClientName-titleRef/` and contain markdown files such as:
  - `tender.md` (structured tender intelligence summary)
  - `email.md` (drafted clarification/request email)
  - `compliance-matrix.md`
  - `drafting-notes.md`
  - `next-actions.md`
  - `recap.md`, `risks.md`, `pricing.md`, `eligibility.md`, `source.md` (when useful)
- `TENDER-MIRROR-TEMPLATE.md` states the minimum mirror is `tender.md` and `email.md`.
- Deep Dive currently lives in:
  - `backend/deep_dive.py`
  - `backend/server.py` endpoint `POST /api/projects/by-db-id/{project_db_id}/deep-dive`
  - `frontend/src/App.jsx` `CommentsPanel` button + status
  - `backend/database.py` deep-dive state helpers

## High-level flow

```text
User clicks "Smart-Ziw Agent" in project inspector
  -> Frontend POST /api/projects/by-db-id/{db_id}/smart-ziw
  -> Backend validates project, updates smart_ziw_status to queued
  -> Background thread runs smart_ziw_agent.run(project)
       1. Build folder name: DDMMYYYY-clientName-titleRef
       2. Write/update markdown files in local Smart-Ziw path
       3. If GitLab enabled: git add, commit, push
       4. Return result with file list + git status
  -> Backend creates/updates comment summary
  -> Backend updates smart_ziw_status to completed/error
  -> Frontend refreshes project + comments
```

## Backend design

### New module: `backend/smart_ziw_agent.py`

Responsibilities:

- Build a clean, deterministic folder name from tender metadata.
- Render markdown files from tender data + DeepSeek enrichment.
- Write files to the configured local Smart-Ziw repo path.
- Optionally stage, commit, and push to GitLab.

Key functions:

```python
def build_folder_name(project: dict) -> str:
    """Return a name like '13072026-Benin-IS-Security-Audit-Pentest'."""

def run(project: dict, gitlab_config: dict | None = None) -> dict:
    """Generate/update mirror and optionally push to GitLab."""

def _generate_markdown_files(project: dict) -> dict[str, str]:
    """Return filename -> content mapping using DeepSeek where helpful."""

def _push_to_gitlab(local_path: Path, folder_name: str, gitlab_config: dict) -> dict:
    """Commit the folder and push to GitLab via HTTPS + token."""
```

Folder name rules:

- Date: use `project_end_date` (deadline) if available, otherwise current date, formatted as `DDMMYYYY`.
- Client: sanitize `project_sponsor` or `primary_country_name_en`.
- Title: sanitize `project_name` or `project_description`, shortened to ~40 chars.
- Separator: `-`.
- Remove/replace unsafe characters, collapse multiple dashes.

### Markdown generation

Files to generate (all `.md`):

1. **tender.md** — required. Structured overview with table of key fields, source verification, scope, dates, eligibility, practical conclusion.
2. **email.md** — required. Draft clarification email to the buyer.
3. **compliance-matrix.md** — required. Tables of administrative, technical, financial, and submission requirements.
4. **next-actions.md** — required. Action items with priority, owner, deadline, notes.
5. **drafting-notes.md** — optional, generated when enough description exists.
6. **risks.md** — optional, generated for projects with deadline or eligibility uncertainty.
7. **pricing.md** — optional, generated when budget/value info exists.
8. **eligibility.md** — optional, generated when eligibility criteria can be inferred.
9. **source.md** — optional, listing sources and links.
10. **recap.md** — optional, one-page executive recap.

Generation strategy:

- Base fields (title, buyer, country, deadline, budget, source URL, description) come directly from the tender record.
- `tender.md`, `email.md`, `compliance-matrix.md`, and `next-actions.md` are enriched via DeepSeek using concise, structured prompts that request markdown output.
- Optional files are only written when the LLM returns non-empty useful content.
- Keep prompts focused and request citations/uncertainty markers so content mirrors existing Smart-Ziw style.

### GitLab push

Configuration fields (stored in MongoDB config collection under `_type: 'smart_ziw_config'`, with optional env overrides for `SMART_ZIW_REPO_PATH` and `GITLAB_TOKEN`):

| Field | Description |
|-------|-------------|
| `smart_ziw_enabled` | boolean, master toggle for the feature |
| `smart_ziw_repo_path` | local path to the Smart-Ziw repo (default `/home/kali/Smart-Ziw`) |
| `gitlab_push_enabled` | boolean, whether to push automatically |
| `gitlab_url` | GitLab instance base URL |
| `gitlab_token` | personal/project access token |
| `gitlab_project_path` | namespace/project path in GitLab |
| `gitlab_branch` | target branch (default `main`) |
| `gitlab_author_name` | commit author name |
| `gitlab_author_email` | commit author email |

Push behavior:

- If `gitlab_push_enabled` is false, only write locally.
- If true:
  - Ensure the local repo remote points to the GitLab HTTPS URL with token.
  - `git add <folder>/`
  - `git commit -m "smart-ziw: add/update <folder>"` only if there are changes.
  - `git push origin <branch>`
- Use `subprocess.run(["git", ...])` with explicit `cwd=repo_path`.
- Return git stdout/stderr in the result so the UI can show status.

Security:

- Token is stored server-side only (MongoDB config or env var, never sent to frontend).
- Frontend settings UI reads/writes config through admin endpoints; backend redacts the token on read.

### Database changes

Remove Deep Dive fields:

- Drop `deep_dive_status`, `deep_dive_job_id`, `deep_dive_requested_at`, `deep_dive_completed_at`, `deep_dive_requested_by`, `deep_dive_error` from project normalization.
- Remove `update_project_deep_dive_state_by_db_id` from `database.py`.

Add Smart-Ziw fields:

- `smart_ziw_status`: `"" | "queued" | "running" | "completed" | "error"`
- `smart_ziw_job_id`: str
- `smart_ziw_requested_at`: str
- `smart_ziw_completed_at`: str
- `smart_ziw_requested_by`: str
- `smart_ziw_error`: str
- `smart_ziw_folder`: str (the generated folder name)
- `smart_ziw_gitlab_pushed`: bool

Add helper:

```python
def update_project_smart_ziw_state_by_db_id(project_db_id: str, updates: dict) -> dict | None:
```

Add config helpers to `database.py` using a separate config document (`_type: 'smart_ziw_config'`) so the existing `app_config` document is not affected:

```python
def get_smart_ziw_config() -> dict
def save_smart_ziw_config(config: dict) -> dict
```

### API changes

Remove:

- `from deep_dive import run_deep_dive_research`
- `_deep_dive_lock`, `_deep_dive_running`
- `_format_deep_dive_comment`, `_run_project_deep_dive`
- `DeepDiveTriggerRequest` model
- `POST /api/projects/by-db-id/{project_db_id}/deep-dive`

Add:

```python
class SmartZiwTriggerRequest(BaseModel):
    force: bool = False

class SmartZiwConfigUpdate(BaseModel):
    smart_ziw_enabled: bool = True
    smart_ziw_repo_path: str = "/home/kali/Smart-Ziw"
    gitlab_push_enabled: bool = False
    gitlab_url: str = ""
    gitlab_token: str = ""
    gitlab_project_path: str = ""
    gitlab_branch: str = "main"
    gitlab_author_name: str = "Smart-Ziw Agent"
    gitlab_author_email: str = "smart-ziw@localhost"
```

Endpoints:

- `POST /api/projects/by-db-id/{project_db_id}/smart-ziw` — any authenticated user.
- `GET /api/admin/smart-ziw-config` — admin only; returns config with `gitlab_token` redacted.
- `PUT /api/admin/smart-ziw-config` — admin only.

Threading:

- Same pattern as Deep Dive: lock + set to prevent duplicate runs; background thread calls `smart_ziw_agent.run`.

### Comment summary format

After successful run, post a comment from `bot:smart-ziw`:

```markdown
Smart-Ziw Agent

Generated mirror: `<folder>/`
Local path: `<repo_path>/<folder>/`
GitLab push: enabled / disabled / pushed
Files: tender.md, email.md, compliance-matrix.md, next-actions.md ...
```

On error, post the error message.

## Frontend design

### Project inspector changes

In `frontend/src/App.jsx` `CommentsPanel`:

- Replace `runningDeepDive` state with `runningSmartZiw`.
- Replace button label: `Smart-Ziw Agent` (running: `Generating...`).
- Replace status text and CSS class references.
- Call `POST /api/projects/by-db-id/{db_id}/smart-ziw` instead of `/deep-dive`.
- Remove Deep Dive-specific styles from `app-shell.css` and add equivalent `smart-ziw` status classes.

### Settings / Admin changes

Add a new section accessible from the Admin page (or a new Settings modal):

- Toggle: Enable Smart-Ziw Agent
- Text: Local repo path
- Toggle: Enable GitLab push
- Text: GitLab URL
- Password/token input: GitLab token (write-only from UI perspective)
- Text: GitLab project path
- Text: GitLab branch
- Text: Commit author name
- Text: Commit author email
- Save button

The UI should redact the token on load and only send it when changed.

### Release notes

Add a release note for version 1.3:

- Replaced Deep Dive with Smart-Ziw Agent.
- Added configurable GitLab push for Smart-Ziw project mirrors.

## Error handling

- Missing DeepSeek API key: status `error`, message shown in UI.
- Invalid GitLab config when push enabled: status `error`, files still generated locally.
- Git push failure: status `error`, local files kept, error message includes git stderr.
- Duplicate run: return `alreadyRunning: true` like Deep Dive did.

## Testing plan

1. Run backend locally with MongoDB.
2. Open a project and click **Smart-Ziw Agent**.
3. Verify folder created under configured repo path with expected markdown files.
4. Verify discussion comment posted.
5. Enable GitLab push, configure a local GitLab project, and verify push.
6. Verify old Deep Dive button is gone and no Deep Dive endpoints remain.
7. Verify admin can save/read settings.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| LLM output varies between runs | Use structured prompts, temperature 0.1, deterministic folder naming. |
| GitLab token exposure | Store server-side, redact in API responses. |
| Existing Smart-Ziw repo conflicts | Commit only the generated folder, use explicit author/config. |
| Large prompts costs | Keep prompts concise; reuse existing project metadata. |

## Open questions

None remaining; user confirmed:

- Use same markdown files as existing Smart-Ziw folders.
- New settings UI for GitLab configuration.
- Push automatically once user opts in via toggle.
- All tenders go to the same GitLab project as folders.
- Any authenticated user can trigger the agent.
- Keep DeepSeek for LLM enrichment.
