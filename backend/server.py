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
from smart_ziw_llm import discover_lightllm_models, get_llm_call
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
    user_map = users or _active_users_by_id()
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
            f"Recommendation: {result.get('research_verdict', 'MONITOR')}",
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
_SMART_ZIW_MENTION_TOKEN = "@smartziw"
_SMART_ZIW_REPLY_MAX_CHARS = 2000


def _run_smart_ziw(project_db_id: str, actor_user: dict):
    try:
        config = get_smart_ziw_config()
        project = update_project_smart_ziw_state_by_db_id(project_db_id, {
            "smart_ziw_status": "running",
            "smart_ziw_error": "",
        })
        if not project:
            return
        result = run_smart_ziw_agent(project, config)
        comment_body = _format_smart_ziw_comment(result)
        _create_project_comment_and_notify(
            entity_type="project",
            entity_id=_project_entity_id(project),
            project=project,
            author_user=SMART_ZIW_BOT_USER,
            body_text=comment_body,
        )
        enrichment_error = result.get("error")
        push_error = None
        if config.get("gitlab_push_enabled") and not result.get("gitlab_pushed"):
            push_error = result.get("gitlab_message") or "GitLab push failed"
        error = enrichment_error or push_error
        update_project_smart_ziw_state_by_db_id(project_db_id, {
            "smart_ziw_status": "error" if error else "completed",
            "smart_ziw_completed_at": now_iso(),
            "smart_ziw_error": (str(error)[:1000] if error else ""),
            "smart_ziw_folder": result.get("folder", ""),
            "smart_ziw_gitlab_pushed": bool(result.get("gitlab_pushed")),
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


def _build_smart_ziw_chat_prompt(project: dict, comment: dict, thread_comments: list[dict]) -> str:
    body = re.sub(_SMART_ZIW_MENTION_TOKEN, "", str(comment.get("body") or ""), flags=re.IGNORECASE).strip()
    lines = [
        f"Project name: {project.get('project_name') or ''}",
        f"Buyer: {project.get('project_sponsor') or ''}",
        f"Country: {project.get('primary_country_name_en') or ''}",
        f"Deadline: {project.get('project_end_date') or project.get('effective_deadline') or ''}",
        f"Description: {project.get('project_description') or ''}",
        f"Source URL: {project.get('project_url') or ''}",
        f"Smart-Ziw status: {project.get('smart_ziw_status') or 'never run'}",
        f"Smart-Ziw folder: {project.get('smart_ziw_folder') or 'none'}",
        "",
        "Previous comments (oldest first):",
    ]
    previous = [c for c in thread_comments if c.get("id") != comment.get("id")][-10:]
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


def _answer_smart_ziw_mention(project_db_id: str, project: dict, requester: dict, comment: dict) -> None:
    try:
        config = get_smart_ziw_config()
        call = get_llm_call(config, json_mode=False)
        prompt = _build_smart_ziw_chat_prompt(
            project,
            comment,
            list_comments(comment.get("entityType"), comment.get("entityId")),
        )
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


def _maybe_start_smart_ziw_chat(comment: dict, project: dict | None, requester: dict | None) -> None:
    if not project or not requester:
        return
    if comment.get("entityType") != "project":
        return
    if _SMART_ZIW_MENTION_TOKEN not in str(comment.get("body") or "").lower():
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
    threading.Thread(target=_answer_smart_ziw_mention, args=(project_db_id, project, requester, comment), daemon=True).start()


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
    gitlab_url: str = ""
    gitlab_token: str = ""
    gitlab_project_path: str = ""
    gitlab_branch: str = "main"
    gitlab_author_name: str = "Smart-Ziw Agent"
    gitlab_author_email: str = "smart-ziw@localhost"
    firecrawl_api_key: str = ""
    firecrawl_base_url: str = "https://api.firecrawl.dev"
    smart_ziw_research_enabled: bool = True
    smart_ziw_research_timeout_seconds: int = 900
    smart_ziw_llm_provider: str = "auto"
    lightllm_base_url: str = ""
    lightllm_api_key: str = ""
    lightllm_model: str = "default"
    lightllm_provider: str = "openai_compatible"
    llm_temperature: float = 0.1
    llm_max_tokens: int = 4000


class LlmModelsRequest(BaseModel):
    provider: str = "openai_compatible"
    base_url: str = ""
    api_key: str = ""


class SavedSearchItem(BaseModel):
    id: str
    name: str
    filters: dict = Field(default_factory=dict)
    createdAt: str | None = None
    updatedAt: str | None = None


class SavedSearchesUpdate(BaseModel):
    searches: list[SavedSearchItem] = Field(default_factory=list)


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

# Existing endpoints
@app.get("/api/auth/bootstrap-status")
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
    config["gitlab_token"] = ""
    config["firecrawl_api_key"] = ""
    config["lightllm_api_key"] = ""
    return config


@app.put("/api/admin/smart-ziw-config")
def admin_update_smart_ziw_config(body: SmartZiwConfigUpdate, request: Request):
    _require_admin(request)
    data = body.model_dump()
    existing = get_smart_ziw_config()
    if not data.get("gitlab_token"):
        data["gitlab_token"] = existing.get("gitlab_token", "")
    if not data.get("firecrawl_api_key"):
        data["firecrawl_api_key"] = existing.get("firecrawl_api_key", "")
    if not data.get("lightllm_api_key"):
        data["lightllm_api_key"] = existing.get("lightllm_api_key", "")
    saved = save_smart_ziw_config(data)
    saved["gitlab_token"] = ""
    saved["firecrawl_api_key"] = ""
    saved["lightllm_api_key"] = ""
    return saved


@app.post("/api/admin/llm-models")
def admin_discover_llm_models(body: LlmModelsRequest, request: Request):
    _require_admin(request)
    return discover_lightllm_models(body.provider, body.base_url, body.api_key)


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
    call = get_llm_call(data, json_mode=False)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(call, _LLM_TEST_SYSTEM_PROMPT, _LLM_TEST_USER_PROMPT)
            reply = future.result(timeout=_LLM_TEST_TIMEOUT_SECONDS)
    except TimeoutError:
        return {"status": "error", "detail": f"The provider did not respond within {int(_LLM_TEST_TIMEOUT_SECONDS)} seconds"}
    except Exception as exc:
        detail = str(exc)[:300] or "The provider test failed"
        for key in (data.get("lightllm_api_key"), existing.get("lightllm_api_key")):
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

