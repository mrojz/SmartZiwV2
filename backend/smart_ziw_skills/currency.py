"""Skill that converts a tender value to USD."""
from __future__ import annotations

from smart_ziw_skills.base import Skill


def _convert_currency(amount: float, from_currency: str, **context) -> dict:
    from smart_ziw_commercial import convert_currency

    llm_call = context.get("llm_call")
    return convert_currency(amount, from_currency, "USD", llm_call=llm_call)


currency_skill = Skill(
    id="convert_currency",
    name="Convert currency",
    description="Convert an amount from a source currency to USD.",
    parameters={
        "type": "object",
        "properties": {
            "amount": {
                "type": "number",
                "description": "Amount in the source currency.",
            },
            "from_currency": {
                "type": "string",
                "description": "ISO currency code (e.g. TND, EUR, GBP).",
            },
        },
        "required": ["amount", "from_currency"],
    },
    handler=_convert_currency,
)
