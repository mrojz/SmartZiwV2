import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from openai import OpenAI


from smart_ziw_gitlab import push_to_gitlab


def _safe_slug(text: str, max_len: int = 50) -> str:
    text = re.sub(r"[^\w\s-]", "", text or "")
    text = re.sub(r"[-\s]+", "-", text).strip("-")
    return text[:max_len].strip("-")


def _format_date_for_folder(value: str) -> str:
    if not value:
        return datetime.now().strftime("%d%m%Y")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.strftime("%d%m%Y")
    except Exception:
        pass
    try:
        dt = datetime.strptime(value, "%Y-%m-%d")
        return dt.strftime("%d%m%Y")
    except Exception:
        pass
    return datetime.now().strftime("%d%m%Y")


def build_folder_name(project: dict) -> str:
    """New spec: DDMMYYYY-{{tender_name}}."""
    deadline = _format_date_for_folder(project.get("project_end_date") or project.get("effective_deadline") or "")
    title = _safe_slug(project.get("project_name") or project.get("project_description") or "Tender")
    # Remove common leading procurement filler words for a concise folder title
    title = re.sub(r"^(recruitment-of-an-|recruitment-of-|recruitment-for-|supply-of-|provision-of-)", "", title, flags=re.IGNORECASE)
    return f"{deadline}-{title}" if title else deadline


def _escape_table_cell(value) -> str:
    text = str(value or "")
    text = text.replace("|", "\\|")
    text = text.replace("\n", " ")
    text = text.replace("\r", " ")
    return text


def _deepseek_client():
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")
    return OpenAI(api_key=api_key, base_url=base_url, timeout=120.0)


def _safe_json_loads(content: str) -> dict:
    text = (content or "").strip()
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            text = parts[1]
            if text.lower().startswith("json"):
                text = text[4:]
            text = text.strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass
    start = text.find("{")
    if start == -1:
        return {}
    try:
        parsed, _ = json.JSONDecoder().raw_decode(text, start)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _call_llm(system_prompt: str, user_prompt: str) -> dict:
    client = _deepseek_client()
    model = os.environ.get("DEEPSEEK_MODEL", os.environ.get("DEEPSEEK_WEB_MODEL", "deepseek-chat"))
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
        max_tokens=4000,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    return _safe_json_loads(content)


CHAT_PROMPT = """You are Smart-Ziw, the tender-bidding assistant for this procurement platform.
Answer the user's comment about the project using only the provided context.
Be concise: a short paragraph or a bullet list. Cite project facts accurately.
If the question needs full web research, tell the user to trigger the Smart-Ziw agent run for this project."""


def _default_enrichment() -> dict:
    return {
        "recap_markdown": "",
        "references": [],
    }


def _normalize_url(url: str) -> str:
    parsed = urlparse(url)
    query = "&".join(
        part for part in parsed.query.split("&")
        if not part.lower().startswith(("utm_", "fbclid", "gclid"))
    )
    return urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path, "", query, ""))


def _build_references_from_research(research) -> list[dict]:
    if not research or not research.items:
        return []
    numbers = research.citation_map
    refs = []
    used = set()
    for item in research.items:
        number = numbers.get(_normalize_url(item.url))
        if number is not None and number not in used:
            used.add(number)
            refs.append({
                "number": number,
                "title": item.title or item.url,
                "url_or_path": item.url,
            })
    return refs


def _inject_source_reference(references: list[dict], source_url: str, title: str = "") -> None:
    if not source_url:
        return
    normalized = _normalize_url(source_url)
    if any(_normalize_url(str(r.get("url_or_path") or "")) == normalized for r in references):
        return
    references.insert(0, {
        "number": 1,
        "title": title or "Original source",
        "url_or_path": source_url,
    })
    for idx, ref in enumerate(references[1:], start=2):
        ref["number"] = idx


def _coerce_skill_result(content: dict, research) -> dict:
    """Make sure a skill-loop result has a recap, references, and the discovered source."""
    if not isinstance(content, dict):
        content = {}
    recap = str(content.get("recap_markdown") or "").strip()
    if not recap:
        recap = "# Tender Recap\n\nNo verifiable recap was generated for this tender."

    references = content.get("references")
    if not isinstance(references, list):
        references = _build_references_from_research(research)

    cleaned = []
    used_numbers = set()
    for ref in references:
        if isinstance(ref, dict):
            number = ref.get("number")
            try:
                number = int(number)
            except (TypeError, ValueError):
                number = None
            if number is not None and number not in used_numbers:
                used_numbers.add(number)
                cleaned.append({
                    "number": number,
                    "title": str(ref.get("title") or "").strip(),
                    "url_or_path": str(ref.get("url_or_path") or "").strip(),
                })

    if research and research.source_url:
        _inject_source_reference(
            cleaned,
            research.source_url,
            research.buyer or research.requesting_company or "Original source",
        )

    if not cleaned and research and research.items:
        cleaned = _build_references_from_research(research)

    content["recap_markdown"] = recap
    content["references"] = cleaned

    if research and research.source_url and research.source_url not in recap:
        source_section = (
            "\n\n---\n\n## Original source\n"
            f"- [{research.buyer or research.requesting_company or 'Original source'}]({research.source_url})"
        )
        content["recap_markdown"] = recap.rstrip() + source_section

    return content


def _human_only_actions(rows: list) -> list[dict]:
    """Keep only next-action rows the LLM cannot perform itself."""
    keep_markers = (
        "submit", "sign", "pay", "notariz", "register", "attend", "meet", "team",
        "bank guarantee", "bid bond", "authorized", "approval", "call", "negotiat",
    )
    drop_verbs = (
        "draft", "prepare", "review", "write", "summarize", "summarise", "research",
        "analyze", "analyse", "compare", "compile", "create", "generate", "obtain",
        "retrieve", "download", "check", "verify", "assess", "evaluate", "estimate",
        "calculate", "develop", "plan", "translate", "extract", "gather", "collect",
        "find", "list", "outline",
    )
    kept = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        text = str(row.get("action") or "").strip().lower()
        if not text:
            continue
        if "send" in text and "email" in text:
            kept.append(row)
            continue
        if any(marker in text for marker in keep_markers):
            kept.append(row)
            continue
        if text.split()[0] in drop_verbs:
            continue
        kept.append(row)
    return kept


def _metadata_block(project: dict) -> str:
    return "\n".join([
        f"Tender name: {project.get('project_name') or ''}",
        f"Buyer: {project.get('project_sponsor') or ''}",
        f"Country: {project.get('primary_country_name_en') or ''}",
        f"Deadline: {project.get('project_end_date') or project.get('effective_deadline') or ''}",
        f"Source: {project.get('source') or ''}",
        f"Source URL: {project.get('project_url') or ''}",
        f"Description: {project.get('project_description') or ''}",
    ])


def _collect_helper_context(project: dict, config: dict) -> dict:
    """Gather non-LLM helper facts (presence, currency, travel) for prompts."""
    from smart_ziw_presence import has_forvis_mazars_presence
    from smart_ziw_commercial import convert_currency, is_european_country, format_value
    from smart_ziw_travel import estimate_travel

    country = project.get("primary_country_name_en") or ""
    presence = has_forvis_mazars_presence(country, config_countries=config.get("forvis_mazars_presence_countries"))

    currency_ctx = {"value_usd": "", "value_eur": "", "formatted": ""}
    value_text = project.get("estimated_value") or project.get("contract_value") or ""
    currency_code = project.get("currency") or ""
    amount = None
    if value_text:
        try:
            amount = float(value_text)
        except (TypeError, ValueError):
            # Try to extract a numeric amount from strings like "USD 1,234,567"
            m = re.search(r"[\d,]+(?:\.\d+)?", str(value_text))
            if m:
                try:
                    amount = float(m.group(0).replace(",", ""))
                except ValueError:
                    amount = None
            if not currency_code:
                upper_words = re.findall(r"[A-Z]{3}", str(value_text))
                if upper_words:
                    currency_code = upper_words[0]
    if amount is not None and currency_code:
        usd = convert_currency(amount, currency_code, "USD")
        eur = None
        if is_european_country(country):
            eur = convert_currency(amount, currency_code, "EUR")
        formatted = format_value({
            "original_amount": amount,
            "original_currency": currency_code,
            "usd_amount": usd.get("amount") if isinstance(usd, dict) else None,
            "eur_amount": eur.get("amount") if isinstance(eur, dict) else None,
        })
        currency_ctx = {
            "value_usd": round(usd.get("amount", amount), 2) if isinstance(usd, dict) else amount,
            "value_eur": round(eur.get("amount", amount), 2) if isinstance(eur, dict) else "",
            "formatted": formatted,
        }

    travel = estimate_travel(country, duration_days=5, consultants=2)

    return {
        "presence_present": "yes" if presence.get("present") else "no",
        "presence_evidence": presence.get("evidence", ""),
        "presence_confidence": presence.get("confidence", "low"),
        "country_is_european": "yes" if is_european_country(country) else "no",
        "estimated_value_original": value_text,
        "estimated_value_usd": currency_ctx["value_usd"],
        "estimated_value_eur": currency_ctx["value_eur"],
        "estimated_value_formatted": currency_ctx["formatted"],
        "travel_estimate": travel,
    }


ENRICH_PROMPT = """You are a tender intelligence analyst. Given tender metadata and helper facts below, return JSON with exactly these keys:
- "recap_markdown": a concise tender recap with inline [n] citations.
- "references": a list of reference objects used in the recap: {"number": int, "title": str, "url_or_path": str}.

Rules:
- Cite sources when possible; if no web sources are available, cite the provided Source URL as [1].
- Include, when available: tender summary, service-provider deliverables, SLA/dates/batches, price/budget, and a source section with the original listing link.
- If a monetary value is not available, leave placeholders empty rather than fabricating.
- Decision labels must be exactly one of: GO, NO-GO, GO-CONDITIONAL.
- Keep the recap concise but structured."""


SMART_ZIW_SKILLS_SYSTEM_PROMPT = """You are Smart-Ziw, a tender-bidding analyst for Forvis Mazars.
You have access to a set of tools (skills) to gather facts about a tender.
Use the tools whenever ground truth, external data, or calculations would improve your answer.
Call one tool at a time, observe the result, then either call another tool or produce your final answer.

Available tools:
- get_project_metadata: returns the full tender metadata record.
- check_forvis_presence: checks whether Forvis Mazars has an office in a country.
- convert_currency: converts a monetary amount to USD.
- estimate_travel: estimates flight + hotel + per-diem costs from Tunisia.
- run_web_research: runs Firecrawl web research and returns a grounded synthesis.
- download_documents: downloads tender documents and extracts text.

When you have enough information, return a single JSON object with exactly these keys:
- "recap_markdown": a concise tender recap with inline [n] citations.
- "references": list of reference objects, each with keys number, title, url_or_path.

Rules:
- Decision labels must be exactly one of: GO, NO-GO, GO-CONDITIONAL.
- Cite sources when possible; if research was run, include the original source URL and a source section.
- Do not fabricate monetary values.
- Include, when available: tender summary, service-provider deliverables, SLA/dates/batches, and price/budget.
- Keep the recap concise but structured."""


def _enrich(project: dict, config: dict | None = None, llm_call=None, thread_context: str = "") -> dict:
    config = config or {}
    helper_ctx = _collect_helper_context(project, config)
    user_prompt = "\n".join([
        _metadata_block(project),
        "",
        "Helper context:",
        json.dumps(helper_ctx, ensure_ascii=False, default=str),
        "",
        f"User discussion context:\n{thread_context}" if thread_context else "",
    ])
    try:
        result = (llm_call or _call_llm)(ENRICH_PROMPT, user_prompt)
    except Exception as exc:
        enrichment = _default_enrichment()
        enrichment["error"] = f"LLM enrichment failed: {exc}"
        return enrichment
    enrichment = _default_enrichment()
    for key in enrichment:
        if key == "references":
            refs = result.get("references")
            if isinstance(refs, list):
                enrichment[key] = [
                    {
                        "number": int(r.get("number")) if isinstance(r.get("number"), int) else 0,
                        "title": str(r.get("title") or "").strip(),
                        "url_or_path": str(r.get("url_or_path") or "").strip(),
                    }
                    for r in refs
                    if isinstance(r, dict)
                ]
            else:
                enrichment[key] = []
            # Fall back to the project's source URL when the LLM returned no references.
            if not enrichment[key] and project.get("project_url"):
                enrichment[key] = [{
                    "number": 1,
                    "title": project.get("source") or "Source listing",
                    "url_or_path": project.get("project_url"),
                }]
            continue
        enrichment[key] = str(result.get(key) or "").strip()

    # Make sure the recap cites the source URL when no web research was available.
    if project.get("project_url") and project.get("project_url") not in enrichment["recap_markdown"]:
        source_line = f"\n\nSource: [{project.get('source') or 'listing'}]({project.get('project_url')})"
        enrichment["recap_markdown"] = enrichment["recap_markdown"].rstrip() + source_line

    return enrichment


# ---------- Renderers for the new spec ----------

def _render_recap_markdown(project: dict, content: dict) -> str:
    value = content.get("recap_markdown", "")
    if value:
        return str(value).strip()
    return f"# Tender Recap: {project.get('project_name') or 'Untitled'}\n\nNo recap was generated for this tender."


def _render_next_actions_markdown(project: dict, content: dict) -> str:
    title = project.get("project_name") or "Tender"
    lines = [f"# Next Actions: {title}", ""]
    rows = content.get("next_actions") or []
    if not rows:
        lines.append("No next actions identified.")
        return "\n".join(lines)
    rows = _human_only_actions(rows)
    if not rows:
        lines.append("All identified next actions are automatable by the LLM; no human-only actions remain.")
        return "\n".join(lines)
    lines.extend(["| Action | Priority | Owner | Deadline | Notes |", "|--------|----------|-------|----------|-------|"])
    for row in rows:
        lines.append(
            f"| {_escape_table_cell(row.get('action', '-'))} | "
            f"{_escape_table_cell(row.get('priority', '-'))} | "
            f"{_escape_table_cell(row.get('owner', '-'))} | "
            f"{_escape_table_cell(row.get('deadline', '-'))} | "
            f"{_escape_table_cell(row.get('notes', '-'))} |"
        )
    return "\n".join(lines)


def load_skill_registry(config: dict | None = None) -> "SkillRegistry":
    """Load the skill registry from built-in skills and any skill store plugin."""
    from smart_ziw_skills import load_builtin_skills
    from smart_ziw_skills.base import SkillRegistry

    skills = load_builtin_skills()
    try:
        import smart_ziw_skill_store
        store_registry = smart_ziw_skill_store.get_registry(config or {})
        if store_registry is not None:
            return store_registry
    except Exception:
        pass
    return SkillRegistry(skills)


def _has_required_markdown_keys(content: dict) -> bool:
    return bool(content.get("recap_markdown"))


def run_with_skills(project: dict, config: dict | None = None, thread_context: str = "") -> dict:
    """Run the Smart-Ziw agent using the tool-calling skill loop."""
    from smart_ziw_llm import get_llm_call, get_llm_tool_call
    from smart_ziw_tool_loop import run_tool_loop

    config = config or {}
    folder = build_folder_name(project)
    repo_path = Path(config.get("smart_ziw_repo_path", "/home/kali/Smart-Ziw"))
    folder_path = repo_path / folder
    folder_path.mkdir(parents=True, exist_ok=True)

    error = ""
    llm_tool_call = None
    llm_call = None
    try:
        llm_tool_call = get_llm_tool_call(config)
        llm_call = get_llm_call(config)
    except Exception as exc:
        error = str(exc)

    if error or llm_tool_call is None:
        content = _enrich(project, config=config, llm_call=llm_call, thread_context=thread_context)
        if content.get("error"):
            error = error or content["error"]
    else:
        registry = load_skill_registry(config)
        user_prompt = "\n".join([
            _metadata_block(project),
            "",
            f"User discussion context:\n{thread_context}" if thread_context else "",
        ]).strip()
        messages = [
            {"role": "system", "content": SMART_ZIW_SKILLS_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]
        context = {
            "project": project,
            "config": config,
            "folder_path": folder_path,
            "llm_call": llm_call,
            "thread_context": thread_context,
        }
        content = run_tool_loop(registry, llm_tool_call, messages, context, max_iterations=10)
        research = context.get("research_result")
        if research is not None:
            content = _coerce_skill_result(content, research)
        if content.get("error") or not _has_required_markdown_keys(content):
            fallback = _enrich(project, config=config, llm_call=llm_call, thread_context=thread_context)
            if content.get("error"):
                fallback["error"] = content["error"]
            content = fallback
        if content.get("error"):
            error = error or content["error"]

    recap_markdown = _render_recap_markdown(project, content)
    (folder_path / "recap.md").write_text(recap_markdown, encoding="utf-8")

    git_result = push_to_gitlab(repo_path, folder, config)

    result = {
        "folder": folder,
        "files": ["recap.md"],
        "recap_markdown": recap_markdown,
        "references": content.get("references") if isinstance(content.get("references"), list) else [],
        "repo_path": str(repo_path),
        "gitlab_pushed": git_result["pushed"],
        "gitlab_message": git_result["message"],
    }

    files_dir = folder_path / "files"
    document_files = sorted(
        str(p.relative_to(folder_path))
        for p in (files_dir.rglob("*") if files_dir.exists() else [])
        if p.is_file()
    )
    if document_files:
        result["documents"] = document_files

    if research is not None:
        result["research"] = True
        result["research_stats"] = research.stats
        result["research_verdict"] = (
            (research.verdict or {}).get("recommendation", "GO-CONDITIONAL") if not research.error else "ERROR"
        )
        result["research_timed_out"] = bool(research.timed_out)
        result["source_url"] = research.source_url
        result["buyer"] = research.buyer
        result["requesting_company"] = research.requesting_company
        result["source_confidence"] = research.source_confidence

    if error:
        result["error"] = error
    return result


# ---------- LLM tool-loop path (Anthropic-compatible providers) ----------


def _run_tool_loop(
    project: dict,
    config: dict,
    thread_context: str = "",
    tools: dict | None = None,
) -> dict | None:
    """Run the Smart-Ziw LLM tool-loop.

    Returns the legacy result shape server.py expects, or None when the
    configured provider is not Anthropic-compatible (caller falls back to
    the legacy flows).
    """
    from smart_ziw_llm import LLMClient, resolve_anthropic_client_config
    from smart_ziw_loop import SmartZiwToolLoop
    from smart_ziw_tools import REGISTRY

    client_cfg = resolve_anthropic_client_config(config)
    if not client_cfg:
        return None

    folder = build_folder_name(project)
    repo_path = Path(config.get("smart_ziw_repo_path", "/home/kali/Smart-Ziw"))
    folder_path = repo_path / folder
    folder_path.mkdir(parents=True, exist_ok=True)

    llm = LLMClient(
        base_url=client_cfg["base_url"],
        api_key=client_cfg["api_key"],
        model=client_cfg["model"],
    )
    loop_tools = tools if tools is not None else dict(REGISTRY)
    from smart_ziw_config import load_smart_ziw_config
    try:
        loop_cfg = load_smart_ziw_config() or {}
        max_iterations = int(loop_cfg.get("max_iterations") or 15)
    except Exception:
        max_iterations = 15
    loop = SmartZiwToolLoop(llm=llm, tools=loop_tools, max_iterations=max_iterations)

    tender = dict(project)
    tender["_metadata"] = _metadata_block(project)
    if thread_context:
        tender["_thread_context"] = thread_context

    import asyncio
    try:
        loop_result = asyncio.run(loop.run(tender=tender))
    except Exception as exc:
        return {
            "tool_loop": True,
            "folder": folder,
            "files": [],
            "recap_markdown": "",
            "repo_path": str(repo_path),
            "comment_posted": False,
            "error": f"Tool loop failed: {exc}",
        }

    result = {
        "tool_loop": True,
        "run_id": loop_result.get("run_id"),
        "comment_id": loop_result.get("comment_id"),
        "audit": loop_result.get("audit") or [],
        "folder": folder,
        "files": ["recap.md"],
        "repo_path": str(repo_path),
    }

    post_step = next(
        (s for s in reversed(result["audit"]) if s.get("tool") == "post_smart_ziw_comment"),
        None,
    )
    if post_step:
        result["comment_posted"] = True
        args = post_step.get("input") or {}
        output = post_step.get("output") or {}
        result["source_url"] = str(args.get("source_url") or "")
        documents = []
        for f in args.get("downloaded_files") or []:
            try:
                documents.append(str(Path(str(f)).relative_to(folder_path)))
            except ValueError:
                documents.append(str(f))
        result["documents"] = documents
        comment = output.get("comment") or {}
        recap_markdown = str(comment.get("body") or "")
    else:
        result["comment_posted"] = False
        recap_markdown = ""
        # Recover the buyer source from the last successful lookup step.
        for step in reversed(result["audit"]):
            out = step.get("output")
            if isinstance(out, dict) and out.get("status") == "ok" and out.get("url"):
                result["source_url"] = str(out["url"])
                break

    if not recap_markdown:
        recap_markdown = _render_recap_markdown(project, {})
    (folder_path / "recap.md").write_text(recap_markdown, encoding="utf-8")
    result["recap_markdown"] = recap_markdown

    files_dir = folder_path / "files"
    document_files = sorted(
        str(p.relative_to(folder_path))
        for p in (files_dir.rglob("*") if files_dir.exists() else [])
        if p.is_file()
    )
    if document_files:
        result["files"] = ["recap.md", *document_files]

    git_result = push_to_gitlab(repo_path, folder, config)
    result["gitlab_pushed"] = git_result["pushed"]
    result["gitlab_message"] = git_result["message"]

    if loop_result.get("final_status") != "success":
        result["error"] = loop_result.get("error") or "Tool loop did not post a comment"
    return result


# ---------- GitLab mirror ----------

def run(project: dict, config: dict | None = None, thread_context: str = "", tools: dict | None = None) -> dict:
    config = config or {}
    tool_loop_result = _run_tool_loop(project, config, thread_context, tools=tools)
    if tool_loop_result is not None:
        return tool_loop_result
    if config.get("smart_ziw_skills_enabled", True):
        try:
            from smart_ziw_llm import get_llm_tool_call
            get_llm_tool_call(config)
            return run_with_skills(project, config, thread_context)
        except Exception:
            pass

    folder = build_folder_name(project)
    repo_path = Path(config.get("smart_ziw_repo_path", "/home/kali/Smart-Ziw"))
    folder_path = repo_path / folder
    folder_path.mkdir(parents=True, exist_ok=True)

    research = None
    synthesis = None
    error = ""
    llm_call = None
    try:
        from smart_ziw_llm import get_llm_call
        llm_call = get_llm_call(config)
    except Exception as exc:
        error = str(exc)
    research_ran = False
    if not error and config.get("smart_ziw_research_enabled", True):
        # Research degrades gracefully without a Firecrawl MCP server
        # (FirecrawlClient falls back to plain HTTP scrape + DuckDuckGo search).
        research_ran = True

    store = None
    if research_ran:
        from smart_ziw_research import run_research, synthesize
        research = run_research(project, config, folder_path=folder_path, llm_call=llm_call, thread_context=thread_context)
        if research.error:
            error = research.error
        else:
            synthesis = synthesize(project, research, llm_call=llm_call, thread_context=thread_context)
            if synthesis.get("_error"):
                error = synthesis["_error"]
                synthesis = None
            else:
                store = research.store if hasattr(research, "store") else None

    if synthesis is not None:
        content = synthesis
    else:
        if llm_call is None and error:
            content = _default_enrichment()
            content["error"] = error
        else:
            content = _enrich(project, config=config, llm_call=llm_call, thread_context=thread_context)
        if content.get("error"):
            error = error or content["error"]

    recap_markdown = _render_recap_markdown(project, content)
    (folder_path / "recap.md").write_text(recap_markdown, encoding="utf-8")

    git_result = push_to_gitlab(repo_path, folder, config)

    result = {
        "folder": folder,
        "files": ["recap.md"],
        "recap_markdown": recap_markdown,
        "references": content.get("references") if isinstance(content.get("references"), list) else [],
        "repo_path": str(repo_path),
        "gitlab_pushed": git_result["pushed"],
        "gitlab_message": git_result["message"],
    }

    files_dir = folder_path / "files"
    document_files = sorted(
        str(p.relative_to(folder_path))
        for p in (files_dir.rglob("*") if files_dir.exists() else [])
        if p.is_file()
    )
    if document_files:
        result["documents"] = document_files

    if research is not None:
        result["research"] = True
        result["research_stats"] = research.stats
        result["research_verdict"] = (
            (research.verdict or {}).get("recommendation", "GO-CONDITIONAL") if not research.error else "ERROR"
        )
        result["research_timed_out"] = bool(research.timed_out)
        result["source_url"] = research.source_url
        result["buyer"] = research.buyer
        result["requesting_company"] = research.requesting_company
        result["source_confidence"] = research.source_confidence

    if error:
        result["error"] = error
    return result
