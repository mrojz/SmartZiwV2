"""Skill that runs web research for a tender through a configured Firecrawl MCP server."""
from __future__ import annotations

from smart_ziw_skills.base import Skill


def _run_web_research(focus: str = "", **context) -> dict:
    from smart_ziw_research import run_research, synthesize

    project = context.get("project") or {}
    config = context.get("config") or {}
    folder_path = context.get("folder_path")
    llm_call = context.get("llm_call")
    thread_context = context.get("thread_context") or ""

    research = run_research(
        project,
        config,
        folder_path=folder_path,
        llm_call=llm_call,
        thread_context=thread_context,
    )
    # Preserve the raw research result so the agent can include stats/verdict in its final output.
    if isinstance(context, dict):
        context["research_result"] = research
    if research.error:
        return {
            "success": False,
            "error": research.error,
            "synthesis": None,
            "stats": research.stats,
            "verdict": research.verdict,
            "timed_out": bool(research.timed_out),
        }
    synthesis = synthesize(project, research, llm_call=llm_call, thread_context=thread_context)
    return {
        "success": not bool(synthesis.get("_error")),
        "error": synthesis.get("_error", ""),
        "synthesis": synthesis,
        "stats": research.stats,
        "verdict": research.verdict,
        "timed_out": bool(research.timed_out),
    }


research_skill = Skill(
    id="run_web_research",
    name="Run web research",
    description="Run web research on the tender through a configured Firecrawl MCP server and return a grounded synthesis with sources.",
    parameters={
        "type": "object",
        "properties": {
            "focus": {
                "type": "string",
                "description": "Optional area to focus the research (e.g. eligibility, pricing).",
            },
        },
    },
    handler=_run_web_research,
)
