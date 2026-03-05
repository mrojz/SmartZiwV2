"""
MongoDB connection and CRUD helpers for Procurement Watch.

Collections:
  - projects: stores all scraped procurement projects
  - config:   single-document collection for keywords + regions
  - users:    auth users
  - sessions: login sessions
  - comments: comments by entity
"""

import os
from datetime import datetime, timezone
from pymongo import MongoClient, ASCENDING, ReturnDocument

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
        _db.projects.create_index(
            [("project_id", ASCENDING), ("project_name", ASCENDING)],
            unique=True,
            background=True,
        )
        _db.users.create_index([("email", ASCENDING)], unique=True, background=True)
        _db.sessions.create_index([("sessionId", ASCENDING)], unique=True, background=True)
        _db.comments.create_index([("entityType", ASCENDING), ("entityId", ASCENDING), ("createdAt", ASCENDING)])
    return _db


# Projects

def _strip_id(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


def get_all_projects() -> list[dict]:
    db = get_db()
    return [_strip_id(doc) for doc in db.projects.find()]


def insert_projects(projects: list[dict]) -> int:
    if not projects:
        return 0
    db = get_db()
    inserted = 0
    for p in projects:
        try:
            doc = p.copy()
            doc.setdefault("scraped_at", datetime.now(timezone.utc).isoformat())
            db.projects.insert_one(doc)
            inserted += 1
        except Exception:
            pass
    return inserted


def upsert_projects(projects: list[dict]) -> dict:
    if not projects:
        return {"inserted": 0, "updated": 0}
    db = get_db()
    inserted = 0
    updated = 0
    now = datetime.now(timezone.utc).isoformat()
    for p in projects:
        key = {"project_id": p.get("project_id", ""), "project_name": p.get("project_name", "")}
        doc = {k: v for k, v in p.items() if k != "_id"}
        result = db.projects.update_one(
            key,
            {"$set": doc, "$setOnInsert": {"scraped_at": now}},
            upsert=True,
        )
        if result.upserted_id:
            inserted += 1
        elif result.modified_count > 0:
            updated += 1
    return {"inserted": inserted, "updated": updated}


def update_project_decision(project_id: str, project_name: str, decision: str) -> bool:
    db = get_db()
    result = db.projects.update_one(
        {"project_id": project_id, "project_name": project_name},
        {"$set": {"decision": decision}},
    )
    return result.matched_count > 0


def update_project_by_index(index: int, decision: str) -> dict | None:
    db = get_db()
    projects = list(db.projects.find())
    if index < 0 or index >= len(projects):
        return None
    doc = projects[index]
    db.projects.update_one({"_id": doc["_id"]}, {"$set": {"decision": decision}})
    doc["decision"] = decision
    return _strip_id(doc)


def delete_project_by_index(index: int) -> dict | None:
    db = get_db()
    projects = list(db.projects.find())
    if index < 0 or index >= len(projects):
        return None
    doc = projects[index]
    db.projects.delete_one({"_id": doc["_id"]})
    return _strip_id(doc)


# Config

def get_config() -> dict:
    db = get_db()
    doc = db.config.find_one({"_type": "app_config"})
    if doc:
        return {"keywords": doc.get("keywords", []), "regions": doc.get("regions", {})}
    return {"keywords": [], "regions": {}}


def save_config(keywords: list[str], regions: dict[str, list[str]]):
    db = get_db()
    db.config.update_one(
        {"_type": "app_config"},
        {"$set": {"keywords": keywords, "regions": regions}},
        upsert=True,
    )


# Schedule

def get_schedule() -> dict:
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
    db = get_db()
    db.config.update_one(
        {"_type": "sync_schedule"},
        {"$set": schedule},
        upsert=True,
    )


# Sync logs

def save_sync_log(log_entry: dict):
    db = get_db()
    db.sync_logs.insert_one(log_entry)


def get_sync_logs(limit: int = 20) -> list[dict]:
    db = get_db()
    docs = db.sync_logs.find().sort("started_at", -1).limit(limit)
    return [_strip_id(doc) for doc in docs]


# Users

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_user_by_email(email: str) -> dict | None:
    db = get_db()
    user = db.users.find_one({"email": email.lower().strip()})
    return _strip_id(user) if user else None


def get_user_by_id(user_id: str) -> dict | None:
    db = get_db()
    user = db.users.find_one({"id": user_id})
    return _strip_id(user) if user else None


def list_users(search: str = "") -> list[dict]:
    db = get_db()
    q = {}
    if search:
        q = {"$or": [{"email": {"$regex": search, "$options": "i"}}, {"name": {"$regex": search, "$options": "i"}}]}
    return [_strip_id(u) for u in db.users.find(q).sort("createdAt", -1)]


def create_user_doc(doc: dict) -> dict:
    db = get_db()
    db.users.insert_one(doc)
    return doc


def update_user(user_id: str, updates: dict) -> dict | None:
    db = get_db()
    updates["updatedAt"] = now_iso()
    result = db.users.find_one_and_update(
        {"id": user_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )
    return _strip_id(result) if result else None


def delete_user(user_id: str) -> bool:
    db = get_db()
    r = db.users.delete_one({"id": user_id})
    return r.deleted_count > 0


def count_admin_users() -> int:
    db = get_db()
    return db.users.count_documents({"role": "admin"})


# Sessions

def create_session(session_doc: dict):
    db = get_db()
    db.sessions.insert_one(session_doc)


def get_session(session_id: str) -> dict | None:
    db = get_db()
    s = db.sessions.find_one({"sessionId": session_id})
    return _strip_id(s) if s else None


def delete_session(session_id: str):
    db = get_db()
    db.sessions.delete_one({"sessionId": session_id})


def delete_user_sessions(user_id: str):
    db = get_db()
    db.sessions.delete_many({"userId": user_id})


# Comments

def list_comments(entity_type: str, entity_id: str) -> list[dict]:
    db = get_db()
    docs = db.comments.find({"entityType": entity_type, "entityId": entity_id}).sort("createdAt", 1)
    return [_strip_id(c) for c in docs]


def create_comment(comment: dict) -> dict:
    db = get_db()
    db.comments.insert_one(comment)
    return comment


def migrate_from_json(json_path: str) -> int:
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

