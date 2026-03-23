import json
import json
import os
import re

from openai import OpenAI


DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_WEB_MODEL = os.environ.get("DEEPSEEK_WEB_MODEL", os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"))

SYSTEM_PROMPT = """You are a procurement research assistant with web search capability.
Use web search yourself. Do not ask the caller to fetch pages for you.
Given a tender name, description, country, and current source details, identify the likely original tender source and gather the most useful facts directly from search results and reachable public pages.
Return only valid JSON with this exact schema:
{
  "source_name": "string",
  "primary_url": "string",
  "supporting_urls": ["string"],
  "findings": ["string"],
  "summary": "string",
  "document_urls": ["string"],
  "confidence": "high|medium|low",
  "notes": "string"
}
Rules:
- The search and information gathering must be done by you using web search.
- Prefer the original procurement or tender notice page.
- Include document URLs only when you are reasonably confident they are relevant.
- Keep summary short: 1-2 concise sentences about what the project is about.
- Keep findings factual and concise.
- If no trustworthy result is found, leave URLs empty and explain why in notes.
- Do not include markdown outside JSON.
"""


def _deepseek_client():
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DeepSeek API key is not configured")
    return OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)


def _safe_json_loads(content: str) -> dict:
    text = (content or "").strip()
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return {}
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}


def run_deep_dive_research(project: dict) -> dict:
    client = _deepseek_client()
    user_prompt = "\n".join([
        f"Tender name: {project.get('project_name') or ''}",
        f"Tender description: {project.get('project_description') or ''}",
        f"Country: {project.get('primary_country_name_en') or project.get('project_sponsor') or ''}",
        f"Current source: {project.get('source') or ''}",
        f"Current project URL: {project.get('project_url') or ''}",
    ])
    response = client.chat.completions.create(
        model=DEEPSEEK_WEB_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
        max_tokens=1600,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    research = _safe_json_loads(content)
    return {
        "source_name": str(research.get("source_name") or "").strip(),
        "primary_url": str(research.get("primary_url") or "").strip(),
        "supporting_urls": [str(url).strip() for url in (research.get("supporting_urls") or []) if str(url).strip()][:5],
        "findings": [str(item).strip() for item in (research.get("findings") or []) if str(item).strip()][:6],
        "summary": str(research.get("summary") or "").strip(),
        "document_urls": [str(url).strip() for url in (research.get("document_urls") or []) if str(url).strip()][:5],
        "confidence": str(research.get("confidence") or "low").strip().lower() or "low",
        "notes": str(research.get("notes") or "").strip(),
    }
