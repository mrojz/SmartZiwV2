import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest


@pytest.mark.asyncio
async def test_loop_terminates_on_post_comment():
    from smart_ziw_loop import SmartZiwToolLoop
    from smart_ziw_tools import REGISTRY, Tool

    class FakeLLM:
        def __init__(self):
            self.calls = 0

        async def chat(self, messages, tools, system=None):
            self.calls += 1
            if self.calls == 1:
                return {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{"name": "post_smart_ziw_comment", "arguments": {"tender_id": "1", "content": "hi", "source_url": ""}}],
                    "stop_reason": "tool_use",
                }
            return {"role": "assistant", "content": "done", "tool_calls": [], "stop_reason": "end_turn"}

    async def fake_post(args):
        return {"comment_id": "c1", "status": "ok"}

    tools = dict(REGISTRY)
    tools["post_smart_ziw_comment"] = Tool(
        name="post_smart_ziw_comment",
        description="",
        input_schema={"type": "object", "properties": {}},
        handler=fake_post,
    )

    loop = SmartZiwToolLoop(llm=FakeLLM(), tools=tools, max_iterations=5)
    result = await loop.run(tender={"id": "1"}, system_prompt="test")
    assert result["final_status"] == "success"
    assert result["comment_id"] == "c1"
    assert len(result["audit"]) == 1
