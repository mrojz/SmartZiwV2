"""Built-in Smart-Ziw skills package."""
from __future__ import annotations

from smart_ziw_skills.base import Skill, SkillRegistry
from smart_ziw_skills.currency import currency_skill
from smart_ziw_skills.documents import documents_skill
from smart_ziw_skills.metadata import metadata_skill
from smart_ziw_skills.presence import presence_skill
from smart_ziw_skills.research import research_skill
from smart_ziw_skills.travel import travel_skill


def load_builtin_skills() -> list[Skill]:
    """Return the built-in skill set."""
    return [
        metadata_skill,
        presence_skill,
        currency_skill,
        travel_skill,
        research_skill,
        documents_skill,
    ]


__all__ = [
    "Skill",
    "SkillRegistry",
    "load_builtin_skills",
    "currency_skill",
    "documents_skill",
    "metadata_skill",
    "presence_skill",
    "research_skill",
    "travel_skill",
]
