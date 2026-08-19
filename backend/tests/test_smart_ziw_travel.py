import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_travel import estimate_travel


def test_estimate_travel_returns_structure():
    result = estimate_travel("France", duration_days=5, consultants=2)
    assert result["flight_usd"] > 0
    assert result["hotel_usd"] > 0
    assert result["allowance_eur"] > 0
    assert result["total_usd"] > 0
    assert "France" in result["notes"]


def test_estimate_travel_no_country():
    result = estimate_travel("")
    assert result["total_usd"] == 0
    assert "No destination" in result["notes"]


def test_estimate_travel_allowance_calculation():
    result = estimate_travel("Morocco", duration_days=3, consultants=2)
    assert result["allowance_eur"] == 300  # 50 * 3 * 2
