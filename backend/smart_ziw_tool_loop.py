"""Tool-calling loop that drives Smart-Ziw skills."""
from __future__ import annotations

import json
from typing import Any, Callable

from smart_ziw_skills.base import SkillRegistry


def run_tool_loop(
    registry: SkillRegistry,
    llm_tool_call: Callable[[list[dict], list[dict] | None], Any],
    messages: list[dict],
    context: dict,
    max_iterations: int = 10,
) -> dict:
    """Run an LLM tool-calling loop using ``registry``.

    The loop asks the LLM to choose tools, executes enabled skills, appends
    tool results, and repeats until the model returns a final message or the
    iteration cap is reached. The final message content is parsed as JSON.
    """
    for _ in range(max_iterations):
        tools = registry.to_tools() or None
        response = llm_tool_call(messages, tools)
        tool_calls = getattr(getattr(response, "message", None), "tool_calls", None)
        if tool_calls:
            assistant_msg = {
                "role": "assistant",
                "content": getattr(response.message, "content", "") or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": json.dumps(tc.function.arguments) if isinstance(tc.function.arguments, dict) else str(tc.function.arguments),
                        },
                    }
                    for tc in tool_calls
                ],
            }
            messages.append(assistant_msg)
            for tc in tool_calls:
                try:
                    arguments = json.loads(tc.function.arguments) if isinstance(tc.function.arguments, str) else dict(tc.function.arguments or {})
                except Exception:
                    arguments = {}
                result = registry.execute(tc.function.name, arguments, **context)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, default=str),
                })
            continue
        content = getattr(getattr(response, "message", None), "content", None) or ""
        from smart_ziw_agent import _safe_json_loads
        return _safe_json_loads(content)
    return {"error": "max iterations reached"}
