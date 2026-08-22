"""Currency conversion helpers for Smart-Ziw commercial estimates.

Tenders often state values in local currency. This module converts them to
USD for every tender, and to EUR when the tender country is European.
"""

from typing import Callable

import requests

# European Economic Area + Switzerland + United Kingdom. These countries get
# an automatic EUR conversion alongside USD.
_EUROPEAN_COUNTRIES = {
    "austria", "belgium", "bulgaria", "croatia", "cyprus", "czech republic",
    "czechia", "denmark", "estonia", "finland", "france", "germany", "greece",
    "hungary", "iceland", "ireland", "italy", "latvia", "liechtenstein",
    "lithuania", "luxembourg", "malta", "netherlands", "norway", "poland",
    "portugal", "romania", "slovakia", "slovenia", "spain", "sweden",
    "switzerland", "united kingdom", "uk", "republic of ireland",
}

_CONVERT_TIMEOUT_SECONDS = 8


def is_european_country(country_name: str) -> bool:
    return _normalize(country_name) in _EUROPEAN_COUNTRIES


def _normalize(value: str) -> str:
    return (value or "").strip().lower()


def _call_exchange_rate_api(from_currency: str, to_currency: str) -> float | None:
    """Best-effort live rate from a free public API. Returns None on failure."""
    try:
        response = requests.get(
            f"https://api.exchangerate-api.com/v4/latest/{from_currency.upper()}",
            timeout=_CONVERT_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
        rates = data.get("rates") or {}
        rate = rates.get(to_currency.upper())
        return float(rate) if rate is not None else None
    except Exception:
        return None


def _approximate_rate_via_llm(
    from_currency: str,
    to_currency: str,
    llm_call: Callable[[str, str], dict] | None = None,
) -> float | None:
    """Fallback: ask the LLM for an approximate rate, clearly labelled."""
    if llm_call is None:
        return None
    system = (
        "You are a currency assistant. Provide an approximate exchange rate "
        "as JSON with a single key 'rate'. Do not fabricate precision. "
        "If you are unsure, return {'rate': null}."
    )
    user = f"Approximate exchange rate from {from_currency.upper()} to {to_currency.upper()} today."
    try:
        result = llm_call(system, user)
        if isinstance(result, dict):
            rate = result.get("rate")
            if rate is not None:
                return float(rate)
    except Exception:
        pass
    return None


def convert_currency(
    amount: float,
    from_currency: str,
    to_currency: str,
    llm_call: Callable[[str, str], dict] | None = None,
) -> dict:
    """Convert ``amount`` from ``from_currency`` to ``to_currency``.

    Returns a dict with keys:
      - amount (float | None)
      - currency (str)
      - rate (float | None)
      - approximate (bool)
    """
    if amount is None or not from_currency or not to_currency:
        return {"amount": None, "currency": to_currency.upper(), "rate": None, "approximate": True}

    rate = _call_exchange_rate_api(from_currency, to_currency)
    approximate = False
    if rate is None:
        rate = _approximate_rate_via_llm(from_currency, to_currency, llm_call=llm_call)
        approximate = True

    if rate is None or rate <= 0:
        return {"amount": None, "currency": to_currency.upper(), "rate": None, "approximate": True}

    try:
        converted = round(float(amount) * float(rate), 2)
    except (TypeError, ValueError):
        return {"amount": None, "currency": to_currency.upper(), "rate": None, "approximate": True}

    return {
        "amount": converted,
        "currency": to_currency.upper(),
        "rate": round(rate, 6),
        "approximate": approximate,
    }


def format_value(value_dict: dict) -> str:
    """Render a value dict as a human-readable string.

    Expected keys: original_amount, original_currency, usd_amount, eur_amount.
    """
    parts = []
    original_amount = value_dict.get("original_amount")
    original_currency = value_dict.get("original_currency")
    if original_amount is not None and original_currency:
        parts.append(f"{original_amount} {original_currency}")

    usd_amount = value_dict.get("usd_amount")
    if usd_amount is not None:
        parts.append(f"≈ {usd_amount} USD")

    eur_amount = value_dict.get("eur_amount")
    if eur_amount is not None:
        parts.append(f"≈ {eur_amount} EUR")

    return " / ".join(parts) if parts else "not stated"
