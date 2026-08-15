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
    client = _safe_slug(project.get("primary_country_name_en") or project.get("project_sponsor") or "Unknown")
    title = _safe_slug(project.get("project_name") or project.get("project_description") or "Tender")
    # Remove common leading procurement filler words for a concise folder title
    title = re.sub(r"^(recruitment-of-an-|recruitment-of-|recruitment-for-|supply-of-|provision-of-)", "", title, flags=re.IGNORECASE)
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
