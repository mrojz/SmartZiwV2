"""
FastAPI backend for Procurement Watch.

Endpoints:
  GET    /api/projects                  → list all projects
  DELETE /api/projects/{index}          → delete a project
  PATCH  /api/projects/{index}/decision → update a project's Go/No Go decision
  POST   /api/sync/start               → internal-only: start scraper (requires secret)
  POST   /api/sync/manual              → user-facing: start scraper from UI
  GET    /api/sync/stream              → SSE stream of scraper progress
  GET    /api/sync/status              → check sync state
  GET    /api/config                   → get keywords + regions config
  PUT    /api/config                   → update config
  GET    /api/schedule                 → get sync schedule config
  PUT    /api/schedule                 → update sync schedule config
  GET    /api/download                 → download projects.xlsx
  GET    /api/notifications/stream     → SSE: real-time new-project alerts
"""

import asyncio
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from database import get_all_projects, update_project_by_index, upsert_projects
from database import delete_project_by_index
from database import get_config as db_get_config
from database import save_config as db_save_config
from database import get_schedule as db_get_schedule
from database import save_schedule as db_save_schedule
from database import save_sync_log, get_sync_logs

BASE_DIR = Path(__file__).resolve().parent
PROJECTS_XLSX = BASE_DIR / "projects.xlsx"

# Internal sync secret — set via env var or auto-generated
SYNC_SECRET = os.getenv("SYNC_SECRET", str(uuid.uuid4()))

# ── Scheduler ────────────────────────────────────────────────────────────────

scheduler = BackgroundScheduler()
SCHEDULER_JOB_ID = "scheduled_sync"


def _scheduled_sync_job():
    """Called by APScheduler — runs sync with the saved source config.
    Captures output and saves it to the sync_logs collection."""
    if sync_state.running:
        print("[scheduler] Sync already running, skipping scheduled run.")
        return

    schedule = db_get_schedule()
    sources = schedule.get("sources", {})

    cmd = [sys.executable, "-u", str(BASE_DIR / "main.py")]
    for src_name, enabled in sources.items():
        if enabled:
            flag = f"--{src_name.replace('_', '-')}"
            cmd.append(flag)

    if schedule.get("no_ai"):
        cmd.append("--no-ai")
    if schedule.get("include_expired"):
        cmd.append("--include-expired")

    print(f"[scheduler] Starting scheduled sync: {' '.join(cmd)}")
    sync_state.reset()
    thread = threading.Thread(
        target=_run_scheduled_sync_subprocess, args=(cmd,), daemon=True
    )
    thread.start()


def _configure_scheduler():
    """Load schedule from DB and configure the APScheduler job."""
    schedule = db_get_schedule()

    # Remove existing job if any
    if scheduler.get_job(SCHEDULER_JOB_ID):
        scheduler.remove_job(SCHEDULER_JOB_ID)

    if not schedule.get("enabled"):
        print("[scheduler] Scheduled sync is disabled.")
        return

    hour = schedule.get("hour", 6)
    minute = schedule.get("minute", 0)
    frequency = schedule.get("frequency", "daily")

    if frequency == "weekly":
        day_of_week = schedule.get("day_of_week", "mon")
        trigger = CronTrigger(day_of_week=day_of_week, hour=hour, minute=minute)
        print(f"[scheduler] Configured weekly sync: {day_of_week} at {hour:02d}:{minute:02d}")
    else:
        trigger = CronTrigger(hour=hour, minute=minute)
        print(f"[scheduler] Configured daily sync at {hour:02d}:{minute:02d}")

    scheduler.add_job(
        _scheduled_sync_job,
        trigger=trigger,
        id=SCHEDULER_JOB_ID,
        replace_existing=True,
    )


# ── App lifespan ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    _configure_scheduler()
    scheduler.start()
    print(f"[startup] Scheduler started. Sync secret: {SYNC_SECRET[:8]}...")
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Procurement Watch API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://frontend:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Notification broadcast ───────────────────────────────────────────────────

# All connected SSE clients register an asyncio.Queue here
_notification_queues: list[asyncio.Queue] = []
_notification_lock = threading.Lock()


def _broadcast_notification(event: dict):
    """Push event to all connected notification listeners."""
    with _notification_lock:
        for q in _notification_queues:
            try:
                q.put_nowait(event)
            except Exception:
                pass


# ── Sync state ───────────────────────────────────────────────────────────────

class SyncState:
    """Tracks background sync progress."""
    def __init__(self):
        self.running = False
        self.lines: list[str] = []
        self.finished = False
        self.success = False
        self.project_count_before = 0
        self.lock = threading.Lock()

    def reset(self):
        with self.lock:
            self.running = True
            self.lines = []
            self.finished = False
            self.success = False
            # Snapshot current count before sync
            self.project_count_before = len(get_all_projects())

    def add_line(self, line: str):
        with self.lock:
            self.lines.append(line)

    def finish(self, success: bool):
        with self.lock:
            self.running = False
            self.finished = True
            self.success = success
        # Check for new projects and broadcast
        if success:
            current_count = len(get_all_projects())
            new_count = current_count - self.project_count_before
            if new_count > 0:
                _broadcast_notification({
                    "type": "new_projects",
                    "count": new_count,
                    "total": current_count,
                    "timestamp": time.time(),
                })

sync_state = SyncState()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _save_to_excel(projects: list[dict]):
    """Generate Excel file from current projects (for download)."""
    try:
        from shared_excel import save_to_excel
        save_to_excel(projects, filename=str(PROJECTS_XLSX))
    except Exception as e:
        print(f"[!] Excel save failed: {e}")


def _run_sync_subprocess(cmd: list[str]):
    """Run the scraper subprocess and stream output line by line."""
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(BASE_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        for line in iter(proc.stdout.readline, ""):
            stripped = line.rstrip()
            if stripped:
                sync_state.add_line(stripped)
        proc.wait()
        sync_state.finish(success=proc.returncode == 0)
    except Exception as e:
        sync_state.add_line(f"[!] Error: {e}")
        sync_state.finish(success=False)


def _run_scheduled_sync_subprocess(cmd: list[str]):
    """Run the scraper for a scheduled sync — captures output and saves a log entry."""
    started_at = datetime.now(timezone.utc).isoformat()
    log_lines = []
    success = False
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(BASE_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        for line in iter(proc.stdout.readline, ""):
            stripped = line.rstrip()
            if stripped:
                sync_state.add_line(stripped)
                log_lines.append(stripped)
        proc.wait()
        success = proc.returncode == 0
        sync_state.finish(success=success)
    except Exception as e:
        msg = f"[!] Error: {e}"
        sync_state.add_line(msg)
        log_lines.append(msg)
        sync_state.finish(success=False)
    finally:
        finished_at = datetime.now(timezone.utc).isoformat()
        project_count = len(get_all_projects())
        save_sync_log({
            "started_at": started_at,
            "finished_at": finished_at,
            "success": success,
            "project_count": project_count,
            "log_lines": log_lines,
            "trigger": "scheduled",
        })


def _start_sync_with_flags(req_dict: dict):
    """Build the sync command from a dict of flags and start it."""
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
        "no_ai": "--no-ai",
        "include_expired": "--include-expired",
    }

    for key, flag in flag_map.items():
        if req_dict.get(key):
            cmd.append(flag)

    sync_state.reset()
    thread = threading.Thread(target=_run_sync_subprocess, args=(cmd,), daemon=True)
    thread.start()
    return True


# ── GET /api/projects ────────────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    return get_all_projects()


# ── DELETE /api/projects/{index} ─────────────────────────────────────────────

@app.delete("/api/projects/{index}")
def delete_project(index: int):
    result = delete_project_by_index(index)
    if result is None:
        raise HTTPException(status_code=404, detail="Project index out of range")
    # Update Excel export
    _save_to_excel(get_all_projects())
    return {"deleted": True, "project": result}


# ── Config endpoints ─────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    return db_get_config()


class ConfigUpdate(BaseModel):
    keywords: list[str] = []
    regions: dict[str, list[str]] = {}


@app.put("/api/config")
def update_config(body: ConfigUpdate):
    db_save_config(body.keywords, body.regions)
    return {"status": "saved", "keywords": len(body.keywords), "regions": len(body.regions)}


# ── POST /api/sync/start (INTERNAL ONLY — requires secret) ─────────────────

class SyncRequest(BaseModel):
    iadb: bool = False
    worldbank: bool = False
    globaltenders: bool = False
    giz: bool = False
    devaid: bool = False
    dgmarket: bool = False
    no_ai: bool = False
    include_expired: bool = False


@app.post("/api/sync/start")
def start_sync(req: SyncRequest, request: Request):
    """Internal-only sync endpoint — requires X-Sync-Secret header."""
    secret = request.headers.get("X-Sync-Secret", "")
    if secret != SYNC_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden: invalid sync secret")

    if not _start_sync_with_flags(req.model_dump()):
        raise HTTPException(status_code=409, detail="Sync already running")

    return {"status": "started"}


# ── POST /api/sync/manual (USER-FACING) ─────────────────────────────────────

@app.post("/api/sync/manual")
def start_sync_manual(req: SyncRequest):
    """User-facing sync endpoint — no secret required."""
    if not _start_sync_with_flags(req.model_dump()):
        raise HTTPException(status_code=409, detail="Sync already running")

    return {"status": "started"}


# ── GET /api/sync/stream ────────────────────────────────────────────────────

@app.get("/api/sync/stream")
async def stream_sync():
    """SSE endpoint — streams sync output lines as they appear."""

    async def event_generator():
        sent = 0
        while True:
            with sync_state.lock:
                new_lines = sync_state.lines[sent:]
                finished = sync_state.finished
                success = sync_state.success

            for line in new_lines:
                yield f"data: {json.dumps({'type': 'log', 'message': line})}\n\n"
                sent += 1

            if finished:
                projects = get_all_projects()
                yield f"data: {json.dumps({'type': 'done', 'success': success, 'project_count': len(projects)})}\n\n"
                break

            await asyncio.sleep(0.3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/sync/status")
def sync_status():
    with sync_state.lock:
        return {
            "running": sync_state.running,
            "finished": sync_state.finished,
            "success": sync_state.success,
            "line_count": len(sync_state.lines),
        }


# ── Schedule endpoints ──────────────────────────────────────────────────────

class ScheduleUpdate(BaseModel):
    enabled: bool = False
    frequency: str = "daily"      # "daily" or "weekly"
    day_of_week: str = "mon"      # mon, tue, wed, thu, fri, sat, sun
    hour: int = 6
    minute: int = 0
    sources: dict = {}
    no_ai: bool = False
    include_expired: bool = False


@app.get("/api/schedule")
def get_schedule():
    schedule = db_get_schedule()
    # Include next run time if job is active
    job = scheduler.get_job(SCHEDULER_JOB_ID)
    if job and job.next_run_time:
        schedule["next_run"] = job.next_run_time.isoformat()
    else:
        schedule["next_run"] = None
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
    """Return the most recent scheduled sync run logs."""
    return get_sync_logs(limit=20)


@app.get("/api/server-time")
def server_time():
    """Return the current server time in ISO format."""
    return {"server_time": datetime.now(timezone.utc).isoformat()}


# ── PATCH /api/projects/{index}/decision ─────────────────────────────────────

class DecisionUpdate(BaseModel):
    decision: str  # "Go", "No Go", or ""


@app.patch("/api/projects/{index}/decision")
def update_decision(index: int, body: DecisionUpdate):
    if body.decision not in ("Go", "No Go", ""):
        raise HTTPException(status_code=400, detail="Decision must be 'Go', 'No Go', or ''")

    result = update_project_by_index(index, body.decision)
    if result is None:
        raise HTTPException(status_code=404, detail="Project index out of range")

    # Also update Excel export
    _save_to_excel(get_all_projects())

    return {"index": index, "decision": body.decision}


# ── GET /api/download ────────────────────────────────────────────────────────

@app.get("/api/download")
def download_excel():
    """Download the current projects.xlsx file."""
    projects = get_all_projects()
    if not projects:
        raise HTTPException(status_code=404, detail="No projects to download")
    _save_to_excel(projects)

    return FileResponse(
        path=str(PROJECTS_XLSX),
        filename="projects.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

# ── GET /api/notifications/stream ────────────────────────────────────────────

@app.get("/api/notifications/stream")
async def notification_stream():
    """SSE endpoint for real-time notifications (new projects, etc.).
    All connected clients receive the same events."""
    queue: asyncio.Queue = asyncio.Queue()

    with _notification_lock:
        _notification_queues.append(queue)

    async def event_generator():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield f": keepalive\n\n"
        finally:
            with _notification_lock:
                _notification_queues.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
