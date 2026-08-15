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
- "next_actions": list of objects with keys action, priority, owner, deadline, notes. List ONLY actions that require human authority, legal accountability, physical presence, payment, signatures, team management, or official submission. Exclude anything the agent or LLM already does: drafting, reviewing, summarizing, pricing models, eligibility analysis, retrieving documents, compliance checks, preparing proposals. If every remaining action is automatable, return an empty list.
- "risks": list of objects with keys risk, likelihood, impact, mitigation (only if uncertainty exists; otherwise empty list).
- "eligibility_notes": string with eligibility summary.
- "source_notes": string summarizing source reliability.
- "pricing_notes": string with budget/value assessment.
- "drafting_notes": string with drafting guidance for the proposal.
- "recap": one-page executive recap string.
Keep each list concise (max 8 items). Mark uncertain items clearly."""

CHAT_PROMPT = """You are Smart-Ziw, the tender-bidding assistant for this procurement platform.
Answer the user's comment about the project using only the provided context.
Be concise: a short paragraph or a bullet list. Cite project facts accurately.
If the question needs full web research, tell the user to trigger the Smart-Ziw agent run for this project."""


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


_HUMAN_ACTION_KEEP_MARKERS = (
    "submit", "sign", "pay", "notariz", "register", "attend", "meet", "team",
    "bank guarantee", "bid bond", "authorized", "approval", "call", "negotiat",
)

_HUMAN_ACTION_DROP_VERBS = (
    "draft", "prepare", "review", "write", "summarize", "summarise", "research",
    "analyze", "analyse", "compare", "compile", "create", "generate", "obtain",
    "retrieve", "download", "check", "verify", "assess", "evaluate", "estimate",
    "calculate", "develop", "plan", "translate", "extract", "gather", "collect",
    "find", "list", "outline",
)

_HUMAN_ACTIONS_AUTOMATED_NOTE = "All identified next actions are automatable by the LLM; no human-only actions remain."


def _human_only_actions(rows: list) -> list[dict]:
    """Keep only next-action rows the LLM cannot perform itself (human authority,
    legal accountability, physical presence, payment, signatures, team
    management, official submission)."""
    kept = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        text = str(row.get("action") or "").strip().lower()
        if not text:
            continue
        if "send" in text and "email" in text:
            kept.append(row)
            continue
        if any(marker in text for marker in _HUMAN_ACTION_KEEP_MARKERS):
            kept.append(row)
            continue
        if text.split()[0] in _HUMAN_ACTION_DROP_VERBS:
            continue
        kept.append(row)
    return kept


def _enrich(project: dict, llm_call=None) -> dict:
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
        result = (llm_call or _call_llm)(ENRICH_PROMPT, user_prompt)
    except Exception as exc:
        enrichment = _default_enrichment()
        enrichment["error"] = f"LLM enrichment failed: {exc}"
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
    rows = _human_only_actions(rows)
    if not rows:
        lines.append(_HUMAN_ACTIONS_AUTOMATED_NOTE)
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


def render_source_markdown(project: dict, enrichment: dict) -> str:
    title = project.get("project_name") or "Tender"
    lines = [f"# Source Notes: {title}", "", "| Kind | URL | Status |", "|------|-----|--------|"]
    source_url = project.get("project_url") or ""
    if source_url:
        lines.append(f"| aggregator | {_escape_table_cell(source_url)} | from tender metadata |")
    lines.append(f"| metadata | {_escape_table_cell(project.get('source'))} | tender metadata record |")
    notes = enrichment.get("source_notes", "")
    if notes:
        lines.extend(["", notes])
    return "\n".join(lines)


def render_drafting_notes_markdown(project: dict, enrichment: dict) -> str:
    notes = enrichment.get("drafting_notes", "")
    title = project.get("project_name") or "Tender"
    if not notes:
        notes = "No drafting notes available (no research evidence collected)."
    return f"# Drafting Notes: {title}\n\n{notes}"


def _render_research_tender(project: dict, synthesis: dict) -> str:
    title = project.get("project_name") or "Tender"
    return f"# Tender Intelligence: {title}\n\n{synthesis.get('tender_markdown') or 'No verified information.'}"


def _render_research_email(project: dict, synthesis: dict) -> str:
    title = project.get("project_name") or "Tender"
    draft = synthesis.get("email_draft") or "No clarification email draft was produced."
    return f"# Draft Clarification Email: {title}\n\n{draft}"


def _render_research_compliance(project: dict, synthesis: dict) -> str:
    title = project.get("project_name") or "Tender"
    rows = synthesis.get("compliance_matrix") or []
    lines = [f"# Compliance Matrix: {title}", ""]
    if not rows:
        lines.append("No verified compliance items — see tender.md for the assessment.")
        return "\n".join(lines)
    lines.extend(["| Requirement | Status | Action | Source |", "|-------------|--------|--------|--------|"])
    for row in rows:
        lines.append(
            f"| {_escape_table_cell(row.get('requirement', '-'))} | "
            f"{_escape_table_cell(row.get('status', '-'))} | "
            f"{_escape_table_cell(row.get('action', '-'))} | "
            f"{_escape_table_cell(row.get('source', 'unverified'))} |"
        )
    return "\n".join(lines)


def _render_research_drafting(project: dict, synthesis: dict) -> str:
    title = project.get("project_name") or "Tender"
    notes = synthesis.get("drafting_notes") or "No drafting notes available."
    return f"# Drafting Notes: {title}\n\n{notes}"


def _render_research_next_actions(project: dict, synthesis: dict) -> str:
    title = project.get("project_name") or "Tender"
    rows = synthesis.get("next_actions") or []
    lines = [f"# Next Actions: {title}", ""]
    if not rows:
        lines.append("No next actions identified.")
        return "\n".join(lines)
    rows = _human_only_actions(rows)
    if not rows:
        lines.append(_HUMAN_ACTIONS_AUTOMATED_NOTE)
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


def _render_research_source(project: dict, synthesis: dict) -> str:
    title = project.get("project_name") or "Tender"
    lines = [f"# Source Inventory: {title}", "", "| Kind | URL | Captured | Status |", "|------|-----|----------|--------|"]
    for row in synthesis.get("source_rows") or []:
        lines.append(
            f"| {_escape_table_cell(row.get('kind', 'other'))} | "
            f"{_escape_table_cell(row.get('url', '-'))} | "
            f"{_escape_table_cell('yes' if row.get('captured') else 'no')} | "
            f"{_escape_table_cell(row.get('status', '-'))} |"
        )
    return "\n".join(lines)


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
        _git(["add", "--", f"{folder}/"], check=True)
        if (repo_path / folder / "documents").exists():
            _git(["rm", "-r", "--cached", "--quiet", "--", f"{folder}/documents"], check=False)
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
    repo_path = Path(config.get("smart_ziw_repo_path", "/home/kali/Smart-Ziw"))
    folder_path = repo_path / folder
    folder_path.mkdir(parents=True, exist_ok=True)

    research = None
    synthesis = None
    error = ""
    llm_call = None
    try:
        from smart_ziw_llm import get_llm_call
        llm_call = get_llm_call(config)
    except Exception as exc:   # forced-lightllm config error + OpenAI SDK construction errors
        error = str(exc)
    research_ran = bool(config.get("smart_ziw_research_enabled", True)) and bool(config.get("firecrawl_api_key"))
    if error:
        research_ran = False
    if research_ran:
        from smart_ziw_research import run_research
        research = run_research(project, config, folder_path=folder_path, llm_call=llm_call)
        if research.error:
            error = research.error
        else:
            from smart_ziw_research import synthesize
            synthesis = synthesize(project, research, llm_call=llm_call)
            if synthesis.get("_error"):
                error = synthesis["_error"]
                synthesis = None

    if synthesis is not None:
        files = {
            "tender.md": _render_research_tender(project, synthesis),
            "email.md": _render_research_email(project, synthesis),
            "compliance-matrix.md": _render_research_compliance(project, synthesis),
            "drafting-notes.md": _render_research_drafting(project, synthesis),
            "next-actions.md": _render_research_next_actions(project, synthesis),
            "source.md": _render_research_source(project, synthesis),
        }
    else:
        if llm_call is None and error:
            enrichment = _default_enrichment()
            enrichment["error"] = error
        else:
            enrichment = _enrich(project, llm_call=llm_call)
        if enrichment.get("error"):
            error = error or enrichment["error"]
        files = {
            "tender.md": render_tender_markdown(project, enrichment),
            "email.md": render_email_markdown(project, enrichment),
            "compliance-matrix.md": render_compliance_matrix_markdown(project, enrichment),
            "drafting-notes.md": render_drafting_notes_markdown(project, enrichment),
            "next-actions.md": render_next_actions_markdown(project, enrichment),
            "source.md": render_source_markdown(project, enrichment),
        }

    for name, content in files.items():
        (folder_path / name).write_text(content, encoding="utf-8")

    artifacts_dir = folder_path / "artifacts"
    artifact_files = []
    if artifacts_dir.exists():
        artifact_files = [f"artifacts/{p.name}" for p in sorted(artifacts_dir.glob("*.md"))]
    documents_dir = folder_path / "documents"
    document_files = [p.name for p in sorted(documents_dir.glob("*"))] if documents_dir.exists() else []

    git_result = push_to_gitlab(repo_path, folder, config)
    result = {
        "folder": folder,
        "files": list(files.keys()) + artifact_files,
        "repo_path": str(repo_path),
        "gitlab_pushed": git_result["pushed"],
        "gitlab_message": git_result["message"],
    }
    if research is not None:
        result["research"] = True
        result["research_stats"] = research.stats
        result["research_verdict"] = (
            (research.verdict or {}).get("recommendation", "MONITOR") if not research.error else "ERROR"
        )
        result["research_timed_out"] = bool(research.timed_out)
        result["documents"] = document_files
    if error:
        result["error"] = error
    return result
