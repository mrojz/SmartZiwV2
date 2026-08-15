import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_agent import (
    build_folder_name,
    render_tender_markdown,
    render_email_markdown,
    render_compliance_matrix_markdown,
    render_next_actions_markdown,
    _enrich,
    _safe_json_loads,
    run,
    push_to_gitlab,
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


def test_render_tender_markdown_uses_enrichment():
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_url": "https://example.com/tender",
        "source": "Global Tenders",
        "project_description": "Audit and pentesting.",
    }
    enrichment = {"tender_summary": "## Overview\n\nConcise LLM summary."}
    md = render_tender_markdown(project, enrichment)
    assert "Concise LLM summary" in md
    assert "## Overview" in md


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


def test_render_email_markdown_uses_enrichment():
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
    }
    enrichment = {"email_draft": "Dear buyer, please clarify the deadline."}
    md = render_email_markdown(project, enrichment)
    assert "Dear buyer, please clarify the deadline" in md


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


def test_render_compliance_matrix_escapes_pipes_and_newlines():
    project = {"project_name": "Test"}
    enrichment = {
        "compliance_matrix": [
            {"requirement": "A | B", "status": "X\nY", "evidence_needed": "E", "owner": "O", "notes": "N"},
        ]
    }
    md = render_compliance_matrix_markdown(project, enrichment)
    assert "A \\| B" in md
    assert "X Y" in md
    assert "X\nY" not in md


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


def test_safe_json_loads_extracts_nested_object():
    content = 'Some text {"a": {"b": [1, 2]}, "c": "d"} trailing'
    parsed = _safe_json_loads(content)
    assert parsed == {"a": {"b": [1, 2]}, "c": "d"}


def test_safe_json_loads_strips_case_insensitive_code_fence():
    content = "```JSON\n{\"foo\": \"bar\"}\n```"
    parsed = _safe_json_loads(content)
    assert parsed == {"foo": "bar"}


def test_enrich_fallback_on_llm_error(monkeypatch):
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
    }

    def _raise(*args, **kwargs):
        raise RuntimeError("API down")

    monkeypatch.setattr("smart_ziw_agent._call_llm", _raise)
    enrichment = _enrich(project)
    assert isinstance(enrichment, dict)
    assert enrichment["compliance_matrix"] == []
    assert enrichment["next_actions"] == []
    assert "API down" in enrichment["error"]


def test_enrich_coerces_non_list_fields_to_empty_lists(monkeypatch):
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
    }

    def _return_bad(*args, **kwargs):
        return {
            "compliance_matrix": "not a list",
            "next_actions": {"action": "x"},
            "risks": None,
        }

    monkeypatch.setattr("smart_ziw_agent._call_llm", _return_bad)
    enrichment = _enrich(project)
    assert enrichment["compliance_matrix"] == []
    assert enrichment["next_actions"] == []
    assert enrichment["risks"] == []


def test_run_gracefully_handles_missing_api_key(monkeypatch, tmp_path):
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_url": "https://example.com/tender",
        "source": "Global Tenders",
        "project_description": "Audit and pentesting.",
    }
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    result = run(project, config={"smart_ziw_repo_path": str(tmp_path)})
    assert "error" in result
    assert "DEEPSEEK_API_KEY" in result["error"]
    assert "tender.md" in result["files"]
    assert "email.md" in result["files"]
    assert (tmp_path / result["folder"] / "tender.md").exists()
    assert (tmp_path / result["folder"] / "email.md").exists()
    assert (tmp_path / result["folder"] / "compliance-matrix.md").exists()
    assert (tmp_path / result["folder"] / "next-actions.md").exists()


from unittest.mock import patch


def test_push_to_gitlab_config_missing_skips():
    result = push_to_gitlab(Path("/tmp/fake"), "folder", {})
    assert result["pushed"] is False
    assert "disabled" in result["message"].lower()
