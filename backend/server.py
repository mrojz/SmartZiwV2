"""FastAPI backend for Procurement Watch with auth, users, and comments."""

from dotenv import load_dotenv
load_dotenv(override=False)

import asyncio
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import uuid
from typing import Any
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

import jwt

import bcrypt
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, EmailStr, Field

from database import (
    get_all_projects,
    get_project_by_db_id,
    update_project_by_index,
    update_project_by_db_id,
    update_project_deadline_by_index,
    update_project_deadline_by_db_id,
    update_project_assignments_by_db_id,
    subscribe_project_commenters_by_db_id,
    update_project_vote_by_db_id,
    update_project_smart_ziw_state_by_db_id,
    get_smart_ziw_config,
    save_smart_ziw_config,
    DEFAULT_SMART_ZIW_CONFIG,
    upsert_projects,
    delete_project_by_index,
    delete_project_by_db_id,
    delete_projects_by_db_ids,
    get_config as db_get_config,
    save_config as db_save_config,
    get_release_notes as db_get_release_notes,
    save_release_notes as db_save_release_notes,
    get_schedule as db_get_schedule,
    save_schedule as db_save_schedule,
    get_geography as db_get_geography,
    seed_geography as db_seed_geography,
    save_sync_log,
    get_sync_logs,
    get_db,
    now_iso,
    get_user_by_email,
    get_user_by_id,
    list_users,
    create_user_doc,
    update_user,
    delete_user,
    count_admin_users,
    get_saved_searches as db_get_saved_searches,
    save_saved_searches as db_save_saved_searches,
    list_comments,
    create_comment,
    get_comment_metrics,
    create_notifications,
    list_notifications_for_user,
    mark_notification_read,
    mark_notification_viewed,
    mark_all_notifications_read,
    mark_all_notifications_viewed,
)
from smart_ziw_agent import run as run_smart_ziw_agent, CHAT_PROMPT
from smart_ziw_llm import (
    discover_lightllm_models,
    discover_models_for_preset,
    get_llm_call,
    get_llm_provider_presets,
)
from smart_ziw_tools import POST_COMMENT_SCHEMA, REGISTRY, Tool
import smart_ziw_mcp
from concurrent.futures import ThreadPoolExecutor

BASE_DIR = Path(__file__).resolve().parent
PROJECTS_XLSX = BASE_DIR / "projects.xlsx"
DOWNLOADS_DIR = BASE_DIR / "downloads"
SYNC_SECRET = os.getenv("SYNC_SECRET", str(uuid.uuid4()))
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
MAX_COMMENT_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_COMMENT_UPLOAD_MB = MAX_COMMENT_UPLOAD_BYTES // (1024 * 1024)


def _load_persistent_secret(env_name: str, fallback_filename: str) -> str:
    configured = (os.getenv(env_name, "") or "").strip()
    if configured:
        return configured

    secret_path = BASE_DIR / fallback_filename
    try:
        if secret_path.exists():
            existing = secret_path.read_text(encoding="utf-8").strip()
            if existing:
                return existing

        generated = secrets.token_urlsafe(64)
        secret_path.write_text(generated, encoding="utf-8")
        print(f"[auth] Generated persistent {env_name} at {secret_path}")
        return generated
    except Exception as exc:
        generated = secrets.token_urlsafe(64)
        print(f"[auth] Warning: failed to persist {env_name} ({exc}); falling back to process-local secret.")
        return generated

# JWT config
JWT_SECRET = _load_persistent_secret("JWT_SECRET", ".jwt_secret")
JWT_ALGORITHM = "HS256"
JWT_ACCESS_MINUTES = int(os.getenv("JWT_ACCESS_MINUTES", "2160"))
JWT_REFRESH_DAYS = int(os.getenv("JWT_REFRESH_DAYS", "7"))

scheduler = BackgroundScheduler()
SCHEDULER_JOB_ID = "scheduled_sync"
SERVER_TZ = datetime.now().astimezone().tzinfo or timezone.utc
DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
_excel_export_lock = threading.Lock()
_excel_export_running = False
_excel_export_pending = False
_smart_ziw_lock = threading.Lock()
_smart_ziw_running: set[str] = set()


# Auth helpers

def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def _sanitize_user(user: dict) -> dict:
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "name": user.get("name"),
        "role": user.get("role", "user"),
        "avatarUrl": user.get("avatarUrl", ""),
        "mustChangePassword": bool(user.get("mustChangePassword", False)),
        "isActive": bool(user.get("isActive", True)),
        "createdAt": user.get("createdAt"),
        "updatedAt": user.get("updatedAt"),
        "lastLoginAt": user.get("lastLoginAt"),
        "lastSeenAt": user.get("lastSeenAt"),
    }


def _bootstrap_admin_if_needed():
    if count_admin_users() > 0:
        return
    email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("ADMIN_PASSWORD", "")
    name = os.getenv("ADMIN_NAME", "Admin").strip() or "Admin"
    if not email or not password:
        print("[auth] No admin exists but ADMIN_EMAIL/ADMIN_PASSWORD not set.")
        return
    ts = now_iso()
    create_user_doc(
        {
            "id": str(uuid.uuid4()),
            "email": email,
            "name": name,
            "role": "admin",
            "passwordHash": _hash_password(password),
            "avatarUrl": "",
            "mustChangePassword": True,
            "isActive": True,
            "createdAt": ts,
            "updatedAt": ts,
            "lastLoginAt": None,
            "lastSeenAt": None,
        }
    )
    print(f"[auth] Bootstrapped default admin: {email}")


def _create_access_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "email": user.get("email", ""),
        "role": user.get("role", "user"),
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_ACCESS_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _create_refresh_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_REFRESH_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def _get_request_user(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    else:
        token = request.query_params.get("access_token")
    if not token:
        return None
    payload = _decode_token(token)
    if not payload or payload.get("type") != "access":
        return None
    user = get_user_by_id(payload.get("sub", ""))
    return user


ALLOWED_ANON = {"/api/auth/login", "/api/health", "/api/auth/bootstrap-status", "/api/auth/refresh"}
ALLOWED_MUST_CHANGE = {"/api/auth/me", "/api/auth/logout", "/api/auth/change-password"}


async def _auth_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)

    # Allow serving uploaded files without auth
    if path.startswith("/api/uploads/"):
        return await call_next(request)

    if path in ALLOWED_ANON:
        return await call_next(request)

    user = _get_request_user(request)
    if not user:
        return JSONResponse(status_code=401, content={"detail": "Authentication required"})
    if not user.get("isActive", True):
        return JSONResponse(status_code=403, content={"detail": "User is deactivated"})

    if user.get("mustChangePassword") and path not in ALLOWED_MUST_CHANGE:
        return JSONResponse(status_code=403, content={"detail": "must_change_password"})

    request.state.user = user
    return await call_next(request)


def _require_admin(request: Request):
    u = request.state.user
    if u.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return u


def _require_manager(request: Request):
    u = request.state.user
    if u.get("role") != "manager":
        raise HTTPException(status_code=403, detail="Manager only")
    return u


def _require_admin_or_manager(request: Request):
    u = request.state.user
    if u.get("role") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Admin or manager only")
    return u


def _active_users_by_id() -> dict[str, dict]:
    return {
        user["id"]: _sanitize_user(user)
        for user in list_users("")
        if user.get("isActive", True)
    }


def _project_entity_id(project: dict) -> str:
    return str(project.get("project_id") or project.get("project_name") or "")


def _enrich_project_payload(project: dict, user_map: dict[str, dict] | None = None, comment_metrics: dict[str, dict] | None = None, current_user_id: str | None = None) -> dict:
    payload = dict(project)
    users = user_map or _active_users_by_id()
    metrics_map = comment_metrics or get_comment_metrics("project")
    entity_id = _project_entity_id(payload)
    metrics = metrics_map.get(entity_id, {})
    payload["comment_count"] = int(metrics.get("comment_count") or 0)
    payload["comment_document_count"] = int(metrics.get("comment_document_count") or 0)
    assigned_ids = [str(item) for item in (payload.get("assigned_user_ids") or []) if item]
    payload["assigned_user_ids"] = assigned_ids
    payload["assigned_users"] = [users[user_id] for user_id in assigned_ids if user_id in users]
    votes = [vote for vote in (payload.get("votes") or []) if vote.get("value") in ("up", "down")]
    payload["vote_summary"] = {
        "up": sum(1 for vote in votes if vote.get("value") == "up"),
        "down": sum(1 for vote in votes if vote.get("value") == "down"),
    }
    payload["current_user_vote"] = ""
    if current_user_id:
        for vote in votes:
            if str(vote.get("userId") or "") == str(current_user_id):
                payload["current_user_vote"] = vote.get("value") or ""
                break
    return payload


def _broadcast_notification(event: dict, user_ids: list[str] | None = None):
    allowed = {str(item) for item in (user_ids or []) if item}
    with _notification_lock:
        for loop, q, queue_user_id in list(_notification_queues):
            if allowed and queue_user_id not in allowed:
                continue
            try:
                loop.call_soon_threadsafe(q.put_nowait, event)
            except Exception:
                pass


def _emit_user_notifications(*, user_ids: list[str], actor_user: dict, notification_type: str, message: str, project: dict | None = None, comment_id: str | None = None):
    recipients = []
    actor_id = str((actor_user or {}).get("id") or "")
    seen = set()
    for user_id in user_ids:
        key = str(user_id or "").strip()
        if not key or key == actor_id or key in seen:
            continue
        seen.add(key)
        recipients.append(key)
    if not recipients:
        return

    timestamp = now_iso()
    notifications = []
    for user_id in recipients:
        notifications.append({
            "id": str(uuid.uuid4()),
            "userId": user_id,
            "type": notification_type,
            "projectDbId": project.get("db_id") if project else None,
            "entityId": _project_entity_id(project or {}),
            "commentId": comment_id,
            "actorUserId": actor_id,
            "actorName": actor_user.get("name") if actor_user else "",
            "message": message,
            "read": False,
            "viewed": False,
            "createdAt": timestamp,
        })
    create_notifications(notifications)
    for notification in notifications:
        _broadcast_notification({"type": "notification", "notification": notification}, [notification["userId"]])


def _sanitize_mentions(raw_mentions: list, users: dict[str, dict] | None = None) -> list[dict]:
    user_map = dict(users if users is not None else _active_users_by_id())
    # The Smart-Ziw bot is not a real user row, but mentionable.
    user_map.setdefault(SMART_ZIW_BOT_USER["id"], SMART_ZIW_BOT_USER)
    mentions = []
    seen = set()
    for raw in raw_mentions or []:
        mention = raw.model_dump() if hasattr(raw, "model_dump") else (raw.dict() if hasattr(raw, "dict") else dict(raw))
        user_id = str(mention.get("userId") or "").strip()
        if not user_id or user_id in seen or user_id not in user_map:
            continue
        seen.add(user_id)
        user = user_map[user_id]
        mentions.append({
            "userId": user_id,
            "name": user.get("name", ""),
            "email": user.get("email", ""),
        })
    return mentions


def _project_comment_recipient_ids(project: dict, mentioned_user_ids: list[str]) -> list[str]:
    recipients = []
    seen = set()
    for user_id in (project.get("assigned_user_ids") or []) + (project.get("comment_subscriber_user_ids") or []):
        key = str(user_id or "").strip()
        if not key or key in seen or key in mentioned_user_ids:
            continue
        seen.add(key)
        recipients.append(key)
    return recipients


def _create_project_comment_and_notify(*, entity_type: str, entity_id: str, project: dict | None, author_user: dict, body_text: str, attachments: list[dict] | None = None, mentions: list[dict] | None = None) -> dict:
    text = (body_text or "").strip()
    cleaned_attachments = attachments or []
    cleaned_mentions = mentions or []
    comment = {
        "id": str(uuid.uuid4()),
        "entityType": entity_type.strip(),
        "entityId": entity_id.strip(),
        "authorUserId": author_user.get("id"),
        "authorName": author_user.get("name", ""),
        "authorAvatarUrl": author_user.get("avatarUrl", ""),
        "body": text,
        "attachments": cleaned_attachments,
        "mentions": cleaned_mentions,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    create_comment(comment)
    if project and comment["entityType"] == "project":
        mentioned_user_ids = [mention["userId"] for mention in cleaned_mentions]
        if mentioned_user_ids:
            project = subscribe_project_commenters_by_db_id(project.get("db_id"), mentioned_user_ids) or project
            actor_name = author_user.get("name") or author_user.get("email") or "Someone"
            _emit_user_notifications(
                user_ids=mentioned_user_ids,
                actor_user=author_user,
                notification_type="mention",
                message=f"{actor_name} mentioned you on {project.get('project_name') or project.get('project_id') or 'a tender'}.",
                project=project,
                comment_id=comment["id"],
            )
        recipient_ids = _project_comment_recipient_ids(project, mentioned_user_ids)
        actor_name = author_user.get("name") or author_user.get("email") or "Someone"
        _emit_user_notifications(
            user_ids=recipient_ids,
            actor_user=author_user,
            notification_type="comment",
            message=f"{actor_name} commented on {project.get('project_name') or project.get('project_id') or 'a tender'}.",
            project=project,
            comment_id=comment["id"],
        )
    comment.pop("_id", None)
    return comment


def _format_smart_ziw_comment(result: dict) -> str:
    lines = [
        "Smart-Ziw Agent",
        "",
        f"Generated mirror: `{result.get('folder')}/`",
        f"Local path: `{result.get('repo_path')}/{result.get('folder')}/`",
    ]
    if result.get("gitlab_pushed"):
        lines.append("GitLab push: pushed")
    elif result.get("gitlab_message"):
        message = result["gitlab_message"]
        if message == "GitLab push disabled":
            message = "disabled"
        lines.append(f"GitLab push: {message}")
    else:
        lines.append("GitLab push: disabled")
    files = result.get("files") or []
    if files:
        lines.extend(["", "Files:", *[f"- {f}" for f in files]])
    if result.get("research"):
        stats = result.get("research_stats") or {}
        lines.extend([
            "",
            f"Web research: {stats.get('queries_run', 0)} queries, {stats.get('pages_scraped', 0)} pages scraped, {stats.get('documents_captured', 0)} documents captured",
            f"Recommendation: {result.get('research_verdict', 'GO-CONDITIONAL')}",
        ])
        documents = result.get("documents") or []
        if documents:
            lines.append("Documents: " + ", ".join(documents))
        if result.get("research_timed_out"):
            lines.append("Note: research time limit reached — results are partial.")
    if result.get("error"):
        lines.extend(["", "Note: " + str(result["error"])])
    return "\n".join(lines)


SMART_ZIW_BOT_USER = {"id": "bot:smart-ziw", "name": "Smart-Ziw Bot", "email": "", "avatarUrl": ""}
AI_VERIFICATION_BOT_USER = {"id": "bot:ai-verification", "name": "AI Verification", "email": "", "avatarUrl": ""}
# Matches @smartziw, @SmartZiw, @smart-ziw, @smart ziw, @smart_ziw
_SMART_ZIW_MENTION_RE = re.compile(r"@smart[\s\-_]*ziw", re.IGNORECASE)
_SMART_ZIW_REPLY_MAX_CHARS = 2000


def _run_smart_ziw(project_db_id: str, actor_user: dict, thread_comments: list[dict] | None = None):
    try:
        config = get_smart_ziw_config()
        project = update_project_smart_ziw_state_by_db_id(project_db_id, {
            "smart_ziw_status": "running",
            "smart_ziw_error": "",
        })
        if not project:
            return
        thread = thread_comments if thread_comments is not None else list_comments("project", _project_entity_id(project))
        thread_text = _build_thread_text(thread)
        bound_tools = dict(REGISTRY)
        bound_tools["post_smart_ziw_comment"] = Tool(
            name="post_smart_ziw_comment",
            description="Post the final Smart-Ziw analysis comment.",
            input_schema=POST_COMMENT_SCHEMA,
            handler=make_post_comment_handler(actor_user),
        )
        result = run_smart_ziw_agent(project, config, thread_context=thread_text, tools=bound_tools)
        if not result.get("comment_posted"):
            _post_smart_ziw_comment(project, result)
        enrichment_error = result.get("error")
        push_error = None
        if config.get("gitlab_push_enabled") and not result.get("gitlab_pushed"):
            push_error = result.get("gitlab_message") or "GitLab push failed"
        error = enrichment_error or push_error
        ai_source = "Tool loop" if result.get("tool_loop") else ("Web research" if result.get("research") else "LLM enrichment")
        if result.get("research"):
            if result.get("research_timed_out") or (result.get("research_stats", {}).get("pages_scraped", 0) == 0):
                confidence = "medium"
            else:
                confidence = "high"
        else:
            confidence = "low"
        evidence = ""
        verdict_dict = result.get("verdict") or {}
        if isinstance(verdict_dict, dict):
            evidence = str(verdict_dict.get("reasoning") or "").strip()
        if not evidence and result.get("research_verdict"):
            evidence = f"Recommendation: {result['research_verdict']}"
        documents = result.get("documents") or []
        update_project_smart_ziw_state_by_db_id(project_db_id, {
            "smart_ziw_status": "error" if error else "completed",
            "smart_ziw_completed_at": now_iso(),
            "smart_ziw_error": (str(error)[:1000] if error else ""),
            "smart_ziw_folder": result.get("folder", ""),
            "smart_ziw_gitlab_pushed": bool(result.get("gitlab_pushed")),
            "smart_ziw_analysis_markdown": str(result.get("recap_markdown") or ""),
            "smart_ziw_next_actions": [],
            "smart_ziw_research_verdict": str(result.get("research_verdict") or ""),
            "smart_ziw_evidence": evidence,
            "smart_ziw_confidence": confidence,
            "smart_ziw_ai_source": ai_source,
            "smart_ziw_repo_path": str(result.get("repo_path") or ""),
            "smart_ziw_source_url": str(result.get("source_url") or ""),
            "smart_ziw_documents": documents,
            "smart_ziw_files_found": len(documents),
        })
    except Exception as exc:
        project = get_project_by_db_id(project_db_id)
        if project:
            _create_project_comment_and_notify(
                entity_type="project",
                entity_id=_project_entity_id(project),
                project=project,
                author_user=SMART_ZIW_BOT_USER,
                body_text=f"Smart-Ziw Agent could not complete.\n\nNotes: {str(exc).strip()}",
            )
        update_project_smart_ziw_state_by_db_id(project_db_id, {
            "smart_ziw_status": "error",
            "smart_ziw_completed_at": now_iso(),
            "smart_ziw_error": str(exc).strip()[:1000],
        })
    finally:
        with _smart_ziw_lock:
            _smart_ziw_running.discard(project_db_id)


def _build_thread_text(thread_comments: list[dict]) -> str:
    lines = []
    for c in thread_comments:
        author = c.get("authorName") or "Unknown"
        body = str(c.get("body") or "").strip()
        if not body:
            continue
        lines.append(f"{author}: {body}")
    return "\n".join(lines)


def _build_smart_ziw_chat_prompt(project: dict, comment: dict, thread_comments: list[dict]) -> str:
    body = _SMART_ZIW_MENTION_RE.sub("", str(comment.get("body") or "")).strip()
    lines = [
        f"Project name: {project.get('project_name') or ''}",
        f"Buyer: {project.get('project_sponsor') or ''}",
        f"Country: {project.get('primary_country_name_en') or ''}",
        f"Deadline: {project.get('project_end_date') or project.get('effective_deadline') or ''}",
        f"Description: {project.get('project_description') or ''}",
        f"Aggregator listing URL (scraped from, NOT the original source): {project.get('project_url') or ''}",
        f"Smart-Ziw status: {project.get('smart_ziw_status') or 'never run'}",
        f"Smart-Ziw folder: {project.get('smart_ziw_folder') or 'none'}",
        "",
        "Previous comments (oldest first):",
    ]
    previous = [c for c in thread_comments if c.get("id") != comment.get("id")][-30:]
    for previous_comment in previous:
        body_text = str(previous_comment.get("body") or "").strip()
        if not body_text:
            continue
        lines.append(f"{previous_comment.get('authorName') or 'Unknown'}: {body_text}")
    lines.extend(["", f"User comment: {body}"])
    return "\n".join(lines)


def _smart_ziw_bot_note(project: dict, body_text: str) -> None:
    _create_project_comment_and_notify(
        entity_type="project",
        entity_id=_project_entity_id(project),
        project=project,
        author_user=SMART_ZIW_BOT_USER,
        body_text=body_text,
    )


def _answer_smart_ziw_mention(project_db_id: str, project: dict, requester: dict, comment: dict, thread_comments: list[dict] | None = None) -> None:
    try:
        config = get_smart_ziw_config()
        call = get_llm_call(config, json_mode=False)
        thread = thread_comments if thread_comments is not None else list_comments(comment.get("entityType"), comment.get("entityId"))
        prompt = _build_smart_ziw_chat_prompt(project, comment, thread)
        answer = str(call(CHAT_PROMPT, prompt) or "").strip() or "Smart-Ziw has no answer for this question."
        if len(answer) > _SMART_ZIW_REPLY_MAX_CHARS:
            answer = answer[:_SMART_ZIW_REPLY_MAX_CHARS] + "…"
        _create_project_comment_and_notify(
            entity_type="project",
            entity_id=_project_entity_id(project),
            project=project,
            author_user=SMART_ZIW_BOT_USER,
            body_text=answer,
            mentions=[{
                "userId": requester.get("id") or "",
                "name": requester.get("name") or "",
                "email": requester.get("email") or "",
            }],
        )
    except Exception as exc:
        _smart_ziw_bot_note(project, f"Smart-Ziw could not answer: {exc}")
    finally:
        with _smart_ziw_lock:
            _smart_ziw_running.discard(project_db_id)


def _smart_ziw_mention_is_run_request(comment_body: str) -> bool:
    text = re.sub(r"[^\w\s]", " ", str(comment_body or "").lower())
    tokens = set(text.split())
    return bool(
        tokens & {"run", "execute", "perform", "start", "do", "process"}
        and tokens & {"actions", "action", "next", "nextactions", "tasks", "task"}
    )


def _maybe_start_smart_ziw_chat(comment: dict, project: dict | None, requester: dict | None) -> None:
    if not project or not requester:
        return
    if comment.get("entityType") != "project":
        return
    if not _SMART_ZIW_MENTION_RE.search(str(comment.get("body") or "")):
        return
    config = get_smart_ziw_config()
    if not config.get("smart_ziw_enabled", True):
        _smart_ziw_bot_note(project, "Smart-Ziw is disabled by the administrator.")
        return
    project_db_id = str(project.get("db_id") or "")
    if not project_db_id:
        return
    with _smart_ziw_lock:
        if project_db_id in _smart_ziw_running:
            busy = True
        else:
            busy = False
            _smart_ziw_running.add(project_db_id)
    if busy:
        _smart_ziw_bot_note(project, "Smart-Ziw is already working on this project. Please wait for the current run to finish.")
        return
    thread = list_comments(comment.get("entityType"), comment.get("entityId"))
    if _smart_ziw_mention_is_run_request(comment.get("body")):
        _smart_ziw_bot_note(project, "Smart-Ziw is starting the next actions run now.")
        threading.Thread(target=_run_smart_ziw, args=(project_db_id, requester, thread), daemon=True).start()
    else:
        threading.Thread(target=_answer_smart_ziw_mention, args=(project_db_id, project, requester, comment, thread), daemon=True).start()


# Auto-analyze: after a successful sync, run Smart-Ziw on eligible tenders.

def _auto_analyze_filter(projects: list[dict], config: dict) -> list[dict]:
    """Eligible tenders for auto-analysis, soonest deadline first, capped.

    Pure function over an in-memory project list (DB read happens in the
    caller) so it can be unit-tested without a database.
    """
    if not config.get("auto_analyze_enabled"):
        return []
    raw_cap = config.get("auto_analyze_max_per_run")
    try:
        max_per_run = int(raw_cap) if raw_cap is not None else 10
    except (TypeError, ValueError):
        max_per_run = 10
    if max_per_run <= 0:
        return []
    sources = {str(s).strip().lower() for s in (config.get("auto_analyze_sources") or []) if str(s).strip()}
    countries = {str(c).strip().lower() for c in (config.get("auto_analyze_countries") or []) if str(c).strip()}

    eligible = []
    for p in projects:
        if str(p.get("smart_ziw_status") or "").strip():
            continue  # never re-run: completed/errored/running stay manual
        if str(p.get("ai_verified") or "") != "Yes":
            continue
        if sources and str(p.get("source") or "").strip().lower() not in sources:
            continue
        country = str(p.get("country") or p.get("primary_country_name_en") or "").strip().lower()
        if countries and country not in countries:
            continue
        eligible.append(p)

    def _deadline(p: dict) -> str:
        return str(
            p.get("effective_deadline")
            or p.get("manual_deadline")
            or p.get("scraped_deadline")
            or p.get("project_end_date")
            or "9999-12-31"
        )

    eligible.sort(key=_deadline)
    return eligible[:max_per_run]


def _maybe_auto_analyze() -> int:
    """Enqueue Smart-Ziw runs for tenders that became eligible after a sync.

    Returns the number of runs started. Never raises — a failure here must
    not break the sync that triggered it.
    """
    try:
        config = get_smart_ziw_config()
        if not config.get("smart_ziw_enabled", True):
            return 0
        candidates = _auto_analyze_filter(get_all_projects(), config)
        started = 0
        for project in candidates:
            project_db_id = str(project.get("db_id") or "")
            if not project_db_id:
                continue
            with _smart_ziw_lock:
                if project_db_id in _smart_ziw_running:
                    continue
                _smart_ziw_running.add(project_db_id)
            threading.Thread(target=_run_smart_ziw, args=(project_db_id, SMART_ZIW_BOT_USER), daemon=True).start()
            started += 1
        if started:
            sync_state.add_line(f"[Smart-Ziw] Auto-analysis started for {started} tender(s).")
        return started
    except Exception:
        return 0


# Scheduler/sync

def _scheduled_sync_job():
    if sync_state.running:
        return
    schedule = db_get_schedule()
    sources = schedule.get("sources", {})
    cmd = [sys.executable, "-u", str(BASE_DIR / "main.py")]
    for src_name, enabled in sources.items():
        if enabled:
            cmd.append(f"--{src_name.replace('_', '-')}")
    if schedule.get("no_ai"):
        cmd.append("--no-ai")
    if schedule.get("include_expired"):
        cmd.append("--include-expired")
    sync_state.reset()
    threading.Thread(target=_run_sync_subprocess, args=(cmd, "scheduled"), daemon=True).start()


def _server_timezone_offset_hours() -> float:
    offset = datetime.now(SERVER_TZ).utcoffset() or timedelta()
    return offset.total_seconds() / 3600


def _translate_schedule_to_server_time(schedule: dict) -> dict:
    hour = int(schedule.get("hour", 6))
    minute = int(schedule.get("minute", 0))
    selected_offset = float(schedule.get("timezone", 0))
    server_offset = _server_timezone_offset_hours()

    local_minutes = (hour * 60) + minute
    server_minutes = int(round(local_minutes + ((server_offset - selected_offset) * 60)))
    day_shift = 0
    while server_minutes < 0:
        server_minutes += 1440
        day_shift -= 1
    while server_minutes >= 1440:
        server_minutes -= 1440
        day_shift += 1

    translated = {
        "hour": server_minutes // 60,
        "minute": server_minutes % 60,
        "day_of_week": schedule.get("day_of_week", "mon"),
        "server_timezone_offset_hours": server_offset,
    }

    if schedule.get("frequency", "daily") == "weekly":
        current_day = schedule.get("day_of_week", "mon")
        try:
            index = DAY_ORDER.index(current_day)
        except ValueError:
            index = 0
        translated["day_of_week"] = DAY_ORDER[(index + day_shift) % 7]

    return translated


def _configure_scheduler():
    schedule = db_get_schedule()
    if scheduler.get_job(SCHEDULER_JOB_ID):
        scheduler.remove_job(SCHEDULER_JOB_ID)
    if not schedule.get("enabled"):
        return
    translated = _translate_schedule_to_server_time(schedule)
    hour = translated["hour"]
    minute = translated["minute"]
    frequency = schedule.get("frequency", "daily")
    if frequency == "weekly":
        trigger = CronTrigger(day_of_week=translated["day_of_week"], hour=hour, minute=minute, timezone=SERVER_TZ)
    else:
        trigger = CronTrigger(hour=hour, minute=minute, timezone=SERVER_TZ)
    scheduler.add_job(_scheduled_sync_job, trigger=trigger, id=SCHEDULER_JOB_ID, replace_existing=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _bootstrap_admin_if_needed()
    db_seed_geography()
    _configure_scheduler()
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Procurement Watch API", lifespan=lifespan)
app.middleware("http")(_auth_middleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://frontend:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


_notification_queues: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue, str]] = []
_notification_lock = threading.Lock()


class SyncState:
    def __init__(self):
        self.running = False
        self.lines = []
        self.finished = False
        self.success = False
        self.project_count_before = 0
        self.summary = {}
        self.scraper_logs = {}
        self.lock = threading.Lock()

    def reset(self):
        with self.lock:
            self.running = True
            self.lines = []
            self.finished = False
            self.success = False
            self.summary = {}
            self.scraper_logs = {}
            self.project_count_before = len(get_all_projects())

    def add_line(self, line: str):
        with self.lock:
            self.lines.append(line)

    def finish(self, success: bool):
        with self.lock:
            self.running = False
            self.finished = True
            self.success = success
        if success:
            current_count = len(get_all_projects())
            new_count = current_count - self.project_count_before
            if new_count > 0:
                _broadcast_notification({"type": "new_projects", "count": new_count, "total": current_count, "timestamp": time.time()})


sync_state = SyncState()


def _is_live_sync_noise_line(line: str) -> bool:
    text = (line or "").strip()
    if not text:
        return True

    lower = text.lower()
    noise_prefixes = (
        "127.0.0.1:",
        "[proxy]",
        "auth:",
        "<< ",
        ">> ",
        "waiting... ",
    )
    if lower.startswith(noise_prefixes):
        return True

    noise_contains = (
        " http/2.0",
        "peer closed connection",
        "mwctoken",
        "saved 1 token",
        "saved 1 token(s)",
        "optimizationguide-pa.googleapis.com",
        "content.powerapps.com",
        "analysis.windows.net",
        "dc.services.visualstudio.com",
        "clarity.ms",
        "mtalk.google.com",
        "appsource.powerbi.com",
        "android.clients.google.com",
        "telemetry/certifiedevents",
        "privacyportal.onetrust.com",
        "pbivisuals.powerbi.com",
        "c.bing.com/c.gif",
        "j.clarity.ms/collect",
        "accepted cookies.",
        "scrolling to load power bi content",
        "scrolled down 500px",
        "watch the output above for mwctoken captures",
    )
    if any(fragment in lower for fragment in noise_contains):
        return True

    if text.startswith("============================================================"):
        return True

    return False


def _save_to_excel(projects: list[dict]):
    try:
        from shared_excel import save_to_excel
        save_to_excel(projects, filename=str(PROJECTS_XLSX))
    except Exception as e:
        print(f"[!] Excel save failed: {e}")


def _queue_excel_export(reason: str = "mutation"):
    global _excel_export_running, _excel_export_pending

    with _excel_export_lock:
        if _excel_export_running:
            _excel_export_pending = True
            print(f"[excel] queued follow-up export ({reason})")
            return
        _excel_export_running = True

    def worker():
        global _excel_export_running, _excel_export_pending
        started = time.perf_counter()
        try:
            projects = get_all_projects()
            _save_to_excel(projects)
            elapsed_ms = (time.perf_counter() - started) * 1000
            print(f"[excel] background export complete ({reason}) in {elapsed_ms:.1f}ms for {len(projects)} projects")
        finally:
            rerun = False
            with _excel_export_lock:
                rerun = _excel_export_pending
                _excel_export_pending = False
                _excel_export_running = False
            if rerun:
                _queue_excel_export("coalesced")

    threading.Thread(target=worker, daemon=True).start()


def _run_sync_subprocess(cmd: list[str], trigger: str = "manual"):
    started_at = datetime.now(timezone.utc).isoformat()
    all_log_lines = []
    display_log_lines = []
    success = False
    try:
        proc = subprocess.Popen(cmd, cwd=str(BASE_DIR), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in iter(proc.stdout.readline, ""):
            stripped = line.rstrip()
            if not stripped:
                continue
            all_log_lines.append(stripped)
            if stripped.startswith("__SUMMARY__") and stripped.endswith("__END__"):
                try:
                    sync_state.summary = json.loads(stripped[len("__SUMMARY__"):-len("__END__")])
                except Exception:
                    pass
            elif stripped.startswith("__SCRAPER_LOG__") and stripped.endswith("__END__"):
                try:
                    log_data = json.loads(stripped[len("__SCRAPER_LOG__"):-len("__END__")])
                    key = log_data.get("key", "unknown")
                    with sync_state.lock:
                        sync_state.scraper_logs[key] = {"label": log_data.get("label", key), "output": log_data.get("output", "")}
                except Exception:
                    pass
            else:
                if not _is_live_sync_noise_line(stripped):
                    sync_state.add_line(stripped)
                    display_log_lines.append(stripped)
        proc.wait()
        success = proc.returncode == 0
        sync_state.finish(success)
        if success:
            _maybe_auto_analyze()
    except Exception as e:
        msg = f"[!] Error: {e}"
        sync_state.add_line(msg)
        all_log_lines.append(msg)
        sync_state.finish(False)
    finally:
        finished_at = datetime.now(timezone.utc).isoformat()
        project_count = len(get_all_projects())
        summary = sync_state.summary if isinstance(sync_state.summary, dict) else {}
        new_project_count = summary.get("new_projects")
        if new_project_count is None:
            new_project_count = max(0, project_count - sync_state.project_count_before)
        scraper_details = {}
        with sync_state.lock:
            for key, info in sync_state.scraper_logs.items():
                scraper_details[key] = {"label": info["label"], "output": info["output"].split("\n") if info["output"] else []}
        save_sync_log({
            "started_at": started_at,
            "finished_at": finished_at,
            "success": success,
            "project_count": project_count,
            "new_project_count": new_project_count,
            "log_lines": display_log_lines,
            "raw_log_lines": all_log_lines,
            "trigger": trigger,
            "summary": summary,
            "scraper_logs": scraper_details,
        })


def _start_sync_with_flags(req_dict: dict):
    if sync_state.running:
        return False
    cmd = [sys.executable, "-u", str(BASE_DIR / "main.py")]
    flag_map = {
        "iadb": "--iadb",
        "worldbank": "--worldbank",
        "globaltenders": "--globaltenders",
        "giz": "--giz",
        "devaid": "--devaid",
        "dgmarket": "--dgmarket",
        "africagateway": "--africagateway",
        "isdb": "--isdb",
        "badea": "--badea",
        "bcie": "--bcie",
        "eabr": "--eabr",
        "oas": "--oas",
        "africanunion": "--africanunion",
        "nigermarches": "--nigermarches",
        "no_ai": "--no-ai",
        "no_enrich": "--no-enrich",
        "include_expired": "--include-expired",
    }
    for key, flag in flag_map.items():
        if req_dict.get(key):
            cmd.append(flag)
    sync_state.reset()
    threading.Thread(target=_run_sync_subprocess, args=(cmd,), daemon=True).start()
    return True


# Models
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    currentPassword: str | None = None
    newPassword: str = Field(min_length=8)


class ProfileUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    avatarUrl: str = ""


class AdminUserCreateRequest(BaseModel):
    name: str
    email: EmailStr
    role: str = "user"
    avatarUrl: str = ""
    password: str | None = None


class AdminUserUpdateRequest(BaseModel):
    name: str
    email: EmailStr
    role: str
    avatarUrl: str = ""
    isActive: bool = True


class AdminResetPasswordRequest(BaseModel):
    newPassword: str | None = None


class ConfigUpdate(BaseModel):
    keywords: list[str] = []
    regions: dict[str, list[str]] = {}


class ReleaseNoteItem(BaseModel):
    version: str
    title: str
    summary: str = ""
    items: list[str] = Field(default_factory=list)


class ReleaseNotesUpdate(BaseModel):
    notes: list[ReleaseNoteItem] = Field(default_factory=list)


class SyncRequest(BaseModel):
    iadb: bool = False
    worldbank: bool = False
    globaltenders: bool = False
    giz: bool = False
    devaid: bool = False
    dgmarket: bool = False
    africagateway: bool = False
    isdb: bool = False
    badea: bool = False
    bcie: bool = False
    eabr: bool = False
    oas: bool = False
    africanunion: bool = False
    nigermarches: bool = False
    no_ai: bool = False
    no_enrich: bool = False
    include_expired: bool = False


class ScheduleUpdate(BaseModel):
    enabled: bool = False
    frequency: str = "daily"
    day_of_week: str = "mon"
    hour: int = 6
    minute: int = 0
    sources: dict = {}
    no_ai: bool = False
    include_expired: bool = False
    timezone: float = 0


class DecisionUpdate(BaseModel):
    decision: str


class DeadlineUpdate(BaseModel):
    manualDeadline: str = ""


class BulkProjectDeleteRequest(BaseModel):
    projectDbIds: list[str] = Field(default_factory=list)


class MentionItem(BaseModel):
    userId: str
    name: str = ""
    email: str = ""


class CommentCreateRequest(BaseModel):
    entityType: str
    entityId: str
    body: str = Field(min_length=1, max_length=4000)
    projectDbId: str = ""
    attachments: list[dict] = Field(default_factory=list)
    mentions: list[MentionItem] = Field(default_factory=list)


class ProjectAssignmentsUpdate(BaseModel):
    userIds: list[str] = Field(default_factory=list)


class ProjectVoteUpdate(BaseModel):
    value: str = ""


class SmartZiwTriggerRequest(BaseModel):
    force: bool = False


class SmartZiwConfigUpdate(BaseModel):
    smart_ziw_enabled: bool = True
    smart_ziw_repo_path: str = "/home/kali/Smart-Ziw"
    gitlab_push_enabled: bool = False
    gitlab_base_url: str = "http://localhost:8080"
    gitlab_project_path: str = "root/Smart-Ziw"
    gitlab_token: str = ""
    gitlab_branch: str = "main"
    gitlab_author_name: str = "Smart-Ziw Agent"
    gitlab_author_email: str = "smart-ziw@localhost"
    forvis_mazars_presence_countries: list[str] = Field(default_factory=list)
    smart_ziw_research_enabled: bool = True
    smart_ziw_research_timeout_seconds: int = 900
    smart_ziw_llm_provider: str = "auto"
    lightllm_base_url: str = ""
    lightllm_api_key: str = ""
    lightllm_subscription_key: str = ""
    lightllm_model: str = "default"
    lightllm_provider: str = "openai_compatible"
    llm_temperature: float = 0.1
    llm_max_tokens: int = 4000
    tempmail_enabled: bool = False
    auto_analyze_enabled: bool = False
    auto_analyze_sources: list[str] = Field(default_factory=list)
    auto_analyze_countries: list[str] = Field(default_factory=list)
    auto_analyze_max_per_run: int = 10
    ai_verification_system_prompt: str = DEFAULT_SMART_ZIW_CONFIG["ai_verification_system_prompt"]
    ai_verification_expertise: str = DEFAULT_SMART_ZIW_CONFIG["ai_verification_expertise"]
    ai_verification_unwanted: str = DEFAULT_SMART_ZIW_CONFIG["ai_verification_unwanted"]


class LlmModelsRequest(BaseModel):
    provider: str = "openai_compatible"
    base_url: str = ""
    api_key: str = ""
    subscription_key: str = ""
    preset_id: str = ""


class SavedSearchItem(BaseModel):
    id: str
    name: str
    filters: dict = Field(default_factory=dict)
    createdAt: str | None = None
    updatedAt: str | None = None


class SavedSearchesUpdate(BaseModel):
    searches: list[SavedSearchItem] = Field(default_factory=list)


class McpServerConfig(BaseModel):
    id: str = ""
    name: str = ""
    transport: str = "sse"
    url: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    timeout: int = 30
    tools: list[dict] = Field(default_factory=list)


# Auth endpoints
@app.post("/api/auth/login")
def login(body: LoginRequest):
    user = get_user_by_email(body.email)
    if not user or not _verify_password(body.password, user.get("passwordHash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("isActive", True):
        raise HTTPException(status_code=403, detail="User is deactivated")

    seen_at = now_iso()
    update_user(user["id"], {"lastLoginAt": seen_at, "lastSeenAt": seen_at})
    fresh = get_user_by_id(user["id"])
    access_token = _create_access_token(fresh)
    refresh_token = _create_refresh_token(fresh)
    return {"user": _sanitize_user(fresh), "accessToken": access_token, "refreshToken": refresh_token}


@app.post("/api/auth/logout")
def logout():
    return {"ok": True}


@app.get("/api/auth/me")
def me(request: Request):
    user = request.state.user
    updated = update_user(user["id"], {"lastSeenAt": now_iso()})
    return {"user": _sanitize_user(updated or user)}


class RefreshRequest(BaseModel):
    refreshToken: str


@app.post("/api/auth/refresh")
def refresh_token(body: RefreshRequest):
    payload = _decode_token(body.refreshToken)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = get_user_by_id(payload.get("sub", ""))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.get("isActive", True):
        raise HTTPException(status_code=403, detail="User is deactivated")
    user = update_user(user["id"], {"lastSeenAt": now_iso()}) or user
    new_access = _create_access_token(user)
    return {"accessToken": new_access, "user": _sanitize_user(user)}


@app.post("/api/auth/change-password")
def change_password(body: ChangePasswordRequest, request: Request):
    user = request.state.user
    if user.get("mustChangePassword"):
        if not body.currentPassword and not body.newPassword:
            raise HTTPException(status_code=400, detail="Invalid payload")
    else:
        if not body.currentPassword or not _verify_password(body.currentPassword, user.get("passwordHash", "")):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

    update_user(user["id"], {
        "passwordHash": _hash_password(body.newPassword),
        "mustChangePassword": False,
    })
    return {"ok": True}


@app.put("/api/auth/profile")
def update_profile(body: ProfileUpdateRequest, request: Request):
    user = request.state.user
    existing = get_user_by_email(body.email)
    if existing and existing.get("id") != user.get("id"):
        raise HTTPException(status_code=400, detail="Email already used")
    updated = update_user(user["id"], {
        "name": body.name.strip(),
        "email": body.email.lower().strip(),
        "avatarUrl": body.avatarUrl.strip(),
    })
    return {"user": _sanitize_user(updated)}


# Admin user management
@app.get("/api/admin/users")
def admin_list_users(request: Request, q: str = ""):
    _require_admin(request)
    users = [_sanitize_user(u) for u in list_users(q)]
    return users


@app.post("/api/admin/users")
def admin_create_user(body: AdminUserCreateRequest, request: Request):
    _require_admin(request)
    if body.role not in ("admin", "manager", "user"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if get_user_by_email(body.email):
        raise HTTPException(status_code=400, detail="Email already exists")

    generated_password = body.password or secrets.token_urlsafe(10)
    ts = now_iso()
    user = {
        "id": str(uuid.uuid4()),
        "email": body.email.lower().strip(),
        "name": body.name.strip(),
        "role": body.role,
        "passwordHash": _hash_password(generated_password),
        "avatarUrl": body.avatarUrl.strip(),
        "mustChangePassword": True,
        "isActive": True,
        "createdAt": ts,
        "updatedAt": ts,
        "lastLoginAt": None,
        "lastSeenAt": None,
    }
    create_user_doc(user)
    return {"user": _sanitize_user(user), "temporaryPassword": generated_password}


@app.put("/api/admin/users/{user_id}")
def admin_update_user(user_id: str, body: AdminUserUpdateRequest, request: Request):
    admin = _require_admin(request)
    if body.role not in ("admin", "manager", "user"):
        raise HTTPException(status_code=400, detail="Invalid role")
    target = get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["id"] == admin["id"] and body.role != "admin":
        raise HTTPException(status_code=400, detail="Cannot remove your own admin role")
    if target["id"] == admin["id"] and not body.isActive:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
    existing = get_user_by_email(body.email)
    if existing and existing.get("id") != user_id:
        raise HTTPException(status_code=400, detail="Email already used")

    updated = update_user(user_id, {
        "name": body.name.strip(),
        "email": body.email.lower().strip(),
        "role": body.role,
        "avatarUrl": body.avatarUrl.strip(),
        "isActive": body.isActive,
    })
    return {"user": _sanitize_user(updated)}


@app.post("/api/admin/users/{user_id}/reset-password")
def admin_reset_password(user_id: str, body: AdminResetPasswordRequest, request: Request):
    _require_admin(request)
    target = get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    pwd = body.newPassword or secrets.token_urlsafe(10)
    update_user(user_id, {"passwordHash": _hash_password(pwd), "mustChangePassword": True})
    return {"ok": True, "temporaryPassword": pwd}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: str, request: Request):
    admin = _require_admin(request)
    if admin.get("id") == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    if not delete_user(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


# Comments
@app.get("/api/users")
def get_active_users(request: Request):
    return list(_active_users_by_id().values())


@app.get("/api/saved-searches")
def get_saved_searches(request: Request):
    return {"searches": db_get_saved_searches(request.state.user.get("id"))}


@app.put("/api/saved-searches")
def save_saved_searches(body: SavedSearchesUpdate, request: Request):
    sanitized = []
    for raw in body.searches[:30]:
        item = raw.model_dump() if hasattr(raw, "model_dump") else raw.dict()
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        sanitized.append({
            "id": str(item.get("id") or uuid.uuid4()),
            "name": name[:80],
            "filters": item.get("filters") or {},
            "createdAt": item.get("createdAt") or now_iso(),
            "updatedAt": now_iso(),
        })
    return {"searches": db_save_saved_searches(request.state.user.get("id"), sanitized)}


@app.get("/api/comments")
def get_comments(entityType: str, entityId: str, mine: bool = False, search: str = "", request: Request = None):
    comments = list_comments(entityType, entityId)
    if mine:
        comments = [c for c in comments if c.get("authorUserId") == request.state.user.get("id")]
    if search:
        q = search.lower()
        def _matches(c):
            if q in (c.get("body") or "").lower():
                return True
            for att in c.get("attachments", []):
                if q in (att.get("originalName") or "").lower():
                    return True
            return False
        comments = [c for c in comments if _matches(c)]

    user_map = {u["id"]: _sanitize_user(u) for u in list_users("")}
    out = []
    for c in comments:
        author = user_map.get(c.get("authorUserId"), {
            "id": c.get("authorUserId"),
            "name": c.get("authorName") or "Unknown",
            "avatarUrl": c.get("authorAvatarUrl", ""),
        })
        out.append({
            "id": c.get("id"),
            "entityType": c.get("entityType"),
            "entityId": c.get("entityId"),
            "authorUserId": c.get("authorUserId"),
            "authorName": author.get("name", "Unknown"),
            "authorAvatarUrl": author.get("avatarUrl", ""),
            "body": c.get("body"),
            "attachments": c.get("attachments", []),
            "mentions": c.get("mentions", []),
            "createdAt": c.get("createdAt"),
            "updatedAt": c.get("updatedAt"),
        })
    return out

@app.get("/api/projects/by-db-id/{project_db_id}")
def get_project(project_db_id: str, request: Request):
    project = get_project_by_db_id(project_db_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _enrich_project_payload(
        project,
        user_map=_active_users_by_id(),
        comment_metrics=get_comment_metrics("project"),
        current_user_id=request.state.user.get("id"),
    )


@app.post("/api/comments")
def post_comment(body: CommentCreateRequest, request: Request):
    text = body.body.strip()
    if not text and not body.attachments:
        raise HTTPException(status_code=400, detail="Comment body is required")
    users = _active_users_by_id()
    mentions = _sanitize_mentions(body.mentions or [], users)
    project = get_project_by_db_id(body.projectDbId.strip()) if body.projectDbId else None
    comment = _create_project_comment_and_notify(
        entity_type=body.entityType,
        entity_id=body.entityId,
        project=project,
        author_user=request.state.user,
        body_text=text,
        attachments=body.attachments or [],
        mentions=mentions,
    )
    if body.entityType == "project":
        try:
            _maybe_start_smart_ziw_chat(comment, project, request.state.user)
        except Exception:
            pass  # the mention reply must never fail the comment POST
    return {"comment": comment}


@app.post("/api/comments/upload")
async def upload_comment_file(file: UploadFile, request: Request):
    if file.size and file.size > MAX_COMMENT_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_COMMENT_UPLOAD_MB} MB)")
    safe_name = Path(file.filename).name.replace("..", "").replace("/", "").replace("\\", "") if file.filename else "file"
    contents = await file.read()
    if len(contents) > MAX_COMMENT_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_COMMENT_UPLOAD_MB} MB)")

    file_id = str(uuid.uuid4())
    dest_dir = UPLOADS_DIR / file_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe_name
    dest_path.write_bytes(contents)
    return {
        "fileId": file_id,
        "originalName": safe_name,
        "size": len(contents),
        "mimeType": file.content_type or "application/octet-stream",
        "url": f"/api/uploads/{file_id}/{safe_name}",
    }


@app.get("/api/uploads/{file_id}/{filename}")
def serve_upload(file_id: str, filename: str):
    safe_id = file_id.replace("..", "").replace("/", "").replace("\\", "")
    safe_name = filename.replace("..", "").replace("/", "").replace("\\", "")
    filepath = UPLOADS_DIR / safe_id / safe_name
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    media_type, _ = mimetypes.guess_type(str(filepath))
    displayable_types = (
        "application/pdf",
        "image/",
        "text/",
    )
    disposition = "attachment"
    if media_type and (
        media_type == "application/pdf"
        or any(media_type.startswith(prefix) for prefix in ("image/", "text/"))
    ):
        disposition = "inline"
    return FileResponse(
        filepath,
        filename=safe_name,
        media_type=media_type or "application/octet-stream",
        content_disposition_type=disposition,
    )

def _upload_local_file_to_comment_store(file_path: Path) -> dict | None:
    """Copy a local file into the comment upload store and return an attachment dict."""
    try:
        if not file_path.exists() or not file_path.is_file():
            return None
        data = file_path.read_bytes()
        if len(data) > MAX_COMMENT_UPLOAD_BYTES:
            return None
        safe_name = file_path.name.replace("..", "").replace("/", "").replace("\\", "")
        file_id = str(uuid.uuid4())
        dest_dir = UPLOADS_DIR / file_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / safe_name
        dest_path.write_bytes(data)
        media_type, _ = mimetypes.guess_type(str(dest_path))
        return {
            "fileId": file_id,
            "originalName": safe_name,
            "size": len(data),
            "mimeType": media_type or "application/octet-stream",
            "url": f"/api/uploads/{file_id}/{safe_name}",
        }
    except Exception:
        return None


def _build_reference_footer(references: list[dict], uploaded_attachments: list[dict]) -> str:
    if not references:
        return ""
    # Map url_or_path to uploaded attachment when it matches a file path in the attachments.
    attachment_by_name: dict[str, dict] = {}
    for att in uploaded_attachments:
        name = att.get("originalName", "")
        if name:
            attachment_by_name[name] = att
    lines = ["", "---", "", "## References"]
    for ref in references:
        number = ref.get("number") if isinstance(ref.get("number"), int) else 0
        title = str(ref.get("title") or "").strip()
        url_or_path = str(ref.get("url_or_path") or "").strip()
        # Prefer uploaded attachment URL if the reference points to a downloaded file.
        if url_or_path and not url_or_path.startswith("http"):
            name = Path(url_or_path).name
            att = attachment_by_name.get(name)
            if att:
                url_or_path = att["url"]
            elif not url_or_path.startswith("/"):
                url_or_path = f"files/{url_or_path}"
        display = title or url_or_path or "source"
        lines.append(f"[{number}] {display} — {url_or_path}")
    return "\n".join(lines)


def _post_smart_ziw_comment(project: dict, result: dict) -> None:
    repo_path = Path(result.get("repo_path") or "/home/kali/Smart-Ziw")
    folder = result.get("folder", "")
    recap_path = repo_path / folder / "recap.md"
    recap_markdown = result.get("recap_markdown") or ""
    if recap_path.exists():
        try:
            recap_markdown = recap_path.read_text(encoding="utf-8")
        except Exception:
            pass

    if not recap_markdown.strip():
        _create_project_comment_and_notify(
            entity_type="project",
            entity_id=_project_entity_id(project),
            project=project,
            author_user=SMART_ZIW_BOT_USER,
            body_text="Smart-Ziw Agent finished, but no recap was generated.",
        )
        return

    # Upload collected files (originals and extracted markdown) as comment attachments.
    uploaded_attachments: list[dict] = []
    files_dir = repo_path / folder / "files"
    if files_dir.exists():
        for file_path in sorted(files_dir.rglob("*")):
            if not file_path.is_file():
                continue
            att = _upload_local_file_to_comment_store(file_path)
            if att:
                uploaded_attachments.append(att)

    footer = _build_reference_footer(result.get("references") or [], uploaded_attachments)
    files_section = ""
    if uploaded_attachments:
        files_section = "\n\n---\n\n## Downloadable files\n" + "\n".join(
            f"- [{att['originalName']}]({att['url']})" for att in uploaded_attachments
        )
    body = recap_markdown.strip() + footer + files_section

    _create_project_comment_and_notify(
        entity_type="project",
        entity_id=_project_entity_id(project),
        project=project,
        author_user=SMART_ZIW_BOT_USER,
        body_text=body,
        attachments=uploaded_attachments,
    )


async def post_smart_ziw_comment(
    tender_id: str,
    content: str,
    source_url: str,
    downloaded_files: list[str],
    failed_files: list[str],
    user: dict[str, Any],
) -> dict[str, Any]:
    """Post the Smart-Ziw analysis comment as the bot on a tender (tool-loop handler).

    `source_url` and `user` are part of the tool interface; the bot authors the
    comment, so `user` (the actor who triggered Smart-Ziw) is currently unused.
    """
    try:
        project = get_project_by_db_id(tender_id)
        if not project:
            return {"status": "error", "error": "Tender not found"}

        uploaded_attachments: list[dict] = []
        for file_path in downloaded_files or []:
            att = _upload_local_file_to_comment_store(Path(file_path))
            if att:
                uploaded_attachments.append(att)

        body = (content or "").strip()
        if body:
            if uploaded_attachments:
                body += "\n\n---\n\n## Downloadable files\n" + "\n".join(
                    f"- [{att['originalName']}]({att['url']})" for att in uploaded_attachments
                )
        else:
            body = "Smart-Ziw Agent finished, but no recap was generated."

        if failed_files:
            body += "\n\n---\n\n## Files we could not retrieve\n" + "\n".join(
                f"- [{url}]({url})" for url in failed_files
            )

        comment = _create_project_comment_and_notify(
            entity_type="project",
            entity_id=_project_entity_id(project),
            project=project,
            author_user=SMART_ZIW_BOT_USER,
            body_text=body,
            attachments=uploaded_attachments,
        )
        return {"status": "ok", "comment_id": comment["id"], "comment": comment}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


def make_post_comment_handler(user: dict[str, Any]):
    async def handler(args: dict[str, Any]) -> dict[str, Any]:
        return await post_smart_ziw_comment(
            tender_id=args["tender_id"],
            content=args["content"],
            source_url=args["source_url"],
            downloaded_files=args.get("downloaded_files", []),
            failed_files=args.get("failed_files", []),
            user=user,
        )

    return handler


def auth_bootstrap_status():
    has_admin = count_admin_users() > 0
    env_configured = bool(os.getenv("ADMIN_EMAIL", "").strip() and os.getenv("ADMIN_PASSWORD", ""))
    return {"hasAdmin": has_admin, "envConfigured": env_configured}

@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/projects")
def list_projects(request: Request):
    user_map = _active_users_by_id()
    comment_metrics = get_comment_metrics("project")
    current_user_id = request.state.user.get("id")
    return [
        _enrich_project_payload(project, user_map=user_map, comment_metrics=comment_metrics, current_user_id=current_user_id)
        for project in get_all_projects()
    ]


@app.delete("/api/projects/{index}")
def delete_project(index: int):
    started = time.perf_counter()
    result = delete_project_by_index(index)
    db_ms = (time.perf_counter() - started) * 1000
    if result is None:
        raise HTTPException(status_code=404, detail="Project index out of range")
    _queue_excel_export("single-delete:index")
    total_ms = (time.perf_counter() - started) * 1000
    print(f"[delete] index={index} db={db_ms:.1f}ms response={total_ms:.1f}ms")
    return {"deleted": True, "project": result}


@app.delete("/api/projects/by-db-id/{project_db_id}")
def delete_project_by_id(project_db_id: str):
    started = time.perf_counter()
    result = delete_project_by_db_id(project_db_id)
    db_ms = (time.perf_counter() - started) * 1000
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    _queue_excel_export("single-delete:db-id")
    total_ms = (time.perf_counter() - started) * 1000
    print(f"[delete] db_id={project_db_id} db={db_ms:.1f}ms response={total_ms:.1f}ms")
    return {"deleted": True, "project": result}


@app.post("/api/projects/bulk-delete")
def bulk_delete_projects(body: BulkProjectDeleteRequest):
    started = time.perf_counter()
    result = delete_projects_by_db_ids(body.projectDbIds)
    db_ms = (time.perf_counter() - started) * 1000
    if result["deleted_count"] == 0:
        return {"deleted": True, "count": 0, "deletedIds": []}
    _queue_excel_export("bulk-delete")
    total_ms = (time.perf_counter() - started) * 1000
    print(f"[delete-bulk] count={result['deleted_count']} db={db_ms:.1f}ms response={total_ms:.1f}ms")
    return {
        "deleted": True,
        "count": result["deleted_count"],
        "deletedIds": result["deleted_ids"],
    }


@app.get("/api/documents/{project_id}/{filename}")
def download_document(project_id: str, filename: str):
    safe_pid = project_id.replace("..", "").replace("/", "").replace("\\", "")
    safe_fname = filename.replace("..", "").replace("/", "").replace("\\", "")
    filepath = DOWNLOADS_DIR / safe_pid / safe_fname
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Document not found")
    return FileResponse(filepath, filename=safe_fname)


@app.get("/api/config")
def get_config():
    return db_get_config()


@app.get("/api/geography")
def get_geography():
    return db_get_geography()


@app.put("/api/config")
def update_config(body: ConfigUpdate):
    db_save_config(body.keywords, body.regions)
    return {"status": "saved", "keywords": len(body.keywords), "regions": len(body.regions)}


@app.get("/api/release-notes")
def get_release_notes():
    return {"notes": db_get_release_notes()}


@app.get("/api/admin/release-notes")
def admin_get_release_notes(request: Request):
    _require_admin(request)
    return {"notes": db_get_release_notes()}


@app.put("/api/admin/release-notes")
def admin_update_release_notes(body: ReleaseNotesUpdate, request: Request):
    _require_admin(request)
    normalized = []
    for note in body.notes:
        normalized.append({
            "version": note.version.strip(),
            "title": note.title.strip(),
            "summary": note.summary.strip(),
            "items": [item.strip() for item in note.items if str(item).strip()],
        })
    db_save_release_notes(normalized)
    return {"status": "saved", "count": len(normalized)}


@app.post("/api/sync/start")
def start_sync(req: SyncRequest, request: Request):
    secret = request.headers.get("X-Sync-Secret", "")
    if secret != SYNC_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden: invalid sync secret")
    if not _start_sync_with_flags(req.model_dump()):
        raise HTTPException(status_code=409, detail="Sync already running")
    return {"status": "started"}


@app.post("/api/sync/manual")
def start_sync_manual(req: SyncRequest):
    if not _start_sync_with_flags(req.model_dump()):
        raise HTTPException(status_code=409, detail="Sync already running")
    return {"status": "started"}


@app.get("/api/sync/stream")
async def stream_sync():
    async def event_generator():
        sent = 0
        while True:
            with sync_state.lock:
                new_lines = sync_state.lines[sent:]
                finished = sync_state.finished
                success = sync_state.success
            for line in new_lines:
                yield f"data: {json.dumps({'type': 'log', 'message': line, 'index': sent})}\\n\\n"
                sent += 1
            if finished:
                projects = get_all_projects()
                done_data = {"type": "done", "success": success, "project_count": len(projects)}
                if sync_state.summary:
                    done_data["summary"] = sync_state.summary
                yield f"data: {json.dumps(done_data)}\\n\\n"
                break
            await asyncio.sleep(0.3)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@app.get("/api/sync/status")
def sync_status():
    with sync_state.lock:
        return {"running": sync_state.running, "finished": sync_state.finished, "success": sync_state.success, "line_count": len(sync_state.lines), "lines": list(sync_state.lines), "summary": sync_state.summary}


@app.get("/api/schedule/logs/{index}/scrapers")
def get_scraper_logs(index: int):
    db = get_db()
    logs = list(db.sync_logs.find({}, {"_id": 0}).sort("started_at", -1))
    if index < 0 or index >= len(logs):
        raise HTTPException(status_code=404, detail="Log not found")
    return logs[index].get("scraper_logs", {})


@app.get("/api/schedule")
def get_schedule():
    schedule = db_get_schedule()
    job = scheduler.get_job(SCHEDULER_JOB_ID)
    schedule["next_run"] = job.next_run_time.isoformat() if job and job.next_run_time else None
    schedule["server_schedule"] = _translate_schedule_to_server_time(schedule)
    return schedule


@app.put("/api/schedule")
def update_schedule(body: ScheduleUpdate):
    schedule_data = body.model_dump()
    db_save_schedule(schedule_data)
    _configure_scheduler()
    job = scheduler.get_job(SCHEDULER_JOB_ID)
    next_run = job.next_run_time.isoformat() if job and job.next_run_time else None
    return {"status": "saved", "next_run": next_run, "server_schedule": _translate_schedule_to_server_time(schedule_data)}


@app.get("/api/schedule/logs")
def schedule_logs():
    return get_sync_logs(limit=5)


@app.get("/api/server-time")
def server_time():
    return {
        "server_time": datetime.now(timezone.utc).isoformat(),
        "server_timezone_offset_hours": _server_timezone_offset_hours(),
        "server_timezone_name": str(SERVER_TZ),
    }


@app.patch("/api/projects/{index}/decision")
def update_decision(index: int, body: DecisionUpdate, request: Request):
    _require_manager(request)
    if body.decision not in ("Go", "No Go", ""):
        raise HTTPException(status_code=400, detail="Decision must be 'Go', 'No Go', or ''")
    result = update_project_by_index(index, body.decision)
    if result is None:
        raise HTTPException(status_code=404, detail="Project index out of range")
    _save_to_excel(get_all_projects())
    return _enrich_project_payload(result, current_user_id=request.state.user.get("id"))


@app.patch("/api/projects/by-db-id/{project_db_id}/decision")
def update_decision_by_id(project_db_id: str, body: DecisionUpdate, request: Request):
    _require_manager(request)
    if body.decision not in ("Go", "No Go", ""):
        raise HTTPException(status_code=400, detail="Decision must be 'Go', 'No Go', or ''")
    result = update_project_by_db_id(project_db_id, body.decision)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    _save_to_excel(get_all_projects())
    return _enrich_project_payload(result, current_user_id=request.state.user.get("id"))


@app.patch("/api/projects/{index}/deadline")
def update_deadline(index: int, body: DeadlineUpdate, request: Request):
    user = _require_admin_or_manager(request)
    result = update_project_deadline_by_index(index, body.manualDeadline, user)
    if result is None:
        raise HTTPException(status_code=404, detail="Project index out of range")
    _save_to_excel(get_all_projects())
    return _enrich_project_payload(result, current_user_id=request.state.user.get("id"))


@app.patch("/api/projects/by-db-id/{project_db_id}/deadline")
def update_deadline_by_id(project_db_id: str, body: DeadlineUpdate, request: Request):
    user = _require_admin_or_manager(request)
    result = update_project_deadline_by_db_id(project_db_id, body.manualDeadline, user)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    _save_to_excel(get_all_projects())
    return _enrich_project_payload(result, current_user_id=request.state.user.get("id"))


@app.put("/api/projects/by-db-id/{project_db_id}/assignments")
def update_project_assignments(project_db_id: str, body: ProjectAssignmentsUpdate, request: Request):
    users = _active_users_by_id()
    valid_user_ids = [user_id for user_id in body.userIds if user_id in users]
    project_before = get_project_by_db_id(project_db_id)
    result = update_project_assignments_by_db_id(project_db_id, valid_user_ids)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    previous_assigned = set((project_before or {}).get("assigned_user_ids") or [])
    new_assigned = [user_id for user_id in valid_user_ids if user_id not in previous_assigned]
    if new_assigned:
        actor_name = request.state.user.get("name") or request.state.user.get("email") or "Someone"
        _emit_user_notifications(
            user_ids=new_assigned,
            actor_user=request.state.user,
            notification_type="assignment",
            message=f"{actor_name} assigned you to {result.get('project_name') or result.get('project_id') or 'a tender'}.",
            project=result,
        )
    return _enrich_project_payload(result, user_map=users, current_user_id=request.state.user.get("id"))


@app.post("/api/projects/by-db-id/{project_db_id}/vote")
def update_project_vote(project_db_id: str, body: ProjectVoteUpdate, request: Request):
    if body.value not in ("up", "down", ""):
        raise HTTPException(status_code=400, detail="Vote must be 'up', 'down', or ''")
    result = update_project_vote_by_db_id(project_db_id, request.state.user.get("id"), body.value)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _enrich_project_payload(result, current_user_id=request.state.user.get("id"))


@app.post("/api/projects/by-db-id/{project_db_id}/smart-ziw")
def trigger_project_smart_ziw(project_db_id: str, body: SmartZiwTriggerRequest, request: Request):
    project = get_project_by_db_id(project_db_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not get_smart_ziw_config().get("smart_ziw_enabled", True):
        raise HTTPException(status_code=403, detail="Smart-Ziw Agent is disabled by the administrator.")

    with _smart_ziw_lock:
        if project_db_id in _smart_ziw_running and not body.force:
            current = get_project_by_db_id(project_db_id) or project
            return {
                "accepted": True,
                "alreadyRunning": True,
                "jobId": current.get("smart_ziw_job_id") or "",
                "project": _enrich_project_payload(current, current_user_id=request.state.user.get("id")),
            }
        _smart_ziw_running.add(project_db_id)

    job_id = str(uuid.uuid4())
    updated = update_project_smart_ziw_state_by_db_id(project_db_id, {
        "smart_ziw_status": "queued",
        "smart_ziw_job_id": job_id,
        "smart_ziw_requested_at": now_iso(),
        "smart_ziw_completed_at": "",
        "smart_ziw_requested_by": request.state.user.get("email", "") or request.state.user.get("name", ""),
        "smart_ziw_error": "",
    })
    threading.Thread(target=_run_smart_ziw, args=(project_db_id, request.state.user), daemon=True).start()
    return {
        "accepted": True,
        "alreadyRunning": False,
        "jobId": job_id,
        "project": _enrich_project_payload(updated or project, current_user_id=request.state.user.get("id")),
    }


@app.get("/api/admin/smart-ziw-config")
def admin_get_smart_ziw_config(request: Request):
    _require_admin(request)
    config = get_smart_ziw_config()
    llm_status = _compute_llm_status(config)
    config["gitlab_token"] = ""
    config["github_token"] = ""
    config["lightllm_api_key"] = ""
    config["lightllm_subscription_key"] = ""
    config["llm_status"] = llm_status
    return config


def _compute_llm_status(config: dict) -> dict:
    """Derived status of the effective LLM provider: which model is in use and
    whether the effective API key / base URL resolve (config value wins; the
    DeepSeek environment path falls back to .env vars). Mirrors the provider
    resolution in smart_ziw_llm.get_llm_call. Secrets are never exposed —
    only presence."""
    presets = {p["id"]: p for p in get_llm_provider_presets()}
    provider = str(config.get("smart_ziw_llm_provider") or "auto")
    if provider not in presets:
        provider = "auto"
    preset = presets[provider]

    base_url = str(config.get("lightllm_base_url") or "").strip()
    if provider == "deepseek" or (provider == "auto" and not base_url):
        api_key_set = bool(os.environ.get("DEEPSEEK_API_KEY"))
        return {
            "provider": provider,
            "provider_name": preset["name"],
            "model": os.environ.get("DEEPSEEK_MODEL") or os.environ.get("DEEPSEEK_WEB_MODEL") or "deepseek-chat",
            "configured": api_key_set,
            "missing_fields": [] if api_key_set else ["api_key"],
            "source": "environment",
        }

    missing: list[str] = []
    effective_base_url = base_url or str(preset.get("base_url") or "").strip()
    if provider in ("lightllm", "custom") and not effective_base_url:
        missing.append("base_url")
    if preset.get("requires_api_key") and not str(config.get("lightllm_api_key") or "").strip():
        missing.append("api_key")
    model = str(config.get("lightllm_model") or "").strip() or str(preset.get("default_model") or "default")
    return {
        "provider": provider,
        "provider_name": preset["name"],
        "model": model,
        "configured": not missing,
        "missing_fields": missing,
        "source": "config",
    }


@app.put("/api/admin/smart-ziw-config")
def admin_update_smart_ziw_config(body: SmartZiwConfigUpdate, request: Request):
    _require_admin(request)
    data = body.model_dump()
    existing = get_smart_ziw_config()
    if not data.get("gitlab_token"):
        data["gitlab_token"] = existing.get("gitlab_token", "")
    if not data.get("lightllm_api_key"):
        data["lightllm_api_key"] = existing.get("lightllm_api_key", "")
    if not data.get("lightllm_subscription_key"):
        data["lightllm_subscription_key"] = existing.get("lightllm_subscription_key", "")
    if not data.get("forvis_mazars_presence_countries"):
        data["forvis_mazars_presence_countries"] = existing.get("forvis_mazars_presence_countries", [])
    saved = save_smart_ziw_config(data)
    llm_status = _compute_llm_status(saved)
    saved["gitlab_token"] = ""
    saved["github_token"] = ""
    saved["lightllm_api_key"] = ""
    saved["lightllm_subscription_key"] = ""
    saved["llm_status"] = llm_status
    return saved


@app.post("/api/admin/llm-models")
def admin_discover_llm_models(body: LlmModelsRequest, request: Request):
    _require_admin(request)
    if body.preset_id:
        return discover_models_for_preset(body.preset_id, body.base_url, body.api_key, body.subscription_key)
    return discover_lightllm_models(body.provider, body.base_url, body.api_key, body.subscription_key)


@app.get("/api/admin/llm-providers")
def admin_list_llm_providers(request: Request):
    _require_admin(request)
    return get_llm_provider_presets()


_LLM_TEST_TIMEOUT_SECONDS = 20.0
_LLM_TEST_SYSTEM_PROMPT = "You are a connectivity check for the Smart-Ziw LLM provider configuration."
_LLM_TEST_USER_PROMPT = "Reply with exactly: OK"


@app.post("/api/admin/llm-test")
def admin_test_llm(body: SmartZiwConfigUpdate, request: Request):
    """Test the submitted LLM provider configuration with a real minimal call.

    Uses the same get_llm_call factory as the runtime Smart-Ziw agent, so
    the test exercises exactly what production will use (Environment,
    LightLLM OpenAI-compatible, or Anthropic-compatible). Nothing is
    persisted. Blank secrets resolve from the stored config like the
    PUT endpoint. The API key never appears in the response.
    """
    _require_admin(request)
    data = body.model_dump()
    existing = get_smart_ziw_config()
    if not data.get("lightllm_api_key"):
        data["lightllm_api_key"] = existing.get("lightllm_api_key", "")
    if not data.get("lightllm_subscription_key"):
        data["lightllm_subscription_key"] = existing.get("lightllm_subscription_key", "")
    call = get_llm_call(data, json_mode=False)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(call, _LLM_TEST_SYSTEM_PROMPT, _LLM_TEST_USER_PROMPT)
            reply = future.result(timeout=_LLM_TEST_TIMEOUT_SECONDS)
    except TimeoutError:
        return {"status": "error", "detail": f"The provider did not respond within {int(_LLM_TEST_TIMEOUT_SECONDS)} seconds"}
    except Exception as exc:
        detail = str(exc)[:300] or "The provider test failed"
        for key in (data.get("lightllm_api_key"), data.get("lightllm_subscription_key"), existing.get("lightllm_api_key"), existing.get("lightllm_subscription_key")):
            if key and key in detail:
                detail = detail.replace(key, "[redacted]")
        return {"status": "error", "detail": detail}
    if not reply or not str(reply).strip():
        return {"status": "error", "detail": "The provider returned an empty response"}
    return {"status": "ok", "message": "The LLM provider responded successfully."}


@app.get("/api/admin/llm-env-status")
def admin_llm_env_status(request: Request):
    _require_admin(request)
    model = os.environ.get("DEEPSEEK_MODEL") or os.environ.get("DEEPSEEK_WEB_MODEL") or "deepseek-chat"
    return {"model": model, "api_key_set": bool(os.environ.get("DEEPSEEK_API_KEY"))}


@app.get("/api/download")
def download_excel():
    projects = get_all_projects()
    if not projects:
        raise HTTPException(status_code=404, detail="No projects to download")
    _save_to_excel(projects)
    return FileResponse(path=str(PROJECTS_XLSX), filename="projects.xlsx", media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.post("/api/download")
def download_filtered_excel(body: dict):
    all_projects = get_all_projects()
    if not all_projects:
        raise HTTPException(status_code=404, detail="No projects to download")
    indices = body.get("indices", [])
    selected = [all_projects[i] for i in indices if 0 <= i < len(all_projects)] if indices else all_projects
    if not selected:
        raise HTTPException(status_code=404, detail="No matching projects")
    _save_to_excel(selected)
    return FileResponse(path=str(PROJECTS_XLSX), filename="projects.xlsx", media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/notifications")
def list_notifications(request: Request, limit: int = 50):
    notifications = list_notifications_for_user(request.state.user.get("id"), max(1, min(limit, 5000)))
    return {"notifications": notifications}


@app.post("/api/notifications/{notification_id}/read")
def read_notification(notification_id: str, request: Request):
    notification = mark_notification_read(request.state.user.get("id"), notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"notification": notification}


@app.post("/api/notifications/{notification_id}/view")
def view_notification(notification_id: str, request: Request):
    notification = mark_notification_viewed(request.state.user.get("id"), notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"notification": notification}


@app.post("/api/notifications/view-all")
def view_all_notifications(request: Request):
    updated = mark_all_notifications_viewed(request.state.user.get("id"))
    return {"updated": updated}


@app.post("/api/notifications/read-all")
def read_all_notifications(request: Request):
    updated = mark_all_notifications_read(request.state.user.get("id"))
    return {"updated": updated}


@app.get("/api/notifications/stream")
async def notification_stream(request: Request):
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    user_id = str(request.state.user.get("id") or "")
    with _notification_lock:
        _notification_queues.append((loop, queue, user_id))

    async def event_generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            with _notification_lock:
                for item in list(_notification_queues):
                    if item[1] is queue:
                        _notification_queues.remove(item)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# MCP server admin endpoints
# ---------------------------------------------------------------------------


def _slugify_mcp_name(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return base or str(uuid.uuid4())


def _redact_mcp_headers(server: dict) -> dict:
    """Return a copy of an MCP server config with header values replaced by ***."""
    out = dict(server)
    if out.get("headers"):
        out["headers"] = {key: "***" for key in out["headers"]}
    return out


def _merge_mcp_headers(existing: dict, incoming: dict) -> dict:
    """Preserve existing header values when the UI sends the redacted placeholder."""
    merged = dict(existing)
    for key, value in incoming.items():
        if value == "***" and key in merged:
            continue
        merged[key] = value
    return merged


def _normalize_mcp_server(body: dict, existing: dict | None = None) -> dict:
    """Build a full server dict from a request body, optionally merging with an existing entry."""
    existing = existing or {}
    server_id = body.get("id") or existing.get("id")
    if not server_id:
        server_id = _slugify_mcp_name(body.get("name")) or str(uuid.uuid4())

    def _field(key: str, default: Any = "") -> Any:
        if key in body:
            return body[key]
        return existing.get(key, default)

    transport = str(_field("transport") or existing.get("transport") or "sse")
    if transport not in ("sse", "http"):
        raise HTTPException(status_code=400, detail="Only SSE/HTTP MCP servers are supported")
    server = {
        "id": server_id,
        "name": _field("name") or existing.get("name") or server_id,
        "transport": transport,
        "url": _field("url"),
        "headers": _merge_mcp_headers(existing.get("headers") or {}, body.get("headers") or {}),
        "enabled": _field("enabled", True),
        "timeout": int(_field("timeout") or existing.get("timeout") or 30),
        "tools": list(_field("tools", [])),
    }
    # Built-in presets are pre-configured: url/transport are not user-editable.
    builtin = next((p for p in smart_ziw_mcp.BUILTIN_MCP_SERVERS if p["id"] == server_id), None)
    if builtin:
        server["url"] = builtin["url"]
        server["transport"] = builtin["transport"]
    return server


def _discover_mcp_tools(server: dict) -> dict:
    """Populate server["tools"] via a live connection test.

    Never blocks saving: a failed test is reported in the returned dict so
    the UI can warn while keeping the stored config — an API key can be
    valid and useful to the built-in tools even when the hosted MCP endpoint
    is temporarily unreachable (or blocked at the network level).
    """
    if server.get("tools"):
        return {"status": "skipped", "detail": None}
    # Brave is a native REST integration (LLM Context API), not a
    # discoverable MCP server: test it with a real API call; there are no
    # MCP tools to cache — the built-in brave_web_search tool uses the key
    # directly. Headers are raw here (create/update normalize them first).
    if server.get("id") == "brave-search":
        from smart_ziw_research import probe_brave_api

        key = str((server.get("headers") or {}).get("X-Subscription-Token") or "").strip()
        return probe_brave_api(key)
    result = asyncio.run(smart_ziw_mcp.test_mcp_server(server))
    if result.get("status") == "ok":
        server["tools"] = result.get("tools") or []
        return {"status": "ok", "detail": result.get("detail")}
    return {"status": "error", "detail": result.get("detail") or "Connection test failed"}


@app.get("/api/admin/smart-ziw-mcp-servers")
def admin_list_mcp_servers(request: Request):
    _require_admin(request)
    servers = smart_ziw_mcp.load_mcp_servers()
    return [_redact_mcp_headers(s) for s in servers]


@app.post("/api/admin/smart-ziw-mcp-servers/test")
def admin_test_mcp_server(body: McpServerConfig, request: Request):
    _require_admin(request)
    try:
        result = asyncio.run(smart_ziw_mcp.test_mcp_server(body.model_dump()))
    except Exception as exc:
        return {"status": "error", "tools": [], "detail": str(exc)}
    return result


@app.post("/api/admin/smart-ziw-mcp-servers")
def admin_create_mcp_server(body: McpServerConfig, request: Request):
    _require_admin(request)
    data = body.model_dump()
    db = get_db()
    servers = smart_ziw_mcp.load_mcp_servers()

    if data.get("id") and any(s.get("id") == data["id"] for s in servers):
        raise HTTPException(status_code=409, detail="MCP server id already exists")

    server = _normalize_mcp_server(data)
    try:
        test = _discover_mcp_tools(server)
        servers.append(server)
        smart_ziw_mcp.save_mcp_servers(db, servers)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Save failed: {exc}")
    return {"servers": [_redact_mcp_headers(s) for s in smart_ziw_mcp.load_mcp_servers()], "test": test}


@app.put("/api/admin/smart-ziw-mcp-servers/{server_id}")
def admin_update_mcp_server(server_id: str, body: McpServerConfig, request: Request):
    _require_admin(request)
    data = body.model_dump()
    db = get_db()
    servers = smart_ziw_mcp.load_mcp_servers()

    index = next((i for i, s in enumerate(servers) if s.get("id") == server_id), None)
    if index is None:
        raise HTTPException(status_code=404, detail="MCP server not found")

    existing = servers[index]
    server = _normalize_mcp_server(data, existing)

    try:
        test = _discover_mcp_tools(server)
        servers[index] = server
        smart_ziw_mcp.save_mcp_servers(db, servers)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Save failed: {exc}")
    return {"servers": [_redact_mcp_headers(s) for s in smart_ziw_mcp.load_mcp_servers()], "test": test}


@app.delete("/api/admin/smart-ziw-mcp-servers/{server_id}")
def admin_delete_mcp_server(server_id: str, request: Request):
    _require_admin(request)
    if any(p["id"] == server_id for p in smart_ziw_mcp.BUILTIN_MCP_SERVERS):
        raise HTTPException(status_code=400, detail="Built-in MCP servers cannot be deleted")
    db = get_db()
    servers = smart_ziw_mcp.load_mcp_servers()
    new_servers = [s for s in servers if s.get("id") != server_id]
    if len(new_servers) == len(servers):
        raise HTTPException(status_code=404, detail="MCP server not found")
    smart_ziw_mcp.save_mcp_servers(db, new_servers)
    return [_redact_mcp_headers(s) for s in smart_ziw_mcp.load_mcp_servers()]

