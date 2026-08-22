"""Base types and registry for Smart-Ziw skills (LLM tool-calling functions)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class Skill:
    """A tool-callable skill exposed to the Smart-Ziw LLM."""

    id: str
    name: str
    description: str
    parameters: dict = field(default_factory=lambda: {"type": "object", "properties": {}})
    handler: Callable = field(default_factory=lambda: lambda **kwargs: None)
    source_url: str = ""
    built_in: bool = True
    enabled: bool = True


class SkillRegistry:
    """Holds skills and adapts them to OpenAI tool definitions."""

    def __init__(self, skills: list[Skill]):
        self._skills = list(skills or [])
        self._by_id = {skill.id: skill for skill in self._skills}

    def enabled_skills(self) -> list[Skill]:
        """Return skills that are currently enabled."""
        return [skill for skill in self._skills if skill.enabled]

    def to_tools(self) -> list[dict]:
        """Return OpenAI-compatible tool definitions for enabled skills."""
        tools = []
        for skill in self.enabled_skills():
            tools.append({
                "type": "function",
                "function": {
                    "name": skill.id,
                    "description": skill.description,
                    "parameters": skill.parameters,
                },
            })
        return tools

    def execute(self, skill_id: str, arguments: dict, **context) -> Any:
        """Run a skill handler, catching exceptions and returning {"error": str}."""
        skill = self.by_id(skill_id)
        if skill is None:
            return {"error": f"Skill {skill_id!r} not found"}
        try:
            return skill.handler(**arguments, **context)
        except Exception as exc:
            return {"error": str(exc)}

    def by_id(self, skill_id: str) -> Skill | None:
        """Look up a skill by its id."""
        return self._by_id.get(skill_id)
