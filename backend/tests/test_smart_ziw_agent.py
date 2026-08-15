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
