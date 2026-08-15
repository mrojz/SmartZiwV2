# Smart-Ziw Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Deep Dive feature with a Smart-Ziw agent that generates markdown project mirrors and optionally pushes them to a configured local GitLab repository.

**Architecture:** A new `backend/smart_ziw_agent.py` module generates dated tender folders and markdown files using DeepSeek enrichment. The backend exposes a project-scoped endpoint for any authenticated user and admin endpoints for GitLab configuration. The frontend replaces the Deep Dive button with a Smart-Ziw button and adds an admin settings section.

**Tech Stack:** Python 3.11+, FastAPI, MongoDB/PyMongo, DeepSeek/OpenAI client, Git CLI via subprocess, React 18, CSS.

**Spec:** `/home/kali/smartZiw/eProcScraper/docs/superpowers/specs/2026-08-14-smart-ziw-integration-design.md`

## Global Constraints

- Keep DeepSeek as the LLM provider; reuse `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL` from `.env`.
- Any authenticated user may trigger the agent.
- Each tender becomes a folder inside a single GitLab project.
- Markdown files must match existing Smart-Ziw repo conventions (`tender.md`, `email.md`, `compliance-matrix.md`, `next-actions.md`, etc.).
- GitLab token must never be returned to the frontend.
- All changes must preserve existing auth and CORS behavior.

---

## File Map

- **Create:** `backend/smart_ziw_agent.py` — folder naming, markdown rendering, LLM calls, GitLab push.
- **Create:** `backend/tests/test_smart_ziw_agent.py` — unit tests for folder naming and markdown rendering.
- **Modify:** `backend/database.py` — remove Deep Dive fields/helpers, add Smart-Ziw state and config helpers.
- **Modify:** `backend/server.py` — remove Deep Dive endpoint/code, add Smart-Ziw endpoint and admin config endpoints.
- **Modify:** `frontend/src/App.jsx` — replace Deep Dive UI with Smart-Ziw UI, add admin settings section.
- **Modify:** `frontend/src/styles/app-shell.css` — replace Deep Dive status styles with Smart-Ziw status styles.

---

### Task 1: Scaffold `smart_ziw_agent.py` with folder naming and base markdown rendering

**Files:**
- Create: `backend/smart_ziw_agent.py`
- Test: `backend/tests/test_smart_ziw_agent.py`

**Interfaces:**
- Consumes: project dict with keys `project_name`, `project_description`, `project_sponsor`, `primary_country_name_en`, `project_end_date`, `project_url`, `source`, `project_id`.
- Produces: `build_folder_name(project) -> str`, `render_tender_markdown(project) -> str`, `render_email_markdown(project) -> str`, `run(project, config) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_smart_ziw_agent.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_agent import build_folder_name, render_tender_markdown, render_email_markdown


def test_build_folder_name():
    project = {
        "project_name": "Recruitment Of An IS Security Audit Firm",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_id": "GT-138132049",
        "project_url": "https://example.com/tender",
        "source": "Global Tenders",
        "project_description": "IS Security Audit and Pentesting",
    }
    name = build_folder_name(project)
    assert name == "13072026-Benin-IS-Security-Audit-Firm"


def test_render_tender_markdown_contains_title():
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_url": "https://example.com/tender",
        "source": "Global Tenders",
        "project_description": "Audit and pentesting.",
    }
    md = render_tender_markdown(project)
    assert "IS Security Audit" in md
    assert "CDC Benin" in md
    assert "https://example.com/tender" in md


def test_render_email_markdown_contains_draft_email():
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_url": "https://example.com/tender",
        "source": "Global Tenders",
        "project_description": "Audit and pentesting.",
    }
    md = render_email_markdown(project)
    assert "CDC Benin" in md
    assert "IS Security Audit" in md
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /home/kali/smartZiw/eProcScraper/backend
python -m pytest tests/test_smart_ziw_agent.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'smart_ziw_agent'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/smart_ziw_agent.py
import os
import re
from datetime import datetime
from pathlib import Path


def _safe_slug(text: str, max_len: int = 40) -> str:
    text = re.sub(r"[^\w\s-]", "", text or "")
    text = re.sub(r"[-\s]+", "-", text).strip("-")
    return text[:max_len].strip("-")


def _format_date_for_folder(value: str) -> str:
    if not value:
        return datetime.now().strftime("%d%m%Y")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.strftime("%d%m%Y")
    except Exception:
        pass
    try:
        dt = datetime.strptime(value, "%Y-%m-%d")
        return dt.strftime("%d%m%Y")
    except Exception:
        pass
    return datetime.now().strftime("%d%m%Y")


def build_folder_name(project: dict) -> str:
    deadline = _format_date_for_folder(project.get("project_end_date") or project.get("effective_deadline") or "")
    client = _safe_slug(project.get("project_sponsor") or project.get("primary_country_name_en") or "Unknown")
    title = _safe_slug(project.get("project_name") or project.get("project_description") or "Tender")
    parts = [p for p in [deadline, client, title] if p]
    return "-".join(parts)


def render_tender_markdown(project: dict) -> str:
    lines = [
        f"# Tender Intelligence: {project.get('project_name') or 'Untitled'}",
        "",
        "## Overview",
        "",
        "| Field | Detail |",
        "|-------|--------|",
        f"| **Tender Title** | {project.get('project_name') or '-'} |",
        f"| **Buyer** | {project.get('project_sponsor') or '-'} |",
        f"| **Country** | {project.get('primary_country_name_en') or '-'} |",
        f"| **Deadline** | {project.get('project_end_date') or '-'} |",
        f"| **Source** | {project.get('source') or '-'} |",
        f"| **Source URL** | {project.get('project_url') or '-'} |",
        "",
        "## Description",
        "",
        project.get("project_description") or "No description available.",
    ]
    return "\n".join(lines)


def render_email_markdown(project: dict) -> str:
    buyer = project.get("project_sponsor") or project.get("primary_country_name_en") or "the buyer"
    title = project.get("project_name") or "the tender"
    lines = [
        f"# Draft Clarification Email: {title}",
        "",
        f"**To:** procurement@{buyer.lower().replace(' ', '')}.com",
        "**Subject:** Request for clarification - ",
        "",
        f"Dear {buyer} Procurement Team,",
        "",
        f"We are interested in submitting a proposal for **{title}**. Could you please confirm the following:",
        "",
        "1. Submission format and number of copies required.",
        "2. Eligibility criteria and required certifications.",
        "3. Bid bond amount and validity period.",
        "4. Evaluation criteria weighting.",
        "",
        "Thank you for your assistance.",
        "",
        "Best regards,",
    ]
    return "\n".join(lines)


def run(project: dict, config: dict | None = None) -> dict:
    folder = build_folder_name(project)
    return {
        "folder": folder,
        "files": ["tender.md", "email.md"],
        "repo_path": (config or {}).get("smart_ziw_repo_path", "/home/kali/Smart-Ziw"),
        "gitlab_pushed": False,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /home/kali/smartZiw/eProcScraper/backend
python -m pytest tests/test_smart_ziw_agent.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kali/smartZiw/eProcScraper
git add backend/smart_ziw_agent.py backend/tests/test_smart_ziw_agent.py
git commit -m "feat(smart-ziw): scaffold agent with folder naming and base markdown"
```

---

### Task 2: Add DeepSeek enrichment for all required markdown files

**Files:**
- Modify: `backend/smart_ziw_agent.py`
- Test: `backend/tests/test_smart_ziw_agent.py`

**Interfaces:**
- Consumes: project dict; env vars `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`.
- Produces: `_deepseek_client()`, `_call_llm(prompt) -> str`, `_enrich(project) -> dict`, `render_compliance_matrix_markdown(project, enrichment) -> str`, `render_next_actions_markdown(project, enrichment) -> str`, `render_optional_files(project, enrichment) -> dict[str, str]`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_smart_ziw_agent.py`:

```python
def test_render_compliance_matrix_has_table():
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_url": "https://example.com/tender",
        "source": "Global Tenders",
        "project_description": "Audit and pentesting.",
    }
    enrichment = {
        "compliance_matrix": [
            {"requirement": "ISO 27001 cert", "status": "Assumed required", "evidence": "Team certs", "owner": "Technical", "notes": "Standard"},
        ]
    }
    md = render_compliance_matrix_markdown(project, enrichment)
    assert "ISO 27001 cert" in md
    assert "Assumed required" in md


def test_render_next_actions_has_actions():
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
    }
    enrichment = {
        "next_actions": [
            {"action": "Obtain DCE", "priority": "CRITICAL", "owner": "Commercial", "deadline": "This week", "notes": "Contact buyer"},
        ]
    }
    md = render_next_actions_markdown(project, enrichment)
    assert "Obtain DCE" in md
    assert "CRITICAL" in md
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL with `render_compliance_matrix_markdown` not defined.

- [ ] **Step 3: Write implementation**

Add to `backend/smart_ziw_agent.py`:

```python
import json
import re
from openai import OpenAI


def _deepseek_client():
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")
    return OpenAI(api_key=api_key, base_url=base_url)


def _safe_json_loads(content: str) -> dict:
    text = (content or "").strip()
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return {}
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}


def _call_llm(system_prompt: str, user_prompt: str) -> dict:
    client = _deepseek_client()
    model = os.environ.get("DEEPSEEK_MODEL", os.environ.get("DEEPSEEK_WEB_MODEL", "deepseek-chat"))
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
        max_tokens=2000,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    return _safe_json_loads(content)


ENRICH_PROMPT = """You are a tender intelligence assistant.
Given tender metadata, return JSON with these keys:
- "compliance_matrix": list of objects with keys requirement, status, evidence_needed, owner, notes.
- "next_actions": list of objects with keys action, priority, owner, deadline, notes.
- "risks": list of objects with keys risk, likelihood, impact, mitigation (only if uncertainty exists; otherwise empty list).
- "eligibility_notes": string with eligibility summary.
- "source_notes": string summarizing source reliability.
- "pricing_notes": string with budget/value assessment.
Keep each list concise (max 8 items). Mark uncertain items clearly."""


def _enrich(project: dict) -> dict:
    user_prompt = "\n".join([
        f"Tender name: {project.get('project_name') or ''}",
        f"Buyer: {project.get('project_sponsor') or ''}",
        f"Country: {project.get('primary_country_name_en') or ''}",
        f"Deadline: {project.get('project_end_date') or project.get('effective_deadline') or ''}",
        f"Source: {project.get('source') or ''}",
        f"Source URL: {project.get('project_url') or ''}",
        f"Description: {project.get('project_description') or ''}",
    ])
    result = _call_llm(ENRICH_PROMPT, user_prompt)
    return {
        "compliance_matrix": result.get("compliance_matrix") or [],
        "next_actions": result.get("next_actions") or [],
        "risks": result.get("risks") or [],
        "eligibility_notes": str(result.get("eligibility_notes") or "").strip(),
        "source_notes": str(result.get("source_notes") or "").strip(),
        "pricing_notes": str(result.get("pricing_notes") or "").strip(),
    }


def render_compliance_matrix_markdown(project: dict, enrichment: dict) -> str:
    title = project.get("project_name") or "Tender"
    lines = [f"# Compliance Matrix: {title}", ""]
    rows = enrichment.get("compliance_matrix") or []
    if not rows:
        lines.append("No compliance items identified.")
        return "\n".join(lines)
    lines.extend(["| Requirement | Status | Evidence Needed | Owner | Notes |", "|-------------|--------|-----------------|-------|-------|"])
    for row in rows:
        lines.append(f"| {row.get('requirement', '-')} | {row.get('status', '-')} | {row.get('evidence_needed', row.get('evidence', '-'))} | {row.get('owner', '-')} | {row.get('notes', '-')} |")
    return "\n".join(lines)


def render_next_actions_markdown(project: dict, enrichment: dict) -> str:
    title = project.get("project_name") or "Tender"
    lines = [f"# Next Actions: {title}", ""]
    rows = enrichment.get("next_actions") or []
    if not rows:
        lines.append("No next actions identified.")
        return "\n".join(lines)
    lines.extend(["| Action | Priority | Owner | Deadline | Notes |", "|--------|----------|-------|----------|-------|"])
    for row in rows:
        lines.append(f"| {row.get('action', '-')} | {row.get('priority', '-')} | {row.get('owner', '-')} | {row.get('deadline', '-')} | {row.get('notes', '-')} |")
    return "\n".join(lines)


def render_risks_markdown(project: dict, enrichment: dict) -> str:
    title = project.get("project_name") or "Tender"
    rows = enrichment.get("risks") or []
    if not rows:
        return ""
    lines = [f"# Risks: {title}", "", "| Risk | Likelihood | Impact | Mitigation |", "|------|------------|--------|------------|"]
    for row in rows:
        lines.append(f"| {row.get('risk', '-')} | {row.get('likelihood', '-')} | {row.get('impact', '-')} | {row.get('mitigation', '-')} |")
    return "\n".join(lines)


def render_eligibility_markdown(project: dict, enrichment: dict) -> str:
    notes = enrichment.get("eligibility_notes", "")
    if not notes:
        return ""
    title = project.get("project_name") or "Tender"
    return f"# Eligibility: {title}\n\n{notes}"


def render_source_markdown(project: dict, enrichment: dict) -> str:
    notes = enrichment.get("source_notes", "")
    if not notes:
        return ""
    title = project.get("project_name") or "Tender"
    return f"# Source Notes: {title}\n\n{notes}"


def render_pricing_markdown(project: dict, enrichment: dict) -> str:
    notes = enrichment.get("pricing_notes", "")
    if not notes:
        return ""
    title = project.get("project_name") or "Tender"
    return f"# Pricing Notes: {title}\n\n{notes}"


def render_optional_files(project: dict, enrichment: dict) -> dict[str, str]:
    files = {}
    risks = render_risks_markdown(project, enrichment)
    if risks:
        files["risks.md"] = risks
    eligibility = render_eligibility_markdown(project, enrichment)
    if eligibility:
        files["eligibility.md"] = eligibility
    source = render_source_markdown(project, enrichment)
    if source:
        files["source.md"] = source
    pricing = render_pricing_markdown(project, enrichment)
    if pricing:
        files["pricing.md"] = pricing
    return files
```

Update `run()` to generate files:

```python
def run(project: dict, config: dict | None = None) -> dict:
    config = config or {}
    folder = build_folder_name(project)
    enrichment = _enrich(project)
    files = {
        "tender.md": render_tender_markdown(project),
        "email.md": render_email_markdown(project),
        "compliance-matrix.md": render_compliance_matrix_markdown(project, enrichment),
        "next-actions.md": render_next_actions_markdown(project, enrichment),
    }
    files.update(render_optional_files(project, enrichment))
    repo_path = Path(config.get("smart_ziw_repo_path", "/home/kali/Smart-Ziw"))
    folder_path = repo_path / folder
    folder_path.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (folder_path / name).write_text(content, encoding="utf-8")
    return {
        "folder": folder,
        "files": list(files.keys()),
        "repo_path": str(repo_path),
        "gitlab_pushed": False,
    }
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /home/kali/smartZiw/eProcScraper/backend
python -m pytest tests/test_smart_ziw_agent.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kali/smartZiw/eProcScraper
git add backend/smart_ziw_agent.py backend/tests/test_smart_ziw_agent.py
git commit -m "feat(smart-ziw): add DeepSeek enrichment for markdown files"
```

---

### Task 3: Add GitLab push to `smart_ziw_agent.py`

**Files:**
- Modify: `backend/smart_ziw_agent.py`
- Test: `backend/tests/test_smart_ziw_agent.py`

**Interfaces:**
- Consumes: local repo path, folder name, gitlab config dict.
- Produces: `_push_to_gitlab(repo_path, folder, config) -> dict`, updated `run()` returns git status.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_smart_ziw_agent.py`:

```python
from unittest.mock import patch


def test_push_to_gitlab_config_missing_skips():
    result = push_to_gitlab(Path("/tmp/fake"), "folder", {})
    assert result["pushed"] is False
    assert "disabled" in result["message"].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL with `push_to_gitlab` not defined.

- [ ] **Step 3: Write implementation**

Add to `backend/smart_ziw_agent.py`:

```python
import subprocess


def push_to_gitlab(repo_path: Path, folder: str, config: dict) -> dict:
    if not config.get("gitlab_push_enabled"):
        return {"pushed": False, "message": "GitLab push disabled"}
    url = config.get("gitlab_url", "").rstrip("/")
    token = config.get("gitlab_token", "")
    project_path = config.get("gitlab_project_path", "").strip("/")
    branch = config.get("gitlab_branch", "main")
    author_name = config.get("gitlab_author_name", "Smart-Ziw Agent")
    author_email = config.get("gitlab_author_email", "smart-ziw@localhost")
    if not all([url, token, project_path]):
        return {"pushed": False, "message": "GitLab config incomplete"}

    remote_url = f"{url}/api/v4/projects/{project_path.replace('/', '%2F')}"
    git_remote = f"https://oauth2:{token}@{url.replace('https://', '').replace('http://', '')}/{project_path}.git"

    def _git(args, check=True):
        return subprocess.run(
            ["git"] + args,
            cwd=str(repo_path),
            check=check,
            capture_output=True,
            text=True,
        )

    try:
        _git(["remote", "set-url", "origin", git_remote], check=False)
        _git(["config", "user.name", author_name], check=False)
        _git(["config", "user.email", author_email], check=False)
        _git(["add", f"{folder}/"])
        status = _git(["status", "--porcelain"], check=False)
        if not status.stdout.strip():
            return {"pushed": False, "message": "No changes to commit"}
        _git(["commit", "-m", f"smart-ziw: add/update {folder}"])
        push = _git(["push", "origin", branch])
        return {"pushed": True, "message": push.stdout or "Pushed successfully"}
    except subprocess.CalledProcessError as exc:
        return {"pushed": False, "message": f"Git error: {exc.stderr or exc.stdout}"}


def run(project: dict, config: dict | None = None) -> dict:
    config = config or {}
    folder = build_folder_name(project)
    enrichment = _enrich(project)
    files = {
        "tender.md": render_tender_markdown(project),
        "email.md": render_email_markdown(project),
        "compliance-matrix.md": render_compliance_matrix_markdown(project, enrichment),
        "next-actions.md": render_next_actions_markdown(project, enrichment),
    }
    files.update(render_optional_files(project, enrichment))
    repo_path = Path(config.get("smart_ziw_repo_path", "/home/kali/Smart-Ziw"))
    folder_path = repo_path / folder
    folder_path.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (folder_path / name).write_text(content, encoding="utf-8")
    git_result = push_to_gitlab(repo_path, folder, config)
    return {
        "folder": folder,
        "files": list(files.keys()),
        "repo_path": str(repo_path),
        "gitlab_pushed": git_result["pushed"],
        "gitlab_message": git_result["message"],
    }
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /home/kali/smartZiw/eProcScraper/backend
python -m pytest tests/test_smart_ziw_agent.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/kali/smartZiw/eProcScraper
git add backend/smart_ziw_agent.py backend/tests/test_smart_ziw_agent.py
git commit -m "feat(smart-ziw): add configurable GitLab push"
```

---

### Task 4: Update `database.py` — remove Deep Dive, add Smart-Ziw state and config

**Files:**
- Modify: `backend/database.py`

**Interfaces:**
- Consumes: project db_id, Smart-Ziw updates dict, config dict.
- Produces: `update_project_smart_ziw_state_by_db_id`, `get_smart_ziw_config`, `save_smart_ziw_config`; projects no longer expose Deep Dive fields.

- [ ] **Step 1: Modify `_normalize_project`**

Replace Deep Dive lines (98-103):

```python
    doc['smart_ziw_status'] = str(doc.get('smart_ziw_status') or '')
    doc['smart_ziw_job_id'] = str(doc.get('smart_ziw_job_id') or '')
    doc['smart_ziw_requested_at'] = doc.get('smart_ziw_requested_at') or ''
    doc['smart_ziw_completed_at'] = doc.get('smart_ziw_completed_at') or ''
    doc['smart_ziw_requested_by'] = doc.get('smart_ziw_requested_by') or ''
    doc['smart_ziw_error'] = doc.get('smart_ziw_error') or ''
    doc['smart_ziw_folder'] = str(doc.get('smart_ziw_folder') or '')
    doc['smart_ziw_gitlab_pushed'] = bool(doc.get('smart_ziw_gitlab_pushed', False))
```

- [ ] **Step 2: Replace `update_project_deep_dive_state_by_db_id`**

Find the existing function around line 297 and replace with:

```python
def update_project_smart_ziw_state_by_db_id(project_db_id: str, updates: dict) -> dict | None:
    db = get_db()
    oid = _parse_object_id(project_db_id)
    if not oid:
        return None
    allowed = {
        'smart_ziw_status',
        'smart_ziw_job_id',
        'smart_ziw_requested_at',
        'smart_ziw_completed_at',
        'smart_ziw_requested_by',
        'smart_ziw_error',
        'smart_ziw_folder',
        'smart_ziw_gitlab_pushed',
    }
    filtered = {k: v for k, v in updates.items() if k in allowed}
    if not filtered:
        return None
    result = db.projects.find_one_and_update(
        {'_id': oid},
        {'$set': filtered},
        return_document=ReturnDocument.AFTER,
    )
    return _normalize_project(_strip_id(result)) if result else None
```

- [ ] **Step 3: Add Smart-Ziw config helpers**

After `save_config` (line 417), add:

```python
DEFAULT_SMART_ZIW_CONFIG = {
    'smart_ziw_enabled': True,
    'smart_ziw_repo_path': '/home/kali/Smart-Ziw',
    'gitlab_push_enabled': False,
    'gitlab_url': '',
    'gitlab_token': '',
    'gitlab_project_path': '',
    'gitlab_branch': 'main',
    'gitlab_author_name': 'Smart-Ziw Agent',
    'gitlab_author_email': 'smart-ziw@localhost',
}


def get_smart_ziw_config() -> dict:
    db = get_db()
    doc = db.config.find_one({'_type': 'smart_ziw_config'}) or {}
    config = DEFAULT_SMART_ZIW_CONFIG.copy()
    for key in config:
        if key in doc:
            config[key] = doc[key]
    return config


def save_smart_ziw_config(config: dict) -> dict:
    db = get_db()
    cleaned = {k: v for k, v in config.items() if k in DEFAULT_SMART_ZIW_CONFIG}
    db.config.update_one(
        {'_type': 'smart_ziw_config'},
        {'$set': cleaned},
        upsert=True,
    )
    return get_smart_ziw_config()
```

- [ ] **Step 4: Verify backend imports still work**

Run:

```bash
cd /home/kali/smartZiw/eProcScraper/backend
python -c "import database; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
cd /home/kali/smartZiw/eProcScraper
git add backend/database.py
git commit -m "feat(smart-ziw): replace Deep Dive db fields with Smart-Ziw state and config"
```

---

### Task 5: Update `server.py` — remove Deep Dive, add Smart-Ziw endpoints

**Files:**
- Modify: `backend/server.py`

**Interfaces:**
- Consumes: `smart_ziw_agent.run`, `update_project_smart_ziw_state_by_db_id`, `get_smart_ziw_config`, `save_smart_ziw_config`.
- Produces: `POST /api/projects/by-db-id/{project_db_id}/smart-ziw`, `GET /api/admin/smart-ziw-config`, `PUT /api/admin/smart-ziw-config`.

- [ ] **Step 1: Replace imports and remove Deep Dive globals**

Change import block (line 77):

```python
from smart_ziw_agent import run as run_smart_ziw_agent
```

Replace `_deep_dive_lock` and `_deep_dive_running` (lines 123-124):

```python
_smart_ziw_lock = threading.Lock()
_smart_ziw_running: set[str] = set()
```

- [ ] **Step 2: Replace Deep Dive state import**

Change line 41 from `update_project_deep_dive_state_by_db_id` to `update_project_smart_ziw_state_by_db_id`.

- [ ] **Step 3: Remove Deep Dive helper functions**

Delete `_format_deep_dive_comment` (lines 440-462) and `_run_project_deep_dive` (lines 465-510).

- [ ] **Step 4: Add Smart-Ziw runner**

After the removed Deep Dive block, add:

```python
def _format_smart_ziw_comment(result: dict) -> str:
    lines = [
        "Smart-Ziw Agent",
        "",
        f"Generated mirror: `{result.get('folder')}/`",
        f"Local path: `{result.get('repo_path')}/{result.get('folder')}/`",
    ]
    if result.get("gitlab_pushed"):
        lines.append("GitLab push: pushed")
    elif result.get("gitlab_message"):
        lines.append(f"GitLab push: {result.get('gitlab_message')}")
    else:
        lines.append("GitLab push: disabled")
    files = result.get("files") or []
    if files:
        lines.extend(["", "Files:", *[f"- {f}" for f in files]])
    return "\n".join(lines)


def _run_smart_ziw(project_db_id: str, actor_user: dict):
    bot_user = {
        "id": "bot:smart-ziw",
        "name": "Smart-Ziw Bot",
        "email": "",
        "avatarUrl": "",
    }
    try:
        config = get_smart_ziw_config()
        project = update_project_smart_ziw_state_by_db_id(project_db_id, {
            "smart_ziw_status": "running",
            "smart_ziw_error": "",
        })
        if not project:
            return
        result = run_smart_ziw_agent(project, config)
        comment_body = _format_smart_ziw_comment(result)
        _create_project_comment_and_notify(
            entity_type="project",
            entity_id=_project_entity_id(project),
            project=project,
            author_user=bot_user,
            body_text=comment_body,
        )
        update_project_smart_ziw_state_by_db_id(project_db_id, {
            "smart_ziw_status": "completed",
            "smart_ziw_completed_at": now_iso(),
            "smart_ziw_error": "",
            "smart_ziw_folder": result.get("folder", ""),
            "smart_ziw_gitlab_pushed": bool(result.get("gitlab_pushed")),
        })
    except Exception as exc:
        project = get_project_by_db_id(project_db_id)
        if project:
            _create_project_comment_and_notify(
                entity_type="project",
                entity_id=_project_entity_id(project),
                project=project,
                author_user=bot_user,
                body_text=f"Smart-Ziw Agent could not complete.\n\nNotes: {str(exc).strip()}",
            )
        update_project_smart_ziw_state_by_db_id(project_db_id, {
            "smart_ziw_status": "error",
            "smart_ziw_completed_at": now_iso(),
            "smart_ziw_error": str(exc).strip()[:1000],
        })
    finally:
        with _smart_ziw_lock:
            _smart_ziw_running.discard(project_db_id)
```

- [ ] **Step 5: Replace request models and endpoint**

Change `DeepDiveTriggerRequest` to:

```python
class SmartZiwTriggerRequest(BaseModel):
    force: bool = False
```

Add admin config models:

```python
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

Replace the Deep Dive endpoint (lines 1563-1595) with:

```python
@app.post("/api/projects/by-db-id/{project_db_id}/smart-ziw")
def trigger_project_smart_ziw(project_db_id: str, body: SmartZiwTriggerRequest, request: Request):
    project = get_project_by_db_id(project_db_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    with _smart_ziw_lock:
        if project_db_id in _smart_ziw_running and not body.force:
            current = get_project_by_db_id(project_db_id) or project
            return {
                "accepted": True,
                "alreadyRunning": True,
                "jobId": current.get("smart_ziw_job_id") or "",
                "project": _enrich_project_payload(current, current_user_id=request.state.user.get("id")),
            }
        _smart_ziw_running.add(project_db_id)

    job_id = str(uuid.uuid4())
    updated = update_project_smart_ziw_state_by_db_id(project_db_id, {
        "smart_ziw_status": "queued",
        "smart_ziw_job_id": job_id,
        "smart_ziw_requested_at": now_iso(),
        "smart_ziw_completed_at": "",
        "smart_ziw_requested_by": request.state.user.get("email", "") or request.state.user.get("name", ""),
        "smart_ziw_error": "",
    })
    threading.Thread(target=_run_smart_ziw, args=(project_db_id, request.state.user), daemon=True).start()
    return {
        "accepted": True,
        "alreadyRunning": False,
        "jobId": job_id,
        "project": _enrich_project_payload(updated or project, current_user_id=request.state.user.get("id")),
    }


@app.get("/api/admin/smart-ziw-config")
def admin_get_smart_ziw_config(request: Request):
    _require_admin(request)
    config = get_smart_ziw_config()
    config["gitlab_token"] = ""
    return config


@app.put("/api/admin/smart-ziw-config")
def admin_update_smart_ziw_config(body: SmartZiwConfigUpdate, request: Request):
    _require_admin(request)
    data = body.model_dump()
    existing = get_smart_ziw_config()
    if not data.get("gitlab_token"):
        data["gitlab_token"] = existing.get("gitlab_token", "")
    saved = save_smart_ziw_config(data)
    saved["gitlab_token"] = ""
    return saved
```

- [ ] **Step 6: Verify backend starts**

Run:

```bash
cd /home/kali/smartZiw/eProcScraper/backend
python -c "import server; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 7: Commit**

```bash
cd /home/kali/smartZiw/eProcScraper
git add backend/server.py
git commit -m "feat(smart-ziw): replace Deep Dive API with Smart-Ziw endpoints and admin config"
```

---

### Task 6: Update frontend — replace Deep Dive UI with Smart-Ziw

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles/app-shell.css`

**Interfaces:**
- Consumes: `POST /api/projects/by-db-id/{db_id}/smart-ziw`, project `smart_ziw_*` fields.
- Produces: `handleSmartZiwSearch` handler, updated `CommentsPanel` props and button.

- [ ] **Step 1: Replace handler in `App.jsx`**

Find the Deep Dive handler around line 3212 and replace with:

```jsx
        const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(projectDbId)}/smart-ziw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: false }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData?.detail || 'Failed to start Smart-Ziw Agent');
        }
```

Update the state variable `runningDeepDive` to `runningSmartZiw` and the function `handleDeepDiveSearch` to `handleSmartZiwSearch`.

- [ ] **Step 2: Update `CommentsPanel` props and state**

Replace `onDeepDiveSearch` prop with `onSmartZiwSearch`.
Replace `runningDeepDive` state with `runningSmartZiw`.
Replace `handleDeepDiveSearch` with `handleSmartZiwSearch`.
Replace the button JSX (around lines 1326-1341):

```jsx
                            <div className="project-inspector-actions">
                                <button
                                    type="button"
                                    className="profile-btn profile-btn-primary"
                                    onClick={handleSmartZiwSearch}
                                    disabled={!project?.db_id || runningSmartZiw || project?.smart_ziw_status === 'queued' || project?.smart_ziw_status === 'running'}
                                >
                                    {runningSmartZiw || project?.smart_ziw_status === 'queued' || project?.smart_ziw_status === 'running' ? 'Generating...' : 'Smart-Ziw Agent'}
                                </button>
                                {project?.smart_ziw_status ? (
                                    <span className={`project-smart-ziw-status is-${project.smart_ziw_status}`}>
                                        {project?.smart_ziw_status === 'error' && project?.smart_ziw_error
                                            ? `Last run failed: ${project.smart_ziw_error}`
                                            : `Smart-Ziw status: ${project.smart_ziw_status}`}
                                    </span>
                                ) : null}
                            </div>
```

- [ ] **Step 3: Update CSS class names**

In `frontend/src/styles/app-shell.css`, replace `.project-deep-dive-status` with `.project-smart-ziw-status` (around lines 3243-3257):

```css
.project-smart-ziw-status {
    font-size: 0.75rem;
    color: var(--text-muted);
}

.project-smart-ziw-status.is-running,
.project-smart-ziw-status.is-queued {
    color: var(--warning, #f59e0b);
}

.project-smart-ziw-status.is-completed {
    color: var(--success, #10b981);
}

.project-smart-ziw-status.is-error {
    color: var(--danger, #ef4444);
}
```

- [ ] **Step 4: Verify build**

Run:

```bash
cd /home/kali/smartZiw/eProcScraper/frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /home/kali/smartZiw/eProcScraper
git add frontend/src/App.jsx frontend/src/styles/app-shell.css
git commit -m "feat(smart-ziw): replace Deep Dive UI with Smart-Ziw Agent button and status"
```

---

### Task 7: Add admin settings UI for Smart-Ziw / GitLab config

**Files:**
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `GET /api/admin/smart-ziw-config`, `PUT /api/admin/smart-ziw-config`.
- Produces: `SmartZiwConfigPanel` component rendered in Admin page.

- [ ] **Step 1: Add state and helper in `AdminPage`**

Inside `AdminPage`, add state:

```jsx
    const [smartZiwConfig, setSmartZiwConfig] = useState({
        smart_ziw_enabled: true,
        smart_ziw_repo_path: '/home/kali/Smart-Ziw',
        gitlab_push_enabled: false,
        gitlab_url: '',
        gitlab_token: '',
        gitlab_project_path: '',
        gitlab_branch: 'main',
        gitlab_author_name: 'Smart-Ziw Agent',
        gitlab_author_email: 'smart-ziw@localhost',
    });
    const [savingSmartZiwConfig, setSavingSmartZiwConfig] = useState(false);
```

Add load function:

```jsx
    const loadSmartZiwConfig = useCallback(async () => {
        const res = await apiFetch('/api/admin/smart-ziw-config');
        if (res.ok) {
            const data = await res.json();
            setSmartZiwConfig((prev) => ({ ...prev, ...data }));
        }
    }, [apiFetch]);
```

Call it in an effect when `adminTab === 'smart-ziw'`.

Add save function:

```jsx
    const saveSmartZiwConfig = async () => {
        setSavingSmartZiwConfig(true);
        try {
            const res = await apiFetch('/api/admin/smart-ziw-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(smartZiwConfig),
            });
            if (!res.ok) throw new Error('Failed to save');
            const data = await res.json();
            setSmartZiwConfig((prev) => ({ ...prev, ...data, gitlab_token: prev.gitlab_token }));
            setMessage('Smart-Ziw config saved.');
        } finally {
            setSavingSmartZiwConfig(false);
        }
    };
```

- [ ] **Step 2: Add new admin tab and form**

Add a tab button for `smart-ziw` next to the existing tabs:

```jsx
                <button type="button" className={`admin-page-tab ${adminTab === 'smart-ziw' ? 'active' : ''}`} onClick={() => setAdminTab('smart-ziw')}>Smart-Ziw</button>
```

Add the panel content:

```jsx
            {adminTab === 'smart-ziw' ? (
                <div className="panel-card">
                    <div className="profile-card-head">
                        <div>
                            <h3>Smart-Ziw Agent</h3>
                            <p className="profile-card-description">Configure local mirror path and optional GitLab push.</p>
                        </div>
                    </div>
                    <div className="profile-settings-grid">
                        <label className="modal-toggle-row">
                            <input type="checkbox" checked={smartZiwConfig.smart_ziw_enabled} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_enabled: e.target.checked })} />
                            <span className={`modal-toggle-label ${smartZiwConfig.smart_ziw_enabled ? 'active' : 'inactive'}`}>Enable Smart-Ziw Agent</span>
                        </label>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">Local repo path</label>
                            <input className="auth-input" value={smartZiwConfig.smart_ziw_repo_path} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_repo_path: e.target.value })} />
                        </div>
                        <label className="modal-toggle-row">
                            <input type="checkbox" checked={smartZiwConfig.gitlab_push_enabled} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_push_enabled: e.target.checked })} />
                            <span className={`modal-toggle-label ${smartZiwConfig.gitlab_push_enabled ? 'active' : 'inactive'}`}>Enable GitLab push</span>
                        </label>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">GitLab URL</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_url} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_url: e.target.value })} />
                        </div>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">GitLab token</label>
                            <input className="auth-input" type="password" value={smartZiwConfig.gitlab_token} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_token: e.target.value })} />
                        </div>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">GitLab project path</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_project_path} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_project_path: e.target.value })} />
                        </div>
                        <div className="auth-field">
                            <label className="auth-label">Branch</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_branch} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_branch: e.target.value })} />
                        </div>
                        <div className="auth-field">
                            <label className="auth-label">Author name</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_author_name} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_author_name: e.target.value })} />
                        </div>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">Author email</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_author_email} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_author_email: e.target.value })} />
                        </div>
                    </div>
                    <div className="profile-card-footer profile-card-footer-end">
                        <button type="button" className="profile-btn profile-btn-primary" onClick={saveSmartZiwConfig} disabled={savingSmartZiwConfig}>
                            {savingSmartZiwConfig ? 'Saving...' : 'Save config'}
                        </button>
                    </div>
                </div>
            ) : null}
```

- [ ] **Step 3: Verify build**

Run:

```bash
cd /home/kali/smartZiw/eProcScraper/frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /home/kali/smartZiw/eProcScraper
git add frontend/src/App.jsx
git commit -m "feat(smart-ziw): add admin settings UI for GitLab config"
```

---

### Task 8: Update release notes and docs

**Files:**
- Modify: `frontend/src/App.jsx` (release notes constants)

**Interfaces:**
- Produces: new release note entry for v1.3.

- [ ] **Step 1: Add v1.3 release note**

Prepend to `DEFAULT_RELEASE_NOTES` in `frontend/src/App.jsx`:

```js
    {
        version: '1.3',
        title: 'Smart-Ziw Agent replaces Deep Dive',
        summary: 'Replaced Deep Dive research with Smart-Ziw project mirror generation and added configurable GitLab push.',
        items: [
            'Replaced Deep Dive Search with Smart-Ziw Agent in the project inspector.',
            'Smart-Ziw Agent generates dated tender folders with markdown mirrors.',
            'Added admin settings for local repo path and optional GitLab push.',
            'Removed the legacy Deep Dive feature and API.',
        ],
    },
```

Also update `APP_RELEASE_VERSION` from `'1.2'` to `'1.3'`.

- [ ] **Step 2: Commit**

```bash
cd /home/kali/smartZiw/eProcScraper
git add frontend/src/App.jsx
git commit -m "docs: add v1.3 release notes for Smart-Ziw Agent"
```

---

### Task 9: Integration testing

**Files:**
- None new.
- Verify: `backend/smart_ziw_agent.py`, `backend/server.py`, `frontend/src/App.jsx`.

**Interfaces:**
- End-to-end: user clicks Smart-Ziw button, folder is generated, comment is posted.

- [ ] **Step 1: Start the full stack**

Run:

```bash
cd /home/kali/smartZiw/eProcScraper
docker-compose up -d
```

Wait for backend and frontend to be healthy.

- [ ] **Step 2: Trigger Smart-Ziw Agent on a project**

1. Open http://127.0.0.1:8080/ and log in.
2. Click any project in the table to open the inspector.
3. Click **Smart-Ziw Agent**.
4. Wait for status to show `completed`.
5. Check `/home/kali/Smart-Ziw/` for a new dated folder containing `tender.md`, `email.md`, `compliance-matrix.md`, `next-actions.md`.
6. Check the Discussion panel for a `Smart-Ziw Bot` comment.

- [ ] **Step 3: Test GitLab push**

1. Go to Admin → Smart-Ziw.
2. Enable GitLab push and enter a local GitLab URL, token, project path, branch.
3. Save.
4. Trigger Smart-Ziw Agent again.
5. Verify the folder appears in the GitLab repo.

- [ ] **Step 4: Test error path**

1. Temporarily remove `DEEPSEEK_API_KEY` from env.
2. Restart backend.
3. Trigger Smart-Ziw Agent.
4. Verify status shows `error` and a comment explains the missing API key.

- [ ] **Step 5: Commit any fixes**

If fixes are needed, commit them with clear messages.

---

## Self-Review Checklist

- [ ] Spec coverage: every section of the spec has at least one implementing task.
- [ ] No placeholders: no TBD, TODO, or vague instructions remain.
- [ ] Type consistency: `smart_ziw_*` field names match across database, server, and frontend.
- [ ] API paths: `/smart-ziw` endpoint replaces `/deep-dive` exactly.
- [ ] Token safety: GitLab token is never returned by `GET /api/admin/smart-ziw-config`.

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-08-14-smart-ziw-integration.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach would you like?
