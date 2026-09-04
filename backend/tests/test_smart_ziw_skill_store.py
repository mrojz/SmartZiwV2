import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import smart_ziw_skill_store


class _FakeResponse:
    def __init__(self, text, content_type="text/plain; charset=utf-8"):
        self.headers = {"content-type": content_type}
        self._text = text

    def iter_content(self, chunk_size=65536):
        yield self._text.encode("utf-8")

    def raise_for_status(self):
        return None


_MARKDOWN_SKILL = """---
name: Tender Summarizer
description: Summarize a tender notice into scope, deadline, and buyer.
---

# Tender Summarizer

Use this skill to condense tender documents into a short structured brief.
"""


def _fake_get(text, content_type="text/plain; charset=utf-8"):
    def _get(url, headers=None, stream=True, timeout=30):
        return _FakeResponse(text, content_type)
    return _get


def test_fetch_markdown_skill_from_url(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.url_is_safe", lambda url: True)
    monkeypatch.setattr(smart_ziw_skill_store.requests, "get", _fake_get(_MARKDOWN_SKILL))

    skills = smart_ziw_skill_store.fetch_skill_from_url("https://example.com/skills/tender.md")
    assert len(skills) == 1
    skill = skills[0]
    assert skill.id == "tender-summarizer"
    assert skill.name == "Tender Summarizer"
    assert skill.description == "Summarize a tender notice into scope, deadline, and buyer."
    assert skill.built_in is False
    assert skill.source_url == "https://example.com/skills/tender.md"
    # The handler serves the markdown content back to the agent.
    assert skill.handler()["content"] == _MARKDOWN_SKILL

    # The markdown is carried into the stored state and survives reconstruction.
    state = smart_ziw_skill_store._skill_to_full_state(skill)
    assert state["markdown"] == _MARKDOWN_SKILL
    rebuilt = smart_ziw_skill_store._reconstruct_custom_skill({"id": state["id"], **state})
    assert rebuilt is not None
    assert rebuilt.handler()["content"] == _MARKDOWN_SKILL
    assert rebuilt.name == "Tender Summarizer"


def test_fetch_markdown_skill_without_frontmatter(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.url_is_safe", lambda url: True)
    body = "# Quick Check\n\nVerifies a tender deadline at a glance.\n\nMore details follow.\n"
    monkeypatch.setattr(smart_ziw_skill_store.requests, "get", _fake_get(body))

    skills = smart_ziw_skill_store.fetch_skill_from_url("https://example.com/quick-check.md")
    assert len(skills) == 1
    assert skills[0].name == "Quick Check"
    assert skills[0].description == "Verifies a tender deadline at a glance."
    assert skills[0].id == "quick-check"


def test_fetch_json_skill_from_url(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.url_is_safe", lambda url: True)
    payload = json.dumps({
        "id": "get_metadata_copy",
        "name": "Metadata copy",
        "description": "Return project metadata (test copy).",
        "handler_path": "smart_ziw_skills.metadata:_get_project_metadata",
        "parameters": {"type": "object", "properties": {}},
    })
    monkeypatch.setattr(smart_ziw_skill_store.requests, "get", _fake_get(payload, "application/json"))

    skills = smart_ziw_skill_store.fetch_skill_from_url("https://example.com/skills/meta.json")
    assert len(skills) == 1
    skill = skills[0]
    assert skill.id == "get_metadata_copy"
    assert skill.name == "Metadata copy"
    assert skill.description == "Return project metadata (test copy)."
    assert callable(skill.handler)


def test_fetch_markdown_by_content_type(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.url_is_safe", lambda url: True)
    body = "# Heading Skill\n\nDoes a thing.\n"
    monkeypatch.setattr(
        smart_ziw_skill_store.requests, "get",
        _fake_get(body, "text/markdown; charset=utf-8"),
    )
    skills = smart_ziw_skill_store.fetch_skill_from_url("https://example.com/skills/no-extension")
    assert len(skills) == 1
    assert skills[0].name == "Heading Skill"
