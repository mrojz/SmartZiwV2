"""
FastAPI backend for Procurement Watch.

Endpoints:
  GET    /api/projects                  → list all projects
  PATCH  /api/projects/{index}/decision → update a project's Go/No Go decision
  POST   /api/sync/start               → start scraper subprocess
  GET    /api/sync/stream              → SSE stream of scraper progress
  GET    /api/sync/status              → check sync state
  GET    /api/config                   → get keywords + regions config
  PUT    /api/config                   → update config
  GET    /api/download                 → download projects.xlsx
  GET    /api/notifications/stream     → SSE: real-time new-project alerts
"""

import asyncio
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from database import get_all_projects, update_project_by_index, upsert_projects
from database import get_config as db_get_config
from database import save_config as db_save_config

BASE_DIR = Path(__file__).resolve().parent
PROJECTS_XLSX = BASE_DIR / "projects.xlsx"

app = FastAPI(title="Procurement Watch API")

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


# ── GET /api/projects ────────────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    return get_all_projects()


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


# ── POST /api/sync/start ────────────────────────────────────────────────────

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
def start_sync(req: SyncRequest):
    """Start a background sync and return immediately."""
    if sync_state.running:
        raise HTTPException(status_code=409, detail="Sync already running")

    cmd = [sys.executable, "-u", str(BASE_DIR / "main.py")]

    if req.iadb:
        cmd.append("--iadb")
    if req.worldbank:
        cmd.append("--worldbank")
    if req.globaltenders:
        cmd.append("--globaltenders")
    if req.giz:
        cmd.append("--giz")
    if req.devaid:
        cmd.append("--devaid")
    if req.dgmarket:
        cmd.append("--dgmarket")
    if req.no_ai:
        cmd.append("--no-ai")
    if req.include_expired:
        cmd.append("--include-expired")

    sync_state.reset()
    thread = threading.Thread(target=_run_sync_subprocess, args=(cmd,), daemon=True)
    thread.start()

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
