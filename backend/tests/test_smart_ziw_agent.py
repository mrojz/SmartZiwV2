import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_agent import (
    build_folder_name,
    render_tender_markdown,
    render_email_markdown,
    render_compliance_matrix_markdown,
    render_next_actions_markdown,
    render_source_markdown,
    render_drafting_notes_markdown,
    _enrich,
    _safe_json_loads,
    run,
    push_to_gitlab,
)
from smart_ziw_research import ResearchResult


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
    assert name == "13072026-CDC-Benin-IS-Security-Audit-Firm"


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


def test_run_research_path_writes_grounded_files(monkeypatch, tmp_path):
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
    }
    research = ResearchResult(
        verdict={"recommendation": "GO", "reasoning": "live [1]"},
        stats={"queries_run": 3, "pages_scraped": 1, "documents_captured": 0},
    )

    def fake_run_research(project, config, folder_path=None, llm_call=None):
        (folder_path / "artifacts").mkdir(exist_ok=True)
        (folder_path / "artifacts" / "research-log.md").write_text("# Research Log\n", encoding="utf-8")
        return research

    def fake_synthesize(project, research, llm_call=None):
        return {
            "tender_markdown": "## Overview\n\nVerified [1]",
            "email_draft": "Dear buyer, please share the DCE.",
            "compliance_matrix": [{"requirement": "r", "status": "Compliant", "action": "a", "source": "[1]"}],
            "drafting_notes": "safe to say: [1]",
            "next_actions": [{"action": "a", "priority": "HIGH", "owner": "o", "deadline": "d", "notes": "n"}],
            "source_rows": [{"kind": "official", "url": "https://example.com", "captured": True, "status": "ok"}],
        }

    monkeypatch.setattr("smart_ziw_research.run_research", fake_run_research)
    monkeypatch.setattr("smart_ziw_research.synthesize", fake_synthesize)
    result = run(project, config={
        "smart_ziw_repo_path": str(tmp_path),
        "firecrawl_api_key": "k",
        "smart_ziw_research_enabled": True,
    })
    assert result["research"] is True
    assert result["research_verdict"] == "GO"
    assert result["research_stats"]["queries_run"] == 3
    assert set(result["files"]) == {
        "tender.md", "email.md", "compliance-matrix.md", "drafting-notes.md",
        "next-actions.md", "source.md", "artifacts/research-log.md",
    }
    assert "risks.md" not in result["files"]
    folder = tmp_path / result["folder"]
    tender = (folder / "tender.md").read_text(encoding="utf-8")
    assert "Verified [1]" in tender
    assert not (folder / "risks.md").exists()


def test_run_research_failure_falls_back_to_metadata_path(monkeypatch, tmp_path):
    project = {"project_name": "IS Security Audit", "project_end_date": "2026-07-13"}

    def fake_run_research(project, config, folder_path=None, llm_call=None):
        research = ResearchResult(error="research failed: Firecrawl HTTP 500")
        research.verdict = {"recommendation": "MONITOR", "reasoning": ""}
        return research

    monkeypatch.setattr("smart_ziw_research.run_research", fake_run_research)
    monkeypatch.setattr("smart_ziw_agent._call_llm", lambda *a, **k: {})
    result = run(project, config={
        "smart_ziw_repo_path": str(tmp_path),
        "firecrawl_api_key": "k",
    })
    assert result["error"] == "research failed: Firecrawl HTTP 500"
    assert result["research"] is True
    assert result["research_verdict"] == "ERROR"
    folder = tmp_path / result["folder"]
    assert (folder / "tender.md").exists()
    assert (folder / "source.md").exists()
    assert "risks.md" not in result["files"]


def test_run_metadata_path_writes_complete_file_set(monkeypatch, tmp_path):
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_url": "https://example.com/tender",
    }
    monkeypatch.setattr("smart_ziw_agent._call_llm", lambda *a, **k: {
        "tender_summary": "summary",
        "email_draft": "draft",
        "compliance_matrix": [],
        "next_actions": [],
    })
    result = run(project, config={"smart_ziw_repo_path": str(tmp_path)})
    assert "research" not in result
    assert set(result["files"]) == {
        "tender.md", "email.md", "compliance-matrix.md", "drafting-notes.md",
        "next-actions.md", "source.md",
    }
    folder = tmp_path / result["folder"]
    for name in result["files"]:
        assert (folder / name).exists()


def test_push_to_gitlab_excludes_documents_binaries(tmp_path):
    repo_path = tmp_path / "mirror-repo"
    repo_path.mkdir()
    folder = repo_path / "folder"
    folder.mkdir()
    (folder / "tender.md").write_text("test", encoding="utf-8")
    docs = folder / "documents"
    docs.mkdir()
    (docs / "dce.pdf").write_bytes(b"%PDF-1.4")
    config = {
        "gitlab_push_enabled": True,
        "gitlab_url": "https://127.0.0.1:1",
        "gitlab_token": "t",
        "gitlab_project_path": "group/project",
        "gitlab_branch": "main",
    }
    result = push_to_gitlab(repo_path, "folder", config)
    assert result["pushed"] is False  # unroutable host; commit still happens locally
    tracked = subprocess.check_output(["git", "ls-files"], cwd=str(repo_path), text=True)
    assert "folder/tender.md" in tracked
    assert "documents" not in tracked


def test_push_to_gitlab_config_missing_skips():
    result = push_to_gitlab(Path("/tmp/fake"), "folder", {})
    assert result["pushed"] is False
    assert "disabled" in result["message"].lower()


def test_push_to_gitlab_incomplete_config():
    config = {
        "gitlab_push_enabled": True,
        "gitlab_url": "https://gitlab.example.com",
        "gitlab_token": "",
        "gitlab_project_path": "group/project",
        "gitlab_branch": "main",
    }
    result = push_to_gitlab(Path("/tmp/fake"), "folder", config)
    assert result["pushed"] is False
    assert result["message"] == "GitLab config incomplete"


def test_push_to_gitlab_token_never_persisted_or_leaked(tmp_path):
    repo_path = tmp_path / "mirror-repo"
    repo_path.mkdir()
    (repo_path / "folder").mkdir()
    (repo_path / "folder" / "tender.md").write_text("test", encoding="utf-8")
    token = "super-secret-token-12345"
    config = {
        "gitlab_push_enabled": True,
        # Unroutable host: push fails fast regardless of auth handling.
        "gitlab_url": "https://127.0.0.1:1",
        "gitlab_token": token,
        "gitlab_project_path": "group/project",
        "gitlab_branch": "main",
    }
    result = push_to_gitlab(repo_path, "folder", config)
    # Push must fail (unreachable host) but never expose the token.
    assert result["pushed"] is False
    assert token not in result["message"]
    # Token must not be persisted in the repo config; remote URL is clean.
    config_text = ""
    if (repo_path / ".git" / "config").exists():
        config_text = (repo_path / ".git" / "config").read_text(encoding="utf-8")
    assert token not in config_text
    assert "oauth2:" not in config_text
    # The folder is committed locally even when the push fails.
    assert (repo_path / ".git").exists()
