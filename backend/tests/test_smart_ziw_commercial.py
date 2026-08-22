import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_commercial import convert_currency, is_european_country, format_value


def test_is_european_country_recognizes_france():
    assert is_european_country("France") is True
    assert is_european_country("United States") is False


def test_convert_currency_returns_dict():
    result = convert_currency(100, "USD", "EUR")
    assert isinstance(result, dict)
    assert result["currency"] == "EUR"
    assert "approximate" in result


def test_format_value_includes_usd_and_eur():
    text = format_value({
        "original_amount": 100,
        "original_currency": "USD",
        "usd_amount": 110,
        "eur_amount": 100,
    })
    assert "100 USD" in text
    assert "100 EUR" in text
    assert "110 USD" in text
