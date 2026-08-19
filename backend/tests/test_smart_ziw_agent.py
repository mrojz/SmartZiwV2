import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_agent import (
    build_folder_name,
    render_source_markdown,
    render_analysis_markdown,
    render_eligibility_markdown,
    render_risks_markdown,
    render_pricing_markdown,
    render_recap_markdown,
    render_readme_markdown,
    render_documents_notes,
    _enrich,
    _safe_json_loads,
    run,
    push_to_gitlab,
    ENRICH_PROMPT,
    CHAT_PROMPT,
    _default_enrichment,
    _human_only_actions,
)
from smart_ziw_gitlab import push_to_gitlab
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
    assert name == "13072026-IS-Security-Audit-Firm"


def test_renderers_use_content_markdown():
    project = {"project_name": "IS Security Audit", "project_sponsor": "CDC Benin"}
    content = {
        "source_markdown": "# Source\n\nverified",
        "analysis_markdown": "# Analysis\n\ngo [1]",
        "eligibility_markdown": "# Eligibility\n\nok",
        "risks_markdown": "# Risks\n\nlow",
        "pricing_markdown": "# Pricing\n\nUSD 1000",
        "recap_markdown": "# Tender Recap\n\nGO",
        "readme_markdown": "# README\n\nfolder",
        "documents_notes_markdown": "# Documents\n\nnone",
    }
    assert "verified" in render_source_markdown(project, content)
    assert "go [1]" in render_analysis_markdown(project, content)
    assert "ok" in render_eligibility_markdown(project, content)
    assert "low" in render_risks_markdown(project, content)
    assert "USD 1000" in render_pricing_markdown(project, content)
    assert "GO" in render_recap_markdown(project, content)
    assert "folder" in render_readme_markdown(project, content)
    assert "none" in render_documents_notes(project, content)


def test_renderers_fallback_when_content_missing():
    project = {"project_name": "IS Security Audit"}
    md = render_analysis_markdown(project, {})
    assert "Analysis" in md
    assert "No content" in md


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
    assert enrichment["source_markdown"] == ""
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
            "source_markdown": "source",
            "next_actions": {"action": "x"},
        }

    monkeypatch.setattr("smart_ziw_agent._call_llm", _return_bad)
    enrichment = _enrich(project)
    assert enrichment["source_markdown"] == "source"
    assert enrichment["next_actions"] == []


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
    result = run(project, config={
        "smart_ziw_repo_path": str(tmp_path),
        "smart_ziw_skills_enabled": False,
        "smart_ziw_research_enabled": False,
    })
    assert "error" in result
    assert "DEEPSEEK_API_KEY" in result["error"]
    expected = {
        "README.md", "source.md", "analysis.md", "eligibility.md",
        "risks.md", "pricing.md", "recap.md", "next-actions.md",
    }
    assert expected.issubset(set(result["files"]))
    folder = tmp_path / result["folder"]
    for name in expected:
        assert (folder / name).exists()


def test_run_research_path_writes_new_file_set(monkeypatch, tmp_path):
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

    def fake_run_research(project, config, folder_path=None, llm_call=None, thread_context=""):
        (folder_path / "artifacts").mkdir(exist_ok=True)
        (folder_path / "artifacts" / "research-log.md").write_text("# Research Log\n", encoding="utf-8")
        return research

    def fake_synthesize(project, research, llm_call=None, thread_context=""):
        return {
            "source_markdown": "# Source\n\nverified [1]",
            "analysis_markdown": "# Analysis\n\nGO [1]",
            "eligibility_markdown": "# Eligibility\n\nok",
            "risks_markdown": "# Risks\n\nlow",
            "pricing_markdown": "# Pricing\n\nUSD 1000",
            "recap_markdown": "# Tender Recap\n\nGO",
            "readme_markdown": "# README\n\nfolder",
            "documents_notes_markdown": "# Documents\n\nnone",
        }

    monkeypatch.setattr("smart_ziw_research.run_research", fake_run_research)
    monkeypatch.setattr("smart_ziw_research.synthesize", fake_synthesize)
    monkeypatch.setattr("smart_ziw_research.firecrawl_mcp_available", lambda: True)
    result = run(project, config={
        "smart_ziw_repo_path": str(tmp_path),
        "smart_ziw_research_enabled": True,
        "smart_ziw_skills_enabled": False,
    })
    assert result["research"] is True
    assert result["research_verdict"] == "GO"
    assert result["research_stats"]["queries_run"] == 3
    expected = {
        "README.md", "source.md", "analysis.md", "eligibility.md",
        "risks.md", "pricing.md", "recap.md", "next-actions.md",
        "artifacts/research-log.md",
    }
    assert expected.issubset(set(result["files"]))
    folder = tmp_path / result["folder"]
    assert "GO [1]" in (folder / "analysis.md").read_text(encoding="utf-8")
    assert (folder / "documents" / "notes.md").exists()


def test_run_research_failure_falls_back_to_metadata_path(monkeypatch, tmp_path):
    project = {"project_name": "IS Security Audit", "project_end_date": "2026-07-13"}

    def fake_run_research(project, config, folder_path=None, llm_call=None, thread_context=""):
        research = ResearchResult(error="research failed: Firecrawl HTTP 500")
        research.verdict = {"recommendation": "GO-CONDITIONAL", "reasoning": ""}
        return research

    monkeypatch.setattr("smart_ziw_research.run_research", fake_run_research)
    monkeypatch.setattr("smart_ziw_agent._call_llm", lambda *a, **k: {
        "source_markdown": "s", "analysis_markdown": "a", "eligibility_markdown": "e",
        "risks_markdown": "r", "pricing_markdown": "p", "recap_markdown": "c",
        "readme_markdown": "readme",
    })
    monkeypatch.setattr("smart_ziw_research.firecrawl_mcp_available", lambda: True)
    result = run(project, config={
        "smart_ziw_repo_path": str(tmp_path),
        "smart_ziw_research_enabled": True,
        "smart_ziw_skills_enabled": False,
    })
    assert result["error"] == "research failed: Firecrawl HTTP 500"
    assert result["research"] is True
    assert result["research_verdict"] == "ERROR"
    folder = tmp_path / result["folder"]
    assert (folder / "analysis.md").exists()
    assert (folder / "source.md").exists()


def test_run_metadata_path_writes_complete_file_set(monkeypatch, tmp_path):
    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_url": "https://example.com/tender",
    }
    monkeypatch.setattr("smart_ziw_agent._call_llm", lambda *a, **k: {
        "source_markdown": "s", "analysis_markdown": "a", "eligibility_markdown": "e",
        "risks_markdown": "r", "pricing_markdown": "p", "recap_markdown": "c",
        "readme_markdown": "readme",
    })
    result = run(project, config={"smart_ziw_repo_path": str(tmp_path), "smart_ziw_skills_enabled": False, "smart_ziw_research_enabled": False})
    assert "research" not in result
    expected = {
        "README.md", "source.md", "analysis.md", "eligibility.md",
        "risks.md", "pricing.md", "recap.md", "next-actions.md",
    }
    assert expected.issubset(set(result["files"]))
    folder = tmp_path / result["folder"]
    for name in expected:
        assert (folder / name).exists()


def test_push_to_gitlab_excludes_documents_binaries(tmp_path, monkeypatch):
    monkeypatch.setattr("smart_ziw_gitlab._preflight_gitlab_api", lambda *a, **k: (True, "ok"))
    repo_path = tmp_path / "mirror-repo"
    repo_path.mkdir()
    folder = repo_path / "folder"
    folder.mkdir()
    (folder / "README.md").write_text("test", encoding="utf-8")
    docs = folder / "documents"
    docs.mkdir()
    (docs / "dce.pdf").write_bytes(b"%PDF-1.4")
    config = {
        "gitlab_push_enabled": True,
        "gitlab_base_url": "https://127.0.0.1:1",
        "gitlab_project_path": "test/repo",
        "gitlab_token": "t",
        "gitlab_branch": "main",
    }
    result = push_to_gitlab(repo_path, "folder", config)
    assert result["pushed"] is False  # unroutable host; commit still happens locally
    tracked = subprocess.check_output(["git", "ls-files"], cwd=str(repo_path), text=True)
    assert "folder/README.md" in tracked
    assert "documents" not in tracked


def test_push_to_gitlab_config_missing_skips():
    result = push_to_gitlab(Path("/tmp/fake"), "folder", {})
    assert result["pushed"] is False
    assert "disabled" in result["message"].lower()


def test_push_to_gitlab_incomplete_config():
    config = {
        "gitlab_push_enabled": True,
        "gitlab_base_url": "http://localhost:8080",
        "gitlab_project_path": "root/repo",
        "gitlab_token": "",
        "gitlab_branch": "main",
    }
    result = push_to_gitlab(Path("/tmp/fake"), "folder", config)
    assert result["pushed"] is False
    assert result["message"] == "GitLab config incomplete"


def test_push_to_gitlab_preflight_failure_returns_early(tmp_path, monkeypatch):
    monkeypatch.setattr("smart_ziw_gitlab._preflight_gitlab_api", lambda *a, **k: (False, "Project not found"))
    repo_path = tmp_path / "mirror-repo"
    repo_path.mkdir()
    (repo_path / "folder").mkdir()
    (repo_path / "folder" / "README.md").write_text("test", encoding="utf-8")
    config = {
        "gitlab_push_enabled": True,
        "gitlab_base_url": "https://127.0.0.1:1",
        "gitlab_project_path": "test/repo",
        "gitlab_token": "t",
        "gitlab_branch": "main",
    }
    result = push_to_gitlab(repo_path, "folder", config)
    assert result["pushed"] is False
    assert "connection check failed" in result["message"].lower()
    assert "Project not found" in result["message"]
    assert not (repo_path / ".git").exists()


def test_push_to_gitlab_token_never_persisted_or_leaked(tmp_path, monkeypatch):
    monkeypatch.setattr("smart_ziw_gitlab._preflight_gitlab_api", lambda *a, **k: (True, "ok"))
    repo_path = tmp_path / "mirror-repo"
    repo_path.mkdir()
    (repo_path / "folder").mkdir()
    (repo_path / "folder" / "README.md").write_text("test", encoding="utf-8")
    token = "super-secret-token-12345"
    config = {
        "gitlab_push_enabled": True,
        "gitlab_base_url": "https://127.0.0.1:1",
        "gitlab_project_path": "test/repo",
        "gitlab_token": token,
        "gitlab_branch": "main",
    }
    result = push_to_gitlab(repo_path, "folder", config)
    assert result["pushed"] is False
    assert token not in result["message"]
    config_text = ""
    if (repo_path / ".git" / "config").exists():
        config_text = (repo_path / ".git" / "config").read_text(encoding="utf-8")
    assert token not in config_text
    assert (repo_path / ".git").exists()


def test_push_to_gitlab_exposed_via_agent():
    from smart_ziw_agent import push_to_gitlab as agent_push
    assert callable(agent_push)
    result = agent_push(Path("/tmp/fake"), "folder", {})
    assert result["pushed"] is False
    assert "disabled" in result["message"].lower()


def test_enrich_uses_injected_llm_call():
    project = {"project_name": "IS Security Audit"}
    captured = {}

    def fake_call(system, user):
        captured["system"] = system
        captured["user"] = user
        return {"source_markdown": "source"}

    enrichment = _enrich(project, llm_call=fake_call)
    assert captured["system"] == ENRICH_PROMPT
    assert "IS Security Audit" in captured["user"]
    assert enrichment["source_markdown"] == "source"


def test_enrich_error_message_is_provider_neutral(monkeypatch):
    project = {"project_name": "IS Security Audit"}

    def _raise(*args, **kwargs):
        raise RuntimeError("API down")

    monkeypatch.setattr("smart_ziw_agent._call_llm", _raise)
    enrichment = _enrich(project)
    assert "LLM enrichment failed" in enrichment["error"]
    assert "DeepSeek" not in enrichment["error"]


def test_run_passes_selected_llm_call_to_research_and_synthesis(monkeypatch, tmp_path):
    project = {"project_name": "IS Security Audit", "project_end_date": "2026-07-13"}
    sentinel = lambda system, user: {}
    seen = {}

    monkeypatch.setattr("smart_ziw_llm.get_llm_call", lambda config, json_mode=True: sentinel)

    def fake_run_research(project, config, folder_path=None, llm_call=None, thread_context=""):
        seen["run_research_llm_call"] = llm_call
        research = ResearchResult(
            verdict={"recommendation": "GO", "reasoning": ""},
            stats={"queries_run": 1, "pages_scraped": 0, "documents_captured": 0},
        )
        return research

    def fake_synthesize(project, research, llm_call=None, thread_context=""):
        seen["synthesize_llm_call"] = llm_call
        return {
            "source_markdown": "s", "analysis_markdown": "a", "eligibility_markdown": "e",
            "risks_markdown": "r", "pricing_markdown": "p", "recap_markdown": "c",
            "readme_markdown": "readme",
        }

    monkeypatch.setattr("smart_ziw_research.run_research", fake_run_research)
    monkeypatch.setattr("smart_ziw_research.synthesize", fake_synthesize)
    monkeypatch.setattr("smart_ziw_research.firecrawl_mcp_available", lambda: True)
    result = run(project, config={
        "smart_ziw_repo_path": str(tmp_path),
        "smart_ziw_research_enabled": True,
        "smart_ziw_skills_enabled": False,
    })
    assert seen["run_research_llm_call"] is sentinel
    assert seen["synthesize_llm_call"] is sentinel
    assert result["research_verdict"] == "GO"


def test_run_passes_selected_llm_call_to_enrichment(monkeypatch, tmp_path):
    project = {"project_name": "IS Security Audit", "project_end_date": "2026-07-13"}
    sentinel = lambda system, user: {"source_markdown": "source"}
    seen = {}

    monkeypatch.setattr("smart_ziw_llm.get_llm_call", lambda config, json_mode=True: sentinel)
    monkeypatch.setattr("smart_ziw_research.firecrawl_mcp_available", lambda: False)

    def fake_enrich(project, config=None, llm_call=None, thread_context=""):
        seen["enrich_llm_call"] = llm_call
        return _default_enrichment()

    monkeypatch.setattr("smart_ziw_agent._enrich", fake_enrich)
    result = run(project, config={"smart_ziw_repo_path": str(tmp_path), "smart_ziw_skills_enabled": False})
    assert seen["enrich_llm_call"] is sentinel
    assert "analysis.md" in result["files"]


def test_run_passes_thread_context_to_enrichment(monkeypatch, tmp_path):
    project = {"project_name": "IS Security Audit", "project_end_date": "2026-07-13"}
    seen = {}

    def fake_enrich(project, config=None, llm_call=None, thread_context=""):
        seen["thread_context"] = thread_context
        return _default_enrichment()

    monkeypatch.setattr("smart_ziw_agent._enrich", fake_enrich)
    monkeypatch.setattr("smart_ziw_research.firecrawl_mcp_available", lambda: False)
    run(project, config={"smart_ziw_repo_path": str(tmp_path), "smart_ziw_skills_enabled": False}, thread_context="user asked for pricing")
    assert seen["thread_context"] == "user asked for pricing"


def test_run_provider_failure_writes_default_files_with_error(monkeypatch, tmp_path):
    project = {"project_name": "IS Security Audit", "project_end_date": "2026-07-13"}

    def _fail(config, json_mode=True):
        raise RuntimeError("LightLLM base URL is not configured")

    def _no_enrich(*args, **kwargs):
        raise AssertionError("_enrich must not be called when the provider failed")

    monkeypatch.setattr("smart_ziw_llm.get_llm_call", _fail)
    monkeypatch.setattr("smart_ziw_agent._enrich", _no_enrich)
    result = run(project, config={
        "smart_ziw_repo_path": str(tmp_path),
        "smart_ziw_research_enabled": True,
        "smart_ziw_llm_provider": "lightllm",
        "lightllm_base_url": "",
        "smart_ziw_skills_enabled": False,
    })
    assert "LightLLM base URL is not configured" in result["error"]
    assert "research" not in result
    folder = tmp_path / result["folder"]
    assert (folder / "analysis.md").exists()
    assert (folder / "next-actions.md").exists()


def _action_row(action):
    return {"action": action, "priority": "HIGH", "owner": "o", "deadline": "d", "notes": "n"}


def test_human_only_actions_keeps_and_drops_fixture_rows():
    rows = [
        _action_row("Send clarification email to buyer"),
        _action_row("Assemble bid team and assign responsibilities"),
        _action_row("Submit proposal before deadline"),
        _action_row("Draft and review proposal document"),
        _action_row("Review eligibility criteria and compliance requirements"),
        _action_row("Prepare pricing model"),
        _action_row("Develop technical solution proposal"),
        _action_row("Obtain full tender document from official SAWES eTender portal"),
    ]
    kept = _human_only_actions(rows)
    assert [row["action"] for row in kept] == [
        "Send clarification email to buyer",
        "Assemble bid team and assign responsibilities",
        "Submit proposal before deadline",
    ]


def test_human_only_actions_handles_malformed_rows():
    rows = [
        _action_row("Draft the proposal"),
        "not a dict",
        None,
        {"priority": "HIGH"},
        {"action": ""},
        _action_row("Submit proposal"),
    ]
    kept = _human_only_actions(rows)
    assert [row["action"] for row in kept] == ["Submit proposal"]


def test_human_only_actions_keeps_unknown_phrasing():
    kept = _human_only_actions([_action_row("Arrange the kick-off meeting"), _action_row("Book courier for hard copies")])
    assert [row["action"] for row in kept] == ["Arrange the kick-off meeting", "Book courier for hard copies"]


def test_human_only_actions_keeps_marker_verbs_even_with_drop_verb_first():
    kept = _human_only_actions([_action_row("Obtain management approval to proceed")])
    assert len(kept) == 1


def test_next_actions_renderer_notes_when_all_rows_automated():
    project = {"project_name": "IS Security Audit"}
    enrichment = {"next_actions": [_action_row("Draft and review proposal document")]}
    from smart_ziw_agent import _render_next_actions_markdown
    markdown = _render_next_actions_markdown(project, enrichment)
    assert "no human-only actions remain" in markdown
    assert "Draft and review" not in markdown


def test_run_with_skills_path(monkeypatch, tmp_path):
    import json as _json

    project = {
        "project_name": "IS Security Audit",
        "project_sponsor": "CDC Benin",
        "primary_country_name_en": "Benin",
        "project_end_date": "2026-07-13",
        "project_url": "https://example.com/tender",
        "source": "Global Tenders",
        "project_description": "Audit and pentesting.",
    }
    skill_content = {
        "source_markdown": "# Source\n\nverified",
        "analysis_markdown": "# Analysis\n\nGO",
        "eligibility_markdown": "# Eligibility\n\nok",
        "risks_markdown": "# Risks\n\nlow",
        "pricing_markdown": "# Pricing\n\nUSD 1000",
        "recap_markdown": "# Tender Recap\n\nGO",
        "readme_markdown": "# README\n\nfolder",
        "documents_notes_markdown": "# Documents\n\nnone",
        "next_actions": [{"action": "Submit proposal", "priority": "HIGH", "owner": "Bid team", "deadline": "2026-07-10", "notes": ""}],
    }

    class FakeMessage:
        content = _json.dumps(skill_content)
        tool_calls = None

    class FakeResponse:
        message = FakeMessage()

    monkeypatch.setattr("smart_ziw_llm.get_llm_tool_call", lambda config: lambda messages, tools: FakeResponse())
    monkeypatch.setattr("smart_ziw_llm.get_llm_call", lambda config, json_mode=True: lambda s, u: skill_content)
    result = run(project, config={"smart_ziw_repo_path": str(tmp_path)})
    expected = {
        "README.md", "source.md", "analysis.md", "eligibility.md",
        "risks.md", "pricing.md", "recap.md", "next-actions.md",
    }
    assert expected.issubset(set(result["files"]))
    folder = tmp_path / result["folder"]
    for name in expected:
        assert (folder / name).exists()
    assert "GO" in (folder / "analysis.md").read_text(encoding="utf-8")
    assert (folder / "documents" / "notes.md").exists()
