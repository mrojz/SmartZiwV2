"""
MongoDB connection and CRUD helpers for Procurement Watch.

Collections:
  - projects: stores all scraped procurement projects
  - config:   single-document collection for keywords + regions
"""

import os
from pymongo import MongoClient, ASCENDING

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB", "procurement_watch")

_client = None
_db = None


def get_db():
    """Return a handle to the procurement_watch database."""
    global _client, _db
    if _db is None:
        _client = MongoClient(MONGO_URI)
        _db = _client[DB_NAME]
        # Create unique compound index for dedup
        _db.projects.create_index(
            [("project_id", ASCENDING), ("project_name", ASCENDING)],
            unique=True,
            background=True,
        )
    return _db


# ── Projects ────────────────────────────────────────────────────────────────


def _strip_id(doc: dict) -> dict:
    """Remove MongoDB _id from a document for JSON serialization."""
    doc.pop("_id", None)
    return doc


def get_all_projects() -> list[dict]:
    """Return all projects as a list of plain dicts."""
    db = get_db()
    return [_strip_id(doc) for doc in db.projects.find()]


def insert_projects(projects: list[dict]) -> int:
    """
    Insert new projects, skipping duplicates silently.
    Returns the count of newly inserted documents.
    """
    if not projects:
        return 0
    db = get_db()
    inserted = 0
    for p in projects:
        try:
            db.projects.insert_one(p.copy())
            inserted += 1
        except Exception:
            # Duplicate key — skip
            pass
    return inserted


def upsert_projects(projects: list[dict]) -> dict:
    """
    Insert or update projects by (project_id, project_name) key.
    Returns {"inserted": n, "updated": m}.
    """
    if not projects:
        return {"inserted": 0, "updated": 0}
    db = get_db()
    inserted = 0
    updated = 0
    for p in projects:
        key = {"project_id": p.get("project_id", ""), "project_name": p.get("project_name", "")}
        doc = {k: v for k, v in p.items() if k != "_id"}
        result = db.projects.update_one(key, {"$set": doc}, upsert=True)
        if result.upserted_id:
            inserted += 1
        elif result.modified_count > 0:
            updated += 1
    return {"inserted": inserted, "updated": updated}


def update_project_decision(project_id: str, project_name: str, decision: str) -> bool:
    """Update a single project's decision field. Returns True if found."""
    db = get_db()
    result = db.projects.update_one(
        {"project_id": project_id, "project_name": project_name},
        {"$set": {"decision": decision}},
    )
    return result.matched_count > 0


def update_project_by_index(index: int, decision: str) -> dict | None:
    """
    Update project decision by its position index (for backward compat).
    Returns the updated project dict or None.
    """
    db = get_db()
    projects = list(db.projects.find())
    if index < 0 or index >= len(projects):
        return None
    doc = projects[index]
    db.projects.update_one({"_id": doc["_id"]}, {"$set": {"decision": decision}})
    doc["decision"] = decision
    return _strip_id(doc)


def delete_project_by_index(index: int) -> dict | None:
    """
    Delete a project by its position index.
    Returns the deleted project dict or None if not found.
    """
    db = get_db()
    projects = list(db.projects.find())
    if index < 0 or index >= len(projects):
        return None
    doc = projects[index]
    db.projects.delete_one({"_id": doc["_id"]})
    return _strip_id(doc)


# ── Config ───────────────────────────────────────────────────────────────────


def get_config() -> dict:
    """Load the config document (keywords + regions)."""
    db = get_db()
    doc = db.config.find_one({"_type": "app_config"})
    if doc:
        return {"keywords": doc.get("keywords", []), "regions": doc.get("regions", {})}
    return {"keywords": [], "regions": {}}


def save_config(keywords: list[str], regions: dict[str, list[str]]):
    """Save config (upsert)."""
    db = get_db()
    db.config.update_one(
        {"_type": "app_config"},
        {"$set": {"keywords": keywords, "regions": regions}},
        upsert=True,
    )


# ── Schedule ────────────────────────────────────────────────────────────────


def get_schedule() -> dict:
    """Load the sync schedule config."""
    db = get_db()
    doc = db.config.find_one({"_type": "sync_schedule"})
    if doc:
        doc.pop("_id", None)
        doc.pop("_type", None)
        return doc
    return {
        "enabled": False,
        "frequency": "daily",
        "day_of_week": "mon",
        "hour": 6,
        "minute": 0,
        "sources": {
            "iadb": True,
            "worldbank": True,
            "globaltenders": True,
            "giz": True,
            "devaid": True,
            "dgmarket": True,
        },
        "no_ai": False,
        "include_expired": False,
    }


def save_schedule(schedule: dict):
    """Save sync schedule config (upsert)."""
    db = get_db()
    db.config.update_one(
        {"_type": "sync_schedule"},
        {"$set": schedule},
        upsert=True,
    )


# ── Sync Logs ───────────────────────────────────────────────────────────────


def save_sync_log(log_entry: dict):
    """Save a sync run log entry to the sync_logs collection."""
    db = get_db()
    db.sync_logs.insert_one(log_entry)


def get_sync_logs(limit: int = 20) -> list[dict]:
    """Return the most recent sync log entries, newest first."""
    db = get_db()
    docs = db.sync_logs.find().sort("started_at", -1).limit(limit)
    return [_strip_id(doc) for doc in docs]


# ── Migration helper ────────────────────────────────────────────────────────


def migrate_from_json(json_path: str) -> int:
    """One-time migration: load projects.json into MongoDB."""
    import json
    from pathlib import Path

    p = Path(json_path)
    if not p.exists():
        return 0
    data = json.loads(p.read_text(encoding="utf-8"))
    if not data:
        return 0
    result = upsert_projects(data)
    return result["inserted"] + result["updated"]
