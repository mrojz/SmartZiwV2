import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_presence import has_forvis_mazars_presence


def test_presence_true_for_configured_country():
    result = has_forvis_mazars_presence("France", config_countries=["france", "tunisia"])
    assert result["present"] is True
    assert result["confidence"] == "high"


def test_presence_false_for_unknown_country():
    result = has_forvis_mazars_presence("Atlantis", config_countries=["france"])
    assert result["present"] is False


def test_presence_uses_default_list_when_config_empty():
    result = has_forvis_mazars_presence("Tunisia")
    assert result["present"] is True


def test_presence_normalizes_case_and_whitespace():
    result = has_forvis_mazars_presence("  TUNISIA  ", config_countries=["tunisia"])
    assert result["present"] is True
