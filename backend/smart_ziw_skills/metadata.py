"""Skill that returns the tender project metadata block."""
from __future__ import annotations

from smart_ziw_skills.base import Skill


def _get_project_metadata(**context) -> dict:
    project = context.get("project") or {}
    return {"metadata": project}


metadata_skill = Skill(
    id="get_project_metadata",
    name="Get project metadata",
    description="Return the full tender project record as metadata for the current analysis.",
    parameters={"type": "object", "properties": {}},
    handler=_get_project_metadata,
)
