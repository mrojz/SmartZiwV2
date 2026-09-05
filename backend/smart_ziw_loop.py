"""Smart-Ziw LLM tool-loop runner with audit trail."""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from smart_ziw_llm import LLMClient
from smart_ziw_tools import Tool

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """You are Smart-Ziw, an assistant that analyzes public procurement tenders.

Your job:
1. Fetch the tender from the aggregator.
2. Find the buyer's official source page using email domains and/or web search.
3. Find downloadable documents on the source page; if none, search the web.
4. Download and analyze the documents.
5. Post a concise, structured recap as a comment via post_smart_ziw_comment.

Rules:
- Do not ask the user questions.
- If you cannot identify the buyer source, set source_url to "" and explain in the comment.
- If a document URL is found but cannot be downloaded, list it as a clickable link under "Files we could not retrieve".
- Include an "Audit trail" section at the end of the comment summarizing each tool you called.
- Always terminate by calling post_smart_ziw_comment.
"""


class SmartZiwToolLoop:
    def __init__(
        self,
        llm: LLMClient,
        tools: dict[str, Tool],
        max_iterations: int = 15,
    ):
        self.llm = llm
        self.tools = tools
        self.max_iterations = max_iterations

    def _tools_for_llm(self) -> list[dict[str, Any]]:
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema,
            }
            for tool in self.tools.values()
        ]

    async def run(
        self,
        tender: dict[str, Any],
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        run_id = str(uuid.uuid4())
        messages: list[dict[str, Any]] = [
            {"role": "user", "content": f"Tender context: {tender}"},
        ]
        audit: list[dict[str, Any]] = []
        final_status = "error"
        comment_id: str | None = None
        error: str | None = None

        for iteration in range(self.max_iterations):
            response = await self.llm.chat(
                messages=messages,
                tools=self._tools_for_llm(),
                system=system_prompt or _SYSTEM_PROMPT,
            )

            if not response.get("tool_calls"):
                error = "LLM did not call a tool. Asking it to terminate."
                messages.append({"role": "user", "content": "You must call post_smart_ziw_comment now."})
                continue

            for tc in response["tool_calls"]:
                tool_name = tc["name"]
                arguments = tc["arguments"]
                step = {
                    "step": iteration + 1,
                    "tool": tool_name,
                    "input": arguments,
                    "started_at": time.time(),
                }
                try:
                    tool = self.tools[tool_name]
                    output = await tool.handler(arguments)
                except Exception as exc:  # noqa: BLE001
                    output = {"status": "error", "error": str(exc)}
                step["output"] = output
                step["duration_ms"] = int((time.time() - step["started_at"]) * 1000)
                audit.append(step)
                err = str(output.get("error") or "")[:120] if isinstance(output, dict) else ""
                logger.info(
                    "smart-ziw tool=%s status=%s duration_ms=%d%s",
                    tool_name,
                    output.get("status") if isinstance(output, dict) else "?",
                    step["duration_ms"],
                    f" error={err}" if err else "",
                )

                messages.append({
                    "role": "assistant",
                    "content": f"Called {tool_name}({arguments})",
                })
                messages.append({
                    "role": "user",
                    "content": f"Result: {output}",
                })

                if tool_name == "post_smart_ziw_comment":
                    if output.get("status") == "ok":
                        final_status = "success"
                        comment_id = output.get("comment_id")
                    else:
                        final_status = "error"
                        error = output.get("error", "post_smart_ziw_comment failed")
                    return {
                        "run_id": run_id,
                        "final_status": final_status,
                        "comment_id": comment_id,
                        "audit": audit,
                        "error": error,
                    }

        error = error or f"Exceeded max iterations ({self.max_iterations}) without posting a comment."
        return {
            "run_id": run_id,
            "final_status": final_status,
            "comment_id": comment_id,
            "audit": audit,
            "error": error,
        }
