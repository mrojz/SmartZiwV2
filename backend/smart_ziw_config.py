"""Smart-Ziw configuration persistence."""
from __future__ import annotations

import os
from copy import deepcopy
from typing import Any

_MCP_SERVERS_DOC = {"_type": "smart_ziw_mcp_servers"}
_SMART_ZIW_CONFIG_DOC = {"_type": "smart_ziw_config"}

_DEFAULT_CONFIG: dict[str, Any] = {
    "llm_provider": {
        "base_url": "",
        "api_key": "",
        "model": "claude-sonnet-4",
    },
    "brave_api_key": "",
    "max_iterations": 15,
    "tool_timeout_seconds": 60,
}

_SECRET_KEYS = ("api_key", "brave_api_key")


def load_smart_ziw_config() -> dict[str, Any]:
    from database import get_db

    db = get_db()
    doc = db.config.find_one(_SMART_ZIW_CONFIG_DOC) or {}
    config = deepcopy(_DEFAULT_CONFIG)
    # The same Mongo document carries the app-level Smart-Ziw config at
    # top level (written by database.save_smart_ziw_config); accept those
    # keys so tool handlers see e.g. smart_ziw_repo_path.
    for key in config:
        if key in doc:
            config[key] = doc[key]
    nested = doc.get("config")
    if isinstance(nested, dict):
        config.update(nested)
    if not str(config.get("brave_api_key") or ""):
        config["brave_api_key"] = _brave_key_from_mcp_servers() or os.environ.get("BRAVE_API_KEY", "")
    return config


def _brave_key_from_mcp_servers() -> str:
    """Brave API key saved on the built-in Brave Search MCP server, if any."""
    try:
        from smart_ziw_mcp import load_mcp_servers
        for server in load_mcp_servers():
            if "brave" not in str(server.get("id") or "").lower():
                continue
            headers = server.get("headers") or {}
            for name in ("X-Subscription-Token", "Authorization", "x-api-key"):
                value = str(headers.get(name) or "").strip()
                if not value or value == "***":
                    continue
                if name.lower() == "authorization" and value.lower().startswith("bearer "):
                    return value[7:].strip()
                return value
    except Exception:
        pass
    return ""


def save_smart_ziw_config(db, config: dict[str, Any]) -> None:
    existing = load_smart_ziw_config()
    merged = deepcopy(existing)
    merged.update(config)
    db.config.update_one(
        _SMART_ZIW_CONFIG_DOC,
        {"$set": {"config": merged}},
        upsert=True,
    )


def _redact_value(value: Any, secret: bool = False) -> Any:
    if isinstance(value, str):
        return "***" if secret and value else value
    if isinstance(value, dict):
        return {k: _redact_value(v, secret=k in _SECRET_KEYS) for k, v in value.items()}
    return value


def redact_config(config: dict[str, Any]) -> dict[str, Any]:
    return _redact_value(deepcopy(config), secret=False)
