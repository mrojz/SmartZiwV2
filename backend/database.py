"""
MongoDB connection and CRUD helpers for Procurement Watch.

Collections:
  - projects: stores all scraped procurement projects
  - config:   single-document collection for keywords + regions
  - users:    auth users
  - sessions: login sessions
  - comments: comments by entity
  - continents / countries / geo_regions: normalized geography data
"""

import os
from datetime import datetime, timezone

from bson import ObjectId
from pymongo import ASCENDING, MongoClient, ReturnDocument

try:
    from geography import build_region_name_map, infer_project_geography, load_seed_data
except ImportError:
    from backend.geography import build_region_name_map, infer_project_geography, load_seed_data

MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017')
DB_NAME = os.getenv('MONGO_DB', 'procurement_watch')

_client = None
_db = None


def get_db():
    """Return a handle to the procurement_watch database."""
    global _client, _db
    if _db is None:
        _client = MongoClient(MONGO_URI)
        _db = _client[DB_NAME]
        _db.projects.create_index([
            ('project_id', ASCENDING), ('project_name', ASCENDING)
        ], unique=True, background=True)
        _db.users.create_index([('email', ASCENDING)], unique=True, background=True)
        _db.sessions.create_index([('sessionId', ASCENDING)], unique=True, background=True)
        _db.comments.create_index([('entityType', ASCENDING), ('entityId', ASCENDING), ('createdAt', ASCENDING)])
        _db.continents.create_index([('code', ASCENDING)], unique=True, background=True)
        _db.countries.create_index([('iso2', ASCENDING)], unique=True, background=True)
        _db.geo_regions.create_index([('slug', ASCENDING)], unique=True, background=True)
    return _db


# Projects

def _strip_id(doc: dict) -> dict:
    if '_id' in doc:
        doc['db_id'] = str(doc['_id'])
    doc.pop('_id', None)
    return doc


def _parse_object_id(value: str):
    try:
        return ObjectId(value)
    except Exception:
        return None


def _normalize_project(doc: dict, geography: dict | None = None) -> dict:
    scraped_deadline = doc.get('scraped_deadline') or doc.get('project_end_date') or ''
    manual_deadline = doc.get('manual_deadline') or ''
    effective_deadline = manual_deadline or scraped_deadline or ''
    source = 'manual' if manual_deadline else ('scraped' if scraped_deadline else '')
    doc['scraped_deadline'] = scraped_deadline
    doc['manual_deadline'] = manual_deadline
    doc['effective_deadline'] = effective_deadline
    doc['deadline_source'] = doc.get('deadline_source') or source
    geo = infer_project_geography(doc, geography or get_geography())
    doc.update(geo)
    doc['primary_country_name_en'] = geo['country_names_en'][0] if geo['country_names_en'] else ''
    doc['primary_country_name_fr'] = geo['country_names_fr'][0] if geo['country_names_fr'] else ''
    doc['primary_continent_code'] = geo['continent_codes'][0] if geo['continent_codes'] else ''
    doc['primary_continent_name_en'] = geo['continent_names_en'][0] if geo['continent_names_en'] else ''
    doc['primary_continent_name_fr'] = geo['continent_names_fr'][0] if geo['continent_names_fr'] else ''
    doc['primary_region_name'] = geo['region_names'][0] if geo['region_names'] else ''
    return doc


def get_all_projects() -> list[dict]:
    db = get_db()
    geography = get_geography()
    return [_normalize_project(_strip_id(doc), geography) for doc in db.projects.find()]


def insert_projects(projects: list[dict]) -> int:
    if not projects:
        return 0
    db = get_db()
    inserted = 0
    for p in projects:
        try:
            doc = p.copy()
            doc.setdefault('scraped_at', datetime.now(timezone.utc).isoformat())
            doc['scraped_deadline'] = doc.get('project_end_date', '')
            db.projects.insert_one(doc)
            inserted += 1
        except Exception:
            pass
    return inserted


def upsert_projects(projects: list[dict]) -> dict:
    if not projects:
        return {'inserted': 0, 'updated': 0}
    db = get_db()
    inserted = 0
    updated = 0
    now = datetime.now(timezone.utc).isoformat()
    for p in projects:
        key = {'project_id': p.get('project_id', ''), 'project_name': p.get('project_name', '')}
        existing = db.projects.find_one(key) or {}
        doc = {k: v for k, v in p.items() if k != '_id'}
        incoming_deadline = doc.get('project_end_date', '')
        doc['scraped_deadline'] = incoming_deadline or existing.get('scraped_deadline', '')
        result = db.projects.update_one(
            key,
            {'$set': doc, '$setOnInsert': {'scraped_at': now}},
            upsert=True,
        )
        if result.upserted_id:
            inserted += 1
        elif result.modified_count > 0:
            updated += 1
    return {'inserted': inserted, 'updated': updated}


def update_project_decision(project_id: str, project_name: str, decision: str) -> bool:
    db = get_db()
    result = db.projects.update_one(
        {'project_id': project_id, 'project_name': project_name},
        {'$set': {'decision': decision}},
    )
    return result.matched_count > 0


def update_project_by_index(index: int, decision: str) -> dict | None:
    db = get_db()
    projects = list(db.projects.find())
    if index < 0 or index >= len(projects):
        return None
    doc = projects[index]
    db.projects.update_one({'_id': doc['_id']}, {'$set': {'decision': decision}})
    doc['decision'] = decision
    return _normalize_project(_strip_id(doc), get_geography())


def update_project_by_db_id(project_db_id: str, decision: str) -> dict | None:
    db = get_db()
    object_id = _parse_object_id(project_db_id)
    if not object_id:
        return None
    doc = db.projects.find_one_and_update(
        {'_id': object_id},
        {'$set': {'decision': decision}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        return None
    return _normalize_project(_strip_id(doc), get_geography())


def update_project_deadline_by_index(index: int, manual_deadline: str, updated_by: dict | None = None) -> dict | None:
    db = get_db()
    projects = list(db.projects.find())
    if index < 0 or index >= len(projects):
        return None
    doc = projects[index]
    scraped_deadline = doc.get('scraped_deadline') or doc.get('project_end_date') or ''
    cleaned = (manual_deadline or '').strip()
    updates = {
        'manual_deadline': cleaned,
        'deadline_source': 'manual' if cleaned else ('scraped' if scraped_deadline else ''),
        'deadline_updated_at': now_iso(),
        'deadline_updated_by': (updated_by or {}).get('email', '') or (updated_by or {}).get('name', ''),
    }
    db.projects.update_one({'_id': doc['_id']}, {'$set': updates})
    doc.update(updates)
    return _normalize_project(_strip_id(doc), get_geography())


def update_project_deadline_by_db_id(project_db_id: str, manual_deadline: str, updated_by: dict | None = None) -> dict | None:
    db = get_db()
    object_id = _parse_object_id(project_db_id)
    if not object_id:
        return None
    doc = db.projects.find_one({'_id': object_id})
    if not doc:
        return None
    scraped_deadline = doc.get('scraped_deadline') or doc.get('project_end_date') or ''
    cleaned = (manual_deadline or '').strip()
    updates = {
        'manual_deadline': cleaned,
        'deadline_source': 'manual' if cleaned else ('scraped' if scraped_deadline else ''),
        'deadline_updated_at': now_iso(),
        'deadline_updated_by': (updated_by or {}).get('email', '') or (updated_by or {}).get('name', ''),
    }
    updated = db.projects.find_one_and_update(
        {'_id': object_id},
        {'$set': updates},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        return None
    return _normalize_project(_strip_id(updated), get_geography())


def delete_project_by_index(index: int) -> dict | None:
    db = get_db()
    projects = list(db.projects.find())
    if index < 0 or index >= len(projects):
        return None
    doc = projects[index]
    db.projects.delete_one({'_id': doc['_id']})
    return _normalize_project(_strip_id(doc), get_geography())


def delete_project_by_db_id(project_db_id: str) -> dict | None:
    db = get_db()
    object_id = _parse_object_id(project_db_id)
    if not object_id:
        return None
    doc = db.projects.find_one_and_delete({'_id': object_id})
    if not doc:
        return None
    return _normalize_project(_strip_id(doc), get_geography())


def delete_projects_by_db_ids(project_db_ids: list[str]) -> dict:
    db = get_db()
    object_ids = []
    for item in project_db_ids:
        object_id = _parse_object_id(item)
        if object_id:
            object_ids.append(object_id)
    if not object_ids:
        return {'deleted_count': 0, 'deleted_ids': []}

    docs = list(db.projects.find({'_id': {'$in': object_ids}}))
    if not docs:
        return {'deleted_count': 0, 'deleted_ids': []}

    matched_ids = [doc['_id'] for doc in docs]
    db.projects.delete_many({'_id': {'$in': matched_ids}})
    return {
        'deleted_count': len(matched_ids),
        'deleted_ids': [str(item) for item in matched_ids],
    }


# Config / Geography

def get_config() -> dict:
    db = get_db()
    doc = db.config.find_one({'_type': 'app_config'}) or {}
    seed_region_map = build_region_name_map()
    custom_regions = doc.get('regions') or {}
    merged_regions = {**seed_region_map, **custom_regions}
    return {
        'keywords': doc.get('keywords', []),
        'regions': merged_regions,
    }


def save_config(keywords: list[str], regions: dict[str, list[str]]):
    db = get_db()
    db.config.update_one(
        {'_type': 'app_config'},
        {'$set': {'keywords': keywords, 'regions': regions}},
        upsert=True,
    )


def get_geography() -> dict:
    db = get_db()
    continents = [_strip_id(doc) for doc in db.continents.find({}, {'_id': 0}).sort('code', 1)]
    countries = [_strip_id(doc) for doc in db.countries.find({}, {'_id': 0}).sort('name_en', 1)]
    regions = [_strip_id(doc) for doc in db.geo_regions.find({}, {'_id': 0}).sort('name', 1)]
    if continents and countries and regions:
        return {'continents': continents, 'countries': countries, 'regions': regions}
    return load_seed_data()


def seed_geography(seed_config_regions: bool = True) -> dict:
    db = get_db()
    seed = load_seed_data()
    for continent in seed.get('continents', []):
        db.continents.update_one({'code': continent['code']}, {'$set': continent}, upsert=True)
    for country in seed.get('countries', []):
        db.countries.update_one({'iso2': country['iso2']}, {'$set': country}, upsert=True)
    for region in seed.get('regions', []):
        db.geo_regions.update_one({'slug': region['slug']}, {'$set': region}, upsert=True)

    if seed_config_regions:
        config_doc = db.config.find_one({'_type': 'app_config'}) or {}
        existing_regions = config_doc.get('regions') or {}
        if not existing_regions:
            db.config.update_one(
                {'_type': 'app_config'},
                {'$setOnInsert': {'keywords': []}, '$set': {'regions': build_region_name_map(seed)}},
                upsert=True,
            )

    return {
        'continents': len(seed.get('continents', [])),
        'countries': len(seed.get('countries', [])),
        'regions': len(seed.get('regions', [])),
    }


# Schedule

def get_schedule() -> dict:
    db = get_db()
    doc = db.config.find_one({'_type': 'sync_schedule'})
    if doc:
        doc.pop('_id', None)
        doc.pop('_type', None)
        doc.setdefault('timezone', 0)
        return doc
    return {
        'enabled': False,
        'frequency': 'daily',
        'day_of_week': 'mon',
        'hour': 6,
        'minute': 0,
        'sources': {
            'iadb': True,
            'worldbank': True,
            'globaltenders': True,
            'giz': True,
            'devaid': True,
            'dgmarket': True,
        },
        'no_ai': False,
        'include_expired': False,
        'timezone': 0,
    }


def save_schedule(schedule: dict):
    db = get_db()
    db.config.update_one(
        {'_type': 'sync_schedule'},
        {'$set': schedule},
        upsert=True,
    )


# Sync logs

def save_sync_log(log_entry: dict):
    db = get_db()
    db.sync_logs.insert_one(log_entry)


def get_sync_logs(limit: int = 20) -> list[dict]:
    db = get_db()
    docs = db.sync_logs.find().sort('started_at', -1).limit(limit)
    return [_strip_id(doc) for doc in docs]


# Users

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_user_by_email(email: str) -> dict | None:
    db = get_db()
    user = db.users.find_one({'email': email.lower().strip()})
    return _strip_id(user) if user else None


def get_user_by_id(user_id: str) -> dict | None:
    db = get_db()
    user = db.users.find_one({'id': user_id})
    return _strip_id(user) if user else None


def list_users(search: str = '') -> list[dict]:
    db = get_db()
    q = {}
    if search:
        q = {'$or': [{'email': {'$regex': search, '$options': 'i'}}, {'name': {'$regex': search, '$options': 'i'}}]}
    return [_strip_id(u) for u in db.users.find(q).sort('createdAt', -1)]


def create_user_doc(doc: dict) -> dict:
    db = get_db()
    db.users.insert_one(doc)
    return doc


def update_user(user_id: str, updates: dict) -> dict | None:
    db = get_db()
    updates['updatedAt'] = now_iso()
    result = db.users.find_one_and_update(
        {'id': user_id},
        {'$set': updates},
        return_document=ReturnDocument.AFTER,
    )
    return _strip_id(result) if result else None


def delete_user(user_id: str) -> bool:
    db = get_db()
    r = db.users.delete_one({'id': user_id})
    return r.deleted_count > 0


def count_admin_users() -> int:
    db = get_db()
    return db.users.count_documents({'role': 'admin'})


# Sessions

def create_session(session_doc: dict):
    db = get_db()
    db.sessions.insert_one(session_doc)


def get_session(session_id: str) -> dict | None:
    db = get_db()
    s = db.sessions.find_one({'sessionId': session_id})
    return _strip_id(s) if s else None


def delete_session(session_id: str):
    db = get_db()
    db.sessions.delete_one({'sessionId': session_id})


def delete_user_sessions(user_id: str):
    db = get_db()
    db.sessions.delete_many({'userId': user_id})


# Comments

def list_comments(entity_type: str, entity_id: str) -> list[dict]:
    db = get_db()
    docs = db.comments.find({'entityType': entity_type, 'entityId': entity_id}).sort('createdAt', 1)
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
    data = json.loads(p.read_text(encoding='utf-8'))
    if not data:
        return 0
    result = upsert_projects(data)
    return result['inserted'] + result['updated']
