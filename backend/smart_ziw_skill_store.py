"""Admin-facing skill store for Smart-Ziw.

Security model
--------------
- All mutation routes are gated by `_require_admin` in `server.py`.
- `fetch_skill_from_url` only accepts http(s) URLs whose hostname resolves to a
  public IP address (validated by `smart_ziw_research.url_is_safe`).
- JSON skills may only reference handlers already present in importable Python
  modules (`handler_path` is resolved with `importlib`, never `exec`).
- Python-file skills are written to a dedicated `smart_ziw_skills/custom/`
  package and imported through the normal Python import machinery.
  This still executes code, but only an admin can trigger it and only after the
  URL has passed public-host validation.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

from smart_ziw_skills.base import Skill, SkillRegistry


def _custom_package_dir() -> Path:
    return Path(__file__).resolve().parent / "smart_ziw_skills" / "custom"


def _safe_module_name(name: str) -> str:
    """Turn a URL path/filename into a valid Python module basename."""
    cleaned = re.sub(r"[^\w.-]", "_", name or "skill")
    cleaned = re.sub(r"\.+", ".", cleaned).strip("._")
    if not cleaned or cleaned[0].isdigit():
        cleaned = "skill_" + cleaned
    return cleaned


def _resolve_handler(handler_path: str) -> Any:
    """Resolve 'module.submodule:callable' to a callable object."""
    if not handler_path or ":" not in handler_path:
        raise ValueError(f"handler_path must be 'module:attr', got {handler_path!r}")
    module_path, attr_path = handler_path.split(":", 1)
    module_path = module_path.strip()
    attr_path = attr_path.strip()
    if not module_path or not attr_path:
        raise ValueError(f"handler_path must be 'module:attr', got {handler_path!r}")

    import importlib

    module = importlib.import_module(module_path)
    obj = module
    for part in attr_path.split("."):
        obj = getattr(obj, part)
    if not callable(obj):
        raise ValueError(f"handler_path {handler_path!r} does not resolve to a callable")
    return obj


# ---------------------------------------------------------------------------
# Built-in / custom skill loading
# ---------------------------------------------------------------------------


def load_builtin_skills() -> list[Skill]:
    """Return built-in skills flagged as built_in=True and enabled=True."""
    from smart_ziw_skills import load_builtin_skills as _load_builtin

    return [Skill(**{**asdict(skill), "built_in": True, "enabled": True}) for skill in _load_builtin()]


def load_custom_skills() -> list[Skill]:
    """Reconstruct custom Skill objects from the `_type: smart_ziw_skills` DB doc."""
    from database import get_db

    db = get_db()
    doc = db.config.find_one({"_type": "smart_ziw_skills"}) or {}
    entries = doc.get("skills") or []
    skills = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("built_in"):
            continue
        skill = _reconstruct_custom_skill(entry)
        if skill is not None:
            skills.append(skill)
    return skills


def _reconstruct_custom_skill(entry: dict) -> Skill | None:
    """Rebuild a single custom Skill from its DB representation."""
    skill_id = entry.get("id")
    if not skill_id:
        return None

    handler = None
    module_path = entry.get("module_path")
    handler_path = entry.get("handler_path")

    if module_path:
        try:
            import importlib

            module = importlib.import_module(module_path)
            if hasattr(module, "register_skills"):
                registered = module.register_skills()
                for candidate in registered or []:
                    if getattr(candidate, "id", None) == skill_id:
                        handler = candidate.handler
                        break
        except Exception:
            pass

    if handler is None and handler_path:
        try:
            handler = _resolve_handler(handler_path)
        except Exception:
            pass

    if handler is None:
        handler = lambda **kwargs: {"error": f"Handler for custom skill {skill_id!r} is unavailable"}

    return Skill(
        id=skill_id,
        name=entry.get("name") or skill_id,
        description=entry.get("description") or "",
        parameters=entry.get("parameters") or {"type": "object", "properties": {}},
        handler=handler,
        source_url=entry.get("source_url") or "",
        built_in=False,
        enabled=bool(entry.get("enabled", True)),
    )


# ---------------------------------------------------------------------------
# Registry construction
# ---------------------------------------------------------------------------


def get_registry(config: dict | None = None) -> SkillRegistry:
    """Build a registry from built-ins overlaid with custom skills and DB state."""
    from database import get_db

    builtins = {skill.id: skill for skill in load_builtin_skills()}
    customs = {skill.id: skill for skill in load_custom_skills()}

    # Custom skills override built-ins with the same id.
    merged = {**builtins, **customs}

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


# ---------------------------------------------------------------------------
# Fetching skills from a URL
# ---------------------------------------------------------------------------


def fetch_skill_from_url(url: str, config: dict | None = None) -> list[Skill]:
    """Download a skill definition (JSON or .py) from a public URL.

    Returns a list of Skill objects (empty if nothing valid was found).
    """
    from smart_ziw_research import url_is_safe

    if not url_is_safe(url):
        raise ValueError("URL must be a public http(s) address")

    parsed = urlparse(url)
    filename = Path(parsed.path or "skill").name or "skill"
    is_python = filename.lower().endswith(".py")

    headers = {"User-Agent": "Smart-Ziw Skill Loader"}
    response = requests.get(url, headers=headers, stream=True, timeout=30)
    response.raise_for_status()

    content = b""
    for chunk in response.iter_content(chunk_size=64 * 1024):
        content += chunk
        if len(content) > 1024 * 1024:
            raise ValueError("Skill payload exceeds 1 MB limit")

    text = content.decode("utf-8", errors="replace")

    if is_python:
        return _load_python_skill(url, filename, text)

    # Try JSON parsing even if the filename is not .json.
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Response is neither valid Python nor valid JSON: {exc}")

    if isinstance(data, list):
        skills = []
        for item in data:
            skill = _load_json_skill_item(url, item)
            if skill is not None:
                skills.append(skill)
        return skills

    skill = _load_json_skill_item(url, data)
    return [skill] if skill is not None else []


def _load_json_skill_item(url: str, data: dict) -> Skill | None:
    """Validate and reconstruct a single JSON skill definition."""
    if not isinstance(data, dict):
        return None
    skill_id = data.get("id")
    if not skill_id:
        raise ValueError("JSON skill is missing required 'id' field")
    handler_path = data.get("handler_path")
    if not handler_path:
        raise ValueError("JSON skill is missing required 'handler_path' field")
    handler = _resolve_handler(handler_path)
    return Skill(
        id=skill_id,
        name=data.get("name") or skill_id,
        description=data.get("description") or "",
        parameters=data.get("parameters") or {"type": "object", "properties": {}},
        handler=handler,
        source_url=data.get("source_url") or url,
        built_in=False,
        enabled=True,
    )


def _load_python_skill(url: str, filename: str, source: str) -> list[Skill]:
    """Persist a .py skill module, import it, and call register_skills()."""
    import importlib
    import importlib.util

    base_name = _safe_module_name(Path(filename).stem)
    custom_dir = _custom_package_dir()
    custom_dir.mkdir(parents=True, exist_ok=True)
    dest = custom_dir / f"{base_name}.py"

    # Avoid clobbering the empty __init__.py.
    if base_name == "__init__":
        raise ValueError("Invalid skill module name: __init__")

    dest.write_text(source, encoding="utf-8")

    module_path = f"smart_ziw_skills.custom.{base_name}"
    spec = importlib.util.spec_from_file_location(module_path, dest)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not create module spec for {dest}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_path] = module
    spec.loader.exec_module(module)

    if not hasattr(module, "register_skills"):
        raise ValueError("Python skill module must define register_skills()")

    registered = module.register_skills()
    if not isinstance(registered, list):
        raise ValueError("register_skills() must return a list of Skill objects")

    skills = []
    for item in registered:
        if not isinstance(item, Skill):
            raise ValueError("register_skills() returned a non-Skill item")
        item.built_in = False
        item.source_url = url
        item.enabled = True
        skills.append(item)
    return skills


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def save_skills_state(db, states: list[dict]) -> dict:
    """Update enabled flags and upsert full custom skill docs.

    `states` is a list of dicts with at least `id` and `enabled`. Custom skills
    are stored as full docs (including handler/module metadata) under the
    `skills` key of the `_type: smart_ziw_skills` config document.
    """
    if not states:
        return {"updated": 0}

    doc = db.config.find_one({"_type": "smart_ziw_skills"}) or {}
    existing = {entry.get("id"): entry for entry in (doc.get("skills") or []) if isinstance(entry, dict)}

    updated_ids = set()
    for state in states:
        skill_id = state.get("id")
        if not skill_id:
            continue
        enabled = bool(state.get("enabled", True))
        entry = existing.get(skill_id, {})

        if state.get("built_in"):
            # Built-ins are represented by a lightweight {id, enabled} record.
            existing[skill_id] = {"id": skill_id, "enabled": enabled, "built_in": True}
        else:
            # Custom skills keep their full metadata.
            custom = {
                "id": skill_id,
                "name": state.get("name", entry.get("name", skill_id)),
                "description": state.get("description", entry.get("description", "")),
                "parameters": state.get("parameters", entry.get("parameters", {"type": "object", "properties": {}})),
                "source_url": state.get("source_url", entry.get("source_url", "")),
                "handler_path": state.get("handler_path", entry.get("handler_path", "")),
                "module_path": state.get("module_path", entry.get("module_path", "")),
                "built_in": False,
                "enabled": enabled,
            }
            existing[skill_id] = custom
        updated_ids.add(skill_id)

    db.config.update_one(
        {"_type": "smart_ziw_skills"},
        {"$set": {"skills": list(existing.values())}},
        upsert=True,
    )
    return {"updated": len(updated_ids)}


def delete_custom_skill(skill_id: str) -> bool:
    """Remove a custom skill from DB and delete its file if it lives in custom/."""
    from database import get_db

    db = get_db()
    doc = db.config.find_one({"_type": "smart_ziw_skills"}) or {}
    entries = doc.get("skills") or []
    removed = None
    kept = []
    for entry in entries:
        if isinstance(entry, dict) and entry.get("id") == skill_id and not entry.get("built_in"):
            removed = entry
        else:
            kept.append(entry)

    if removed is None:
        return False

    db.config.update_one(
        {"_type": "smart_ziw_skills"},
        {"$set": {"skills": kept}},
        upsert=True,
    )

    module_path = removed.get("module_path")
    if module_path and module_path.startswith("smart_ziw_skills.custom."):
        base = module_path.rsplit(".", 1)[-1]
        file_path = _custom_package_dir() / f"{base}.py"
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass

    return True


def _skill_to_state(skill: Skill) -> dict:
    """Serialize a Skill to the storage format used by save_skills_state."""
    return {
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "parameters": skill.parameters,
        "source_url": skill.source_url,
        "built_in": skill.built_in,
        "enabled": skill.enabled,
    }


def _skill_to_full_state(skill: Skill) -> dict:
    """Serialize a custom Skill including reconstruction metadata."""
    state = _skill_to_state(skill)
    handler = getattr(skill, "handler", None)
    if handler is not None:
        module = getattr(handler, "__module__", "")
        qualname = getattr(handler, "__qualname__", "")
        if module and qualname:
            state["handler_path"] = f"{module}:{qualname}"
        # For modules loaded from a .py file, store the module path so we can
        # re-import it and call register_skills() on reconstruction.
        if module.startswith("smart_ziw_skills.custom."):
            state["module_path"] = module
    return state
