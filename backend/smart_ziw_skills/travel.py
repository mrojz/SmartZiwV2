"""Skill that estimates consultant travel costs."""
from __future__ import annotations

from smart_ziw_skills.base import Skill


def _estimate_travel(country: str, duration_days: int = 5, consultants: int = 2, **context) -> dict:
    from smart_ziw_travel import estimate_travel

    return estimate_travel(country, duration_days=duration_days, consultants=consultants)


travel_skill = Skill(
    id="estimate_travel",
    name="Estimate travel",
    description="Estimate flight, hotel, and per-diem costs for consultants travelling from Tunisia.",
    parameters={
        "type": "object",
        "properties": {
            "country": {
                "type": "string",
                "description": "Destination country name.",
            },
            "duration_days": {
                "type": "integer",
                "description": "Number of days on site (default 5).",
                "default": 5,
            },
            "consultants": {
                "type": "integer",
                "description": "Number of consultants travelling (default 2).",
                "default": 2,
            },
        },
        "required": ["country"],
    },
    handler=_estimate_travel,
)
