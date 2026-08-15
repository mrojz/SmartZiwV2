import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path

from openai import OpenAI


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
    # Remove common leading procurement filler words for a concise folder title
    title = re.sub(r"^(recruitment-of-an-|recruitment-of-|recruitment-for-|supply-of-|provision-of-)", "", title, flags=re.IGNORECASE)
    parts = [p for p in [deadline, client, title] if p]
    return "-".join(parts)


def _escape_table_cell(value) -> str:
    text = str(value or "")
    text = text.replace("|", "\\|")
    text = text.replace("\n", " ")
    text = text.replace("\r", " ")
    return text


def render_tender_markdown(project: dict, enrichment: dict | None = None) -> str:
    enrichment = enrichment or {}
    summary = enrichment.get("tender_summary", "")
    if summary:
        title = project.get("project_name") or "Tender"
        return f"# Tender Intelligence: {title}\n\n{summary}"
    lines = [
        f"# Tender Intelligence: {project.get('project_name') or 'Untitled'}",
        "",
        "## Overview",
        "",
        "| Field | Detail |",
        "|-------|--------|",
        f"| **Tender Title** | {_escape_table_cell(project.get('project_name'))} |",
        f"| **Buyer** | {_escape_table_cell(project.get('project_sponsor'))} |",
        f"| **Country** | {_escape_table_cell(project.get('primary_country_name_en'))} |",
        f"| **Deadline** | {_escape_table_cell(project.get('project_end_date'))} |",
        f"| **Source** | {_escape_table_cell(project.get('source'))} |",
        f"| **Source URL** | {_escape_table_cell(project.get('project_url'))} |",
        "",
        "## Description",
        "",
        project.get("project_description") or "No description available.",
    ]
    return "\n".join(lines)


def render_email_markdown(project: dict, enrichment: dict | None = None) -> str:
    enrichment = enrichment or {}
    draft = enrichment.get("email_draft", "")
    if draft:
        title = project.get("project_name") or "Tender"
        return f"# Draft Clarification Email: {title}\n\n{draft}"
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
            if text.lower().startswith("json"):
                text = text[4:]
            text = text.strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass
    start = text.find("{")
    if start == -1:
        return {}
    try:
        parsed, _ = json.JSONDecoder().raw_decode(text, start)
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
        max_tokens=4000,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    return _safe_json_loads(content)


ENRICH_PROMPT = """You are a tender intelligence assistant.
Given tender metadata, return JSON with these keys:
- "tender_summary": string with a concise structured tender overview (title, buyer, country, deadline, source verification, scope, eligibility, practical conclusion) in markdown.
- "email_draft": string with a draft clarification email body to the buyer.
- "compliance_matrix": list of objects with keys requirement, status, evidence_needed, owner, notes.
- "next_actions": list of objects with keys action, priority, owner, deadline, notes.
- "risks": list of objects with keys risk, likelihood, impact, mitigation (only if uncertainty exists; otherwise empty list).
- "eligibility_notes": string with eligibility summary.
- "source_notes": string summarizing source reliability.
- "pricing_notes": string with budget/value assessment.
- "drafting_notes": string with drafting guidance for the proposal.
- "recap": one-page executive recap string.
Keep each list concise (max 8 items). Mark uncertain items clearly."""


def _default_enrichment() -> dict:
    return {
        "tender_summary": "",
        "email_draft": "",
        "compliance_matrix": [],
        "next_actions": [],
        "risks": [],
        "eligibility_notes": "",
        "source_notes": "",
        "pricing_notes": "",
        "drafting_notes": "",
        "recap": "",
    }


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
    try:
        result = _call_llm(ENRICH_PROMPT, user_prompt)
    except Exception as exc:
        enrichment = _default_enrichment()
        enrichment["error"] = f"DeepSeek enrichment failed: {exc}"
        return enrichment
    enrichment = _default_enrichment()
    enrichment["tender_summary"] = str(result.get("tender_summary") or "").strip()
    enrichment["email_draft"] = str(result.get("email_draft") or "").strip()
    enrichment["compliance_matrix"] = result.get("compliance_matrix") if isinstance(result.get("compliance_matrix"), list) else []
    enrichment["next_actions"] = result.get("next_actions") if isinstance(result.get("next_actions"), list) else []
    enrichment["risks"] = result.get("risks") if isinstance(result.get("risks"), list) else []
    enrichment["eligibility_notes"] = str(result.get("eligibility_notes") or "").strip()
    enrichment["source_notes"] = str(result.get("source_notes") or "").strip()
    enrichment["pricing_notes"] = str(result.get("pricing_notes") or "").strip()
    enrichment["drafting_notes"] = str(result.get("drafting_notes") or "").strip()
    enrichment["recap"] = str(result.get("recap") or "").strip()
    return enrichment


def render_compliance_matrix_markdown(project: dict, enrichment: dict) -> str:
    title = project.get("project_name") or "Tender"
    lines = [f"# Compliance Matrix: {title}", ""]
    rows = enrichment.get("compliance_matrix") or []
    if not rows:
        lines.append("No compliance items identified.")
        return "\n".join(lines)
    lines.extend(["| Requirement | Status | Evidence Needed | Owner | Notes |", "|-------------|--------|-----------------|-------|-------|"])
    for row in rows:
        lines.append(
            f"| {_escape_table_cell(row.get('requirement', '-'))} | "
            f"{_escape_table_cell(row.get('status', '-'))} | "
            f"{_escape_table_cell(row.get('evidence_needed', row.get('evidence', '-')))} | "
            f"{_escape_table_cell(row.get('owner', '-'))} | "
            f"{_escape_table_cell(row.get('notes', '-'))} |"
        )
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
        lines.append(
            f"| {_escape_table_cell(row.get('action', '-'))} | "
            f"{_escape_table_cell(row.get('priority', '-'))} | "
            f"{_escape_table_cell(row.get('owner', '-'))} | "
            f"{_escape_table_cell(row.get('deadline', '-'))} | "
            f"{_escape_table_cell(row.get('notes', '-'))} |"
        )
    return "\n".join(lines)


def render_risks_markdown(project: dict, enrichment: dict) -> str:
    title = project.get("project_name") or "Tender"
    rows = enrichment.get("risks") or []
    if not rows:
        return ""
    lines = [f"# Risks: {title}", "", "| Risk | Likelihood | Impact | Mitigation |", "|------|------------|--------|------------|"]
    for row in rows:
        lines.append(
            f"| {_escape_table_cell(row.get('risk', '-'))} | "
            f"{_escape_table_cell(row.get('likelihood', '-'))} | "
            f"{_escape_table_cell(row.get('impact', '-'))} | "
            f"{_escape_table_cell(row.get('mitigation', '-'))} |"
        )
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


def render_drafting_notes_markdown(project: dict, enrichment: dict) -> str:
    notes = enrichment.get("drafting_notes", "")
    if not notes:
        return ""
    title = project.get("project_name") or "Tender"
    return f"# Drafting Notes: {title}\n\n{notes}"


def render_recap_markdown(project: dict, enrichment: dict) -> str:
    notes = enrichment.get("recap", "")
    if not notes:
        return ""
    title = project.get("project_name") or "Tender"
    return f"# Recap: {title}\n\n{notes}"


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
    drafting_notes = render_drafting_notes_markdown(project, enrichment)
    if drafting_notes:
        files["drafting-notes.md"] = drafting_notes
    recap = render_recap_markdown(project, enrichment)
    if recap:
        files["recap.md"] = recap
    return files


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

    # Credential-free remote URL: auth is injected per-command via env config
    # below, so the token never lands in .git/config, argv, or git output.
    git_remote = f"{url}/{project_path}.git"

    def _scrub(text: str) -> str:
        # Defense in depth: never let the token reach logs or comments.
        return (text or "").replace(token, "***")

    def _git(args, check=True, auth=False):
        env = os.environ.copy()
        if auth:
            # http.extraheader via env config — not persisted anywhere.
            env.update({
                "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": "http.extraheader",
                "GIT_CONFIG_VALUE_0": f"PRIVATE-TOKEN: {token}",
            })
        return subprocess.run(
            ["git"] + args,
            cwd=str(repo_path),
            check=check,
            capture_output=True,
            text=True,
            env=env,
        )

    try:
        if not (repo_path / ".git").exists():
            _git(["init"], check=False)
        _git(["config", "user.name", author_name], check=False)
        _git(["config", "user.email", author_email], check=False)
        _git(["add", f"{folder}/"])
        status = _git(["status", "--porcelain"], check=False)
        if not status.stdout.strip():
            return {"pushed": False, "message": "No changes to commit"}
        _git(["commit", "-m", f"smart-ziw: add/update {folder}"])
        push = _git(["push", git_remote, f"HEAD:{branch}"], auth=True)
        return {"pushed": True, "message": _scrub(push.stdout or "Pushed successfully")}
    except subprocess.CalledProcessError as exc:
        return {"pushed": False, "message": _scrub(f"Git error: {exc.stderr or exc.stdout}")}


def run(project: dict, config: dict | None = None) -> dict:
    config = config or {}
    folder = build_folder_name(project)
    enrichment = _enrich(project)
    files = {
        "tender.md": render_tender_markdown(project, enrichment),
        "email.md": render_email_markdown(project, enrichment),
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
    result = {
        "folder": folder,
        "files": list(files.keys()),
        "repo_path": str(repo_path),
        "gitlab_pushed": git_result["pushed"],
        "gitlab_message": git_result["message"],
    }
    error = enrichment.get("error")
    if error:
        result["error"] = error
    return result
