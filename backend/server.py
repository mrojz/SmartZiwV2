"""FastAPI backend for Procurement Watch with auth, users, and comments."""

from dotenv import load_dotenv
load_dotenv(override=False)

import asyncio
import json
import os
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
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, EmailStr, Field

from database import (
    get_all_projects,
    update_project_by_index,
    update_project_by_db_id,
    update_project_deadline_by_index,
    update_project_deadline_by_db_id,
    upsert_projects,
    delete_project_by_index,
    delete_project_by_db_id,
    delete_projects_by_db_ids,
    get_config as db_get_config,
    save_config as db_save_config,
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
    list_comments,
    create_comment,
)

BASE_DIR = Path(__file__).resolve().parent
PROJECTS_XLSX = BASE_DIR / "projects.xlsx"
DOWNLOADS_DIR = BASE_DIR / "downloads"
SYNC_SECRET = os.getenv("SYNC_SECRET", str(uuid.uuid4()))
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

# JWT config
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_urlsafe(64))
JWT_ALGORITHM = "HS256"
JWT_ACCESS_MINUTES = int(os.getenv("JWT_ACCESS_MINUTES", "60"))
JWT_REFRESH_DAYS = int(os.getenv("JWT_REFRESH_DAYS", "7"))

scheduler = BackgroundScheduler()
SCHEDULER_JOB_ID = "scheduled_sync"


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


def _configure_scheduler():
    schedule = db_get_schedule()
    if scheduler.get_job(SCHEDULER_JOB_ID):
        scheduler.remove_job(SCHEDULER_JOB_ID)
    if not schedule.get("enabled"):
        return
    hour = schedule.get("hour", 6)
    minute = schedule.get("minute", 0)
    frequency = schedule.get("frequency", "daily")
    if frequency == "weekly":
        trigger = CronTrigger(day_of_week=schedule.get("day_of_week", "mon"), hour=hour, minute=minute)
    else:
        trigger = CronTrigger(hour=hour, minute=minute)
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://frontend:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


_notification_queues: list[asyncio.Queue] = []
_notification_lock = threading.Lock()


def _broadcast_notification(event: dict):
    with _notification_lock:
        for q in _notification_queues:
            try:
                q.put_nowait(event)
            except Exception:
                pass


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


def _save_to_excel(projects: list[dict]):
    try:
        from shared_excel import save_to_excel
        save_to_excel(projects, filename=str(PROJECTS_XLSX))
    except Exception as e:
        print(f"[!] Excel save failed: {e}")


def _run_sync_subprocess(cmd: list[str], trigger: str = "manual"):
    started_at = datetime.now(timezone.utc).isoformat()
    all_log_lines = []
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
                sync_state.add_line(stripped)
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
        scraper_details = {}
        with sync_state.lock:
            for key, info in sync_state.scraper_logs.items():
                scraper_details[key] = {"label": info["label"], "output": info["output"].split("\n") if info["output"] else []}
        save_sync_log({
            "started_at": started_at,
            "finished_at": finished_at,
            "success": success,
            "project_count": project_count,
            "log_lines": all_log_lines,
            "trigger": trigger,
            "summary": sync_state.summary,
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


class SyncRequest(BaseModel):
    iadb: bool = False
    worldbank: bool = False
    globaltenders: bool = False
    giz: bool = False
    devaid: bool = False
    dgmarket: bool = False
    africagateway: bool = False
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


class DecisionUpdate(BaseModel):
    decision: str


class DeadlineUpdate(BaseModel):
    manualDeadline: str = ""


class BulkProjectDeleteRequest(BaseModel):
    projectDbIds: list[str] = Field(default_factory=list)


class CommentCreateRequest(BaseModel):
    entityType: str
    entityId: str
    body: str = Field(min_length=1, max_length=4000)
    attachments: list[dict] = []


# Auth endpoints
@app.post("/api/auth/login")
def login(body: LoginRequest):
    user = get_user_by_email(body.email)
    if not user or not _verify_password(body.password, user.get("passwordHash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("isActive", True):
        raise HTTPException(status_code=403, detail="User is deactivated")

    update_user(user["id"], {"lastLoginAt": now_iso()})
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
    return {"user": _sanitize_user(user)}


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
    if body.role not in ("admin", "user"):
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
    }
    create_user_doc(user)
    return {"user": _sanitize_user(user), "temporaryPassword": generated_password}


@app.put("/api/admin/users/{user_id}")
def admin_update_user(user_id: str, body: AdminUserUpdateRequest, request: Request):
    admin = _require_admin(request)
    if body.role not in ("admin", "user"):
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
        author = user_map.get(c.get("authorUserId"), {"id": c.get("authorUserId"), "name": "Unknown", "avatarUrl": ""})
        out.append({
            "id": c.get("id"),
            "entityType": c.get("entityType"),
            "entityId": c.get("entityId"),
            "authorUserId": c.get("authorUserId"),
            "authorName": author.get("name", "Unknown"),
            "authorAvatarUrl": author.get("avatarUrl", ""),
            "body": c.get("body"),
            "attachments": c.get("attachments", []),
            "createdAt": c.get("createdAt"),
            "updatedAt": c.get("updatedAt"),
        })
    return out


@app.post("/api/comments")
def post_comment(body: CommentCreateRequest, request: Request):
    text = body.body.strip()
    if not text and not body.attachments:
        raise HTTPException(status_code=400, detail="Comment body is required")
    comment = {
        "id": str(uuid.uuid4()),
        "entityType": body.entityType.strip(),
        "entityId": body.entityId.strip(),
        "authorUserId": request.state.user.get("id"),
        "body": text,
        "attachments": body.attachments or [],
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    create_comment(comment)
    comment.pop("_id", None)
    return {"comment": comment}


@app.post("/api/comments/upload")
async def upload_comment_file(file: UploadFile, request: Request):
    if file.size and file.size > 20 * 1024 * 1024:  # 20 MB limit
        raise HTTPException(status_code=400, detail="File too large (max 20 MB)")
    file_id = str(uuid.uuid4())
    dest_dir = UPLOADS_DIR / file_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename).name.replace("..", "").replace("/", "").replace("\\", "") if file.filename else "file"
    dest_path = dest_dir / safe_name
    contents = await file.read()
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
    return FileResponse(filepath, filename=safe_name)

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
def list_projects():
    return get_all_projects()


@app.delete("/api/projects/{index}")
def delete_project(index: int):
    result = delete_project_by_index(index)
    if result is None:
        raise HTTPException(status_code=404, detail="Project index out of range")
    _save_to_excel(get_all_projects())
    return {"deleted": True, "project": result}


@app.delete("/api/projects/by-db-id/{project_db_id}")
def delete_project_by_id(project_db_id: str):
    result = delete_project_by_db_id(project_db_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    _save_to_excel(get_all_projects())
    return {"deleted": True, "project": result}


@app.post("/api/projects/bulk-delete")
def bulk_delete_projects(body: BulkProjectDeleteRequest):
    result = delete_projects_by_db_ids(body.projectDbIds)
    if result["deleted_count"] == 0:
        return {"deleted": True, "count": 0, "deletedIds": []}
    _save_to_excel(get_all_projects())
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
    return schedule


@app.put("/api/schedule")
def update_schedule(body: ScheduleUpdate):
    schedule_data = body.model_dump()
    db_save_schedule(schedule_data)
    _configure_scheduler()
    job = scheduler.get_job(SCHEDULER_JOB_ID)
    next_run = job.next_run_time.isoformat() if job and job.next_run_time else None
    return {"status": "saved", "next_run": next_run}


@app.get("/api/schedule/logs")
def schedule_logs():
    return get_sync_logs(limit=5)


@app.get("/api/server-time")
def server_time():
    return {"server_time": datetime.now(timezone.utc).isoformat()}


@app.patch("/api/projects/{index}/decision")
def update_decision(index: int, body: DecisionUpdate):
    if body.decision not in ("Go", "No Go", ""):
        raise HTTPException(status_code=400, detail="Decision must be 'Go', 'No Go', or ''")
    result = update_project_by_index(index, body.decision)
    if result is None:
        raise HTTPException(status_code=404, detail="Project index out of range")
    _save_to_excel(get_all_projects())
    return result


@app.patch("/api/projects/by-db-id/{project_db_id}/decision")
def update_decision_by_id(project_db_id: str, body: DecisionUpdate):
    if body.decision not in ("Go", "No Go", ""):
        raise HTTPException(status_code=400, detail="Decision must be 'Go', 'No Go', or ''")
    result = update_project_by_db_id(project_db_id, body.decision)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    _save_to_excel(get_all_projects())
    return result


@app.patch("/api/projects/{index}/deadline")
def update_deadline(index: int, body: DeadlineUpdate, request: Request):
    user = _require_admin(request)
    result = update_project_deadline_by_index(index, body.manualDeadline, user)
    if result is None:
        raise HTTPException(status_code=404, detail="Project index out of range")
    _save_to_excel(get_all_projects())
    return result


@app.patch("/api/projects/by-db-id/{project_db_id}/deadline")
def update_deadline_by_id(project_db_id: str, body: DeadlineUpdate, request: Request):
    user = _require_admin(request)
    result = update_project_deadline_by_db_id(project_db_id, body.manualDeadline, user)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    _save_to_excel(get_all_projects())
    return result


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


@app.get("/api/notifications/stream")
async def notification_stream():
    queue: asyncio.Queue = asyncio.Queue()
    with _notification_lock:
        _notification_queues.append(queue)

    async def event_generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\\n\\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\\n\\n"
        finally:
            with _notification_lock:
                if queue in _notification_queues:
                    _notification_queues.remove(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})

