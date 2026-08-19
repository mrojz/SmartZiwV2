"""Skill that checks Forvis Mazars in-country presence."""
from __future__ import annotations

from smart_ziw_skills.base import Skill


def _check_forvis_presence(country: str, **context) -> dict:
    from smart_ziw_presence import has_forvis_mazars_presence

    config = context.get("config") or {}
    return has_forvis_mazars_presence(country, config_countries=config.get("forvis_mazars_presence_countries"))


presence_skill = Skill(
    id="check_forvis_presence",
    name="Check Forvis Mazars presence",
    description="Check whether Forvis Mazars has an office in the given country.",
    parameters={
        "type": "object",
        "properties": {
            "country": {
                "type": "string",
                "description": "Country name to check for Forvis Mazars presence.",
            },
        },
        "required": ["country"],
    },
    handler=_check_forvis_presence,
)
