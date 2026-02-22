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
        target=_run_sync_subprocess, args=(cmd, "scheduled"), daemon=True
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
        self.lines: list[str] = []          # summary-only lines for SSE
        self.finished = False
        self.success = False
        self.project_count_before = 0
        self.summary: dict = {}             # parsed JSON summary from main.py
        self.scraper_logs: dict = {}        # per-scraper full output logs
        self.lock = threading.Lock()

    def reset(self):
        with self.lock:
            self.running = True
            self.lines = []
            self.finished = False
            self.success = False
            self.summary = {}
            self.scraper_logs = {}
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


def _run_sync_subprocess(cmd: list[str], trigger: str = "manual"):
    """Run the scraper subprocess, stream output, and save a log entry.

    Parses structured output from main.py:
    - Regular lines → streamed to SSE (summary-only status lines)
    - __SUMMARY__{json}__END__ → parsed and stored
    - __SCRAPER_LOG__{json}__END__ → parsed and stored per-scraper
    """
    started_at = datetime.now(timezone.utc).isoformat()
    all_log_lines = []      # full raw output for master log
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
            if not stripped:
                continue

            all_log_lines.append(stripped)

            # Parse tagged structured data from main.py
            if stripped.startswith("__SUMMARY__") and stripped.endswith("__END__"):
                json_str = stripped[len("__SUMMARY__"):-len("__END__")]
                try:
                    sync_state.summary = json.loads(json_str)
                except json.JSONDecodeError:
                    pass
            elif stripped.startswith("__SCRAPER_LOG__") and stripped.endswith("__END__"):
                json_str = stripped[len("__SCRAPER_LOG__"):-len("__END__")]
                try:
                    log_data = json.loads(json_str)
                    key = log_data.get("key", "unknown")
                    with sync_state.lock:
                        sync_state.scraper_logs[key] = {
                            "label": log_data.get("label", key),
                            "output": log_data.get("output", ""),
                        }
                except json.JSONDecodeError:
                    pass
            else:
                # Regular status line → stream to SSE
                sync_state.add_line(stripped)

        proc.wait()
        success = proc.returncode == 0
        sync_state.finish(success=success)
    except Exception as e:
        msg = f"[!] Error: {e}"
        sync_state.add_line(msg)
        all_log_lines.append(msg)
        sync_state.finish(success=False)
    finally:
        finished_at = datetime.now(timezone.utc).isoformat()
        project_count = len(get_all_projects())

        # Build per-scraper log entries for storage
        scraper_details = {}
        with sync_state.lock:
            for key, log_info in sync_state.scraper_logs.items():
                scraper_details[key] = {
                    "label": log_info["label"],
                    "output": log_info["output"].split("\n") if log_info["output"] else [],
                }

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
                done_data = {
                    'type': 'done',
                    'success': success,
                    'project_count': len(projects),
                }
                # Include parsed summary if available
                if sync_state.summary:
                    done_data['summary'] = sync_state.summary
                yield f"data: {json.dumps(done_data)}\n\n"
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
            "summary": sync_state.summary,
        }


@app.get("/api/schedule/logs/{index}/scrapers")
def get_scraper_logs(index: int):
    """Get per-scraper logs for a specific run."""
    logs = list(db.sync_logs.find({}, {"_id": 0}).sort("started_at", -1))
    if index < 0 or index >= len(logs):
        raise HTTPException(status_code=404, detail="Log not found")
    log = logs[index]
    return log.get("scraper_logs", {})


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


# ── GET/POST /api/download ───────────────────────────────────────────────────

@app.get("/api/download")
def download_excel():
    """Download ALL projects as Excel (fallback)."""
    projects = get_all_projects()
    if not projects:
        raise HTTPException(status_code=404, detail="No projects to download")
    _save_to_excel(projects)

    return FileResponse(
        path=str(PROJECTS_XLSX),
        filename="projects.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.post("/api/download")
def download_filtered_excel(body: dict):
    """Download only the filtered projects as Excel.

    Body: { "indices": [0, 2, 5, ...] }  — indices into the full project list.
    """
    all_projects = get_all_projects()
    if not all_projects:
        raise HTTPException(status_code=404, detail="No projects to download")

    indices = body.get("indices", [])
    if indices:
        selected = [all_projects[i] for i in indices if 0 <= i < len(all_projects)]
    else:
        selected = all_projects

    if not selected:
        raise HTTPException(status_code=404, detail="No matching projects")

    _save_to_excel(selected)

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
