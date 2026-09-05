"""Skill registry for Smart-Ziw.

Deprecated surface: this store backs the legacy ``run_with_skills`` flow,
which only runs when the configured LLM provider is not Anthropic-compatible
(the tool loop at ``smart_ziw_agent.run_tool_loop`` is the primary engine and
does not use skills). The admin tab and the custom-skill machinery
(fetch-from-URL, stored custom skill execution) were removed: custom skills
were remote-code-execution by design and redundant with MCP servers. Any
``_type: smart_ziw_skills`` docs still in MongoDB are inert — they are only
read here for built-in enabled/disabled overrides.
"""
from __future__ import annotations

from dataclasses import asdict

from smart_ziw_skills.base import Skill, SkillRegistry


def load_builtin_skills() -> list[Skill]:
    """Return built-in skills flagged as built_in=True and enabled=True."""
    from smart_ziw_skills import load_builtin_skills as _load_builtin

    return [Skill(**{**asdict(skill), "built_in": True, "enabled": True}) for skill in _load_builtin()]


def get_registry(config: dict | None = None) -> SkillRegistry:
    """Build a registry of built-in skills overlaid with DB state and MCP skills.

    Stored custom-skill entries are deliberately NOT reconstructed or executed
    (see module docstring).
    """
    from database import get_db

    merged = {skill.id: skill for skill in load_builtin_skills()}

    # Apply enabled/disabled state stored in DB (overrides defaults).
    db = get_db()
    doc = db.config.find_one({"_type": "smart_ziw_skills"}) or {}
    for state in doc.get("skills") or []:
        if not isinstance(state, dict):
            continue
        skill_id = state.get("id")
        if skill_id in merged and "enabled" in state:
            merged[skill_id].enabled = bool(state["enabled"])

    # Add MCP server skills; their ``mcp:`` prefix avoids collisions.
    try:
        import smart_ziw_mcp

        for skill in smart_ziw_mcp.get_mcp_skills(config):
            merged.setdefault(skill.id, skill)
    except Exception:
        pass

    return SkillRegistry(list(merged.values()))
