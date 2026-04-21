"""
Google Drive connector API endpoints — OAuth flow + sync.
"""
import logging
import secrets
from typing import Optional
from urllib.parse import urlencode

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from connectors.gdrive import fetch_drive_content, refresh_access_token
from core.config import get_settings
from core.vector_store import vector_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/connectors/gdrive", tags=["gdrive"])
settings = get_settings()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
SCOPES = "https://www.googleapis.com/auth/drive.readonly"
REDIRECT_URI = "http://localhost:8000/connectors/gdrive/callback"

# In-memory session store (use DB/Redis in production)
_oauth_states: dict[str, dict] = {}      # state -> {namespace, folder_id}
_credentials: dict[str, dict] = {}        # session_id -> {access_token, refresh_token}
_scheduler: Optional[AsyncIOScheduler] = None
_sync_configs: dict[str, dict] = {}


# ── Pydantic models ────────────────────────────────────────────────────────────

class GDriveSyncRequest(BaseModel):
    refresh_token: str
    folder_id: Optional[str] = None
    namespace: str = "default"


# ── OAuth flow ─────────────────────────────────────────────────────────────────

@router.get("/auth")
async def gdrive_auth(namespace: str = "default", folder_id: Optional[str] = None):
    """Step 1 — redirect user to Google OAuth consent screen."""
    state = secrets.token_urlsafe(16)
    _oauth_states[state] = {"namespace": namespace, "folder_id": folder_id}

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
    return RedirectResponse(url)


@router.get("/callback")
async def gdrive_callback(code: str, state: str):
    """Step 2 — Google redirects here with auth code. Exchange for tokens."""
    import httpx

    state_data = _oauth_states.pop(state, {})
    namespace = state_data.get("namespace", "default")
    folder_id = state_data.get("folder_id")

    async with httpx.AsyncClient() as client:
        r = await client.post("https://oauth2.googleapis.com/token", data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        })
        r.raise_for_status()
        tokens = r.json()

    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")

    if not refresh_token:
        raise HTTPException(status_code=400, detail="No refresh token received. Try revoking access and re-authorizing.")

    # Store tokens
    session_id = secrets.token_urlsafe(16)
    _credentials[session_id] = {
        "refresh_token": refresh_token,
        "access_token": access_token,
        "namespace": namespace,
        "folder_id": folder_id,
    }

    # Redirect to frontend with session info
    return RedirectResponse(
        f"http://localhost:5173?gdrive_connected=true&session_id={session_id}&namespace={namespace}"
    )


@router.get("/status")
async def gdrive_status(session_id: str):
    """Check if a session is connected."""
    if session_id in _credentials:
        return {"connected": True, "session_id": session_id}
    return {"connected": False}


# ── Sync ───────────────────────────────────────────────────────────────────────

async def _do_sync(refresh_token: str, folder_id: Optional[str],
                   namespace: str, client_id: str, client_secret: str):
    logger.info("Google Drive sync started")
    try:
        access_token = await refresh_access_token(client_id, client_secret, refresh_token)
        chunks = await fetch_drive_content(access_token, folder_id=folder_id)
        if not chunks:
            logger.warning("Google Drive sync: no chunks returned")
            return 0

        source_id = f"gdrive_{refresh_token[:8]}_{folder_id or 'all'}"
        try:
            vector_store.delete_source(source_id, namespace=namespace)
        except Exception:
            pass

        count = vector_store.upsert_chunks(chunks, source_id=source_id, namespace=namespace)
        logger.info(f"Google Drive sync complete: {count} chunks upserted")
        return count
    except Exception as e:
        logger.error(f"Google Drive sync failed: {e}")
        raise


@router.post("/sync")
async def sync_gdrive(req: GDriveSyncRequest, background_tasks: BackgroundTasks):
    """Trigger a manual sync."""
    background_tasks.add_task(
        _do_sync,
        req.refresh_token, req.folder_id, req.namespace,
        settings.google_client_id, settings.google_client_secret,
    )
    return {"status": "sync_started", "message": "Google Drive sync running in background"}


@router.post("/sync/session/{session_id}")
async def sync_from_session(session_id: str, background_tasks: BackgroundTasks):
    """Sync using a stored OAuth session."""
    creds = _credentials.get(session_id)
    if not creds:
        raise HTTPException(status_code=404, detail="Session not found. Please reconnect.")

    background_tasks.add_task(
        _do_sync,
        creds["refresh_token"], creds.get("folder_id"),
        creds.get("namespace", "default"),
        settings.google_client_id, settings.google_client_secret,
    )
    return {"status": "sync_started", "message": "Google Drive sync running in background"}


@router.post("/sync/schedule/{session_id}")
async def schedule_gdrive_sync(session_id: str):
    """Schedule hourly auto-sync for a session."""
    global _scheduler
    creds = _credentials.get(session_id)
    if not creds:
        raise HTTPException(status_code=404, detail="Session not found. Please reconnect.")

    if _scheduler is None:
        _scheduler = AsyncIOScheduler()
        _scheduler.start()

    job_id = f"gdrive_{session_id}"
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)

    _scheduler.add_job(
        _do_sync,
        trigger=IntervalTrigger(hours=1),
        args=[
            creds["refresh_token"], creds.get("folder_id"),
            creds.get("namespace", "default"),
            settings.google_client_id, settings.google_client_secret,
        ],
        id=job_id,
        replace_existing=True,
    )
    _sync_configs[job_id] = {"session_id": session_id}

    # Run immediately
    await _do_sync(
        creds["refresh_token"], creds.get("folder_id"),
        creds.get("namespace", "default"),
        settings.google_client_id, settings.google_client_secret,
    )

    return {"status": "scheduled", "job_id": job_id, "message": "Google Drive will sync every hour."}


@router.get("/sync/schedules")
async def list_gdrive_schedules():
    global _scheduler
    jobs = []
    if _scheduler:
        for job in _scheduler.get_jobs():
            if job.id.startswith("gdrive_"):
                jobs.append({
                    "job_id": job.id,
                    "next_run": str(job.next_run_time),
                })
    return {"schedules": jobs}


@router.delete("/sync/schedule/{job_id}")
async def unschedule_gdrive(job_id: str):
    global _scheduler
    if _scheduler and _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)
        _sync_configs.pop(job_id, None)
        return {"status": "unscheduled"}
    raise HTTPException(status_code=404, detail="Job not found")