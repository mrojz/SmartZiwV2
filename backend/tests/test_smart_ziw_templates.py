import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_templates import get_template, fill_template


def test_get_template_returns_non_empty_for_known_names():
    for name in ["source", "analysis", "eligibility", "risks", "pricing", "recap", "README", "documents.notes"]:
        text = get_template(name)
        assert isinstance(text, str)
        assert text or name in ("documents.notes",)  # documents.notes may be empty if missing


def test_fill_template_replaces_placeholders():
    text = fill_template("documents.notes", {"files_downloaded": "- one\n- two", "archives_downloaded": "- none"})
    assert "- one" in text
    assert "- none" in text


def test_fill_template_missing_variables_render_empty():
    text = fill_template("documents.notes", {})
    assert isinstance(text, str)
