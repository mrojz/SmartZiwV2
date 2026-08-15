import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_agent import (
    build_folder_name,
    render_tender_markdown,
    render_email_markdown,
    render_compliance_matrix_markdown,
    render_next_actions_markdown,
)


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
