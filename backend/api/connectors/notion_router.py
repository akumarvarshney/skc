"""
Notion connector API endpoints.
"""
import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from connectors.notion import fetch_notion_content, notion_source_id
from core.vector_store import vector_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/connectors/notion", tags=["notion"])

# In-memory store for active sync configs (use DB in production)
_sync_configs: dict[str, dict] = {}
_scheduler: AsyncIOScheduler | None = None


# ── Pydantic models ────────────────────────────────────────────────────────────

class NotionSyncRequest(BaseModel):
    api_key: str
    page_ids: Optional[list[str]] = None   # None = sync all accessible pages
    namespace: str = "default"


class NotionWebhookPayload(BaseModel):
    type: str
    entity: Optional[dict] = None


# ── Helper ─────────────────────────────────────────────────────────────────────

async def _do_sync(api_key: str, page_ids: list[str] | None, namespace: str):
    logger.info("Notion sync started")
    try:
        chunks = await fetch_notion_content(api_key, page_ids)
        if not chunks:
            logger.warning("Notion sync: no chunks returned")
            return 0

        source_id = notion_source_id(api_key, page_ids)
        # Remove old vectors for this source before upserting fresh ones
        try:
            vector_store.delete_source(source_id, namespace=namespace)
        except Exception:
            pass

        count = vector_store.upsert_chunks(chunks, source_id=source_id, namespace=namespace)
        logger.info(f"Notion sync complete: {count} chunks upserted")
        return count
    except Exception as e:
        logger.error(f"Notion sync failed: {e}")
        raise


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/sync")
async def sync_notion(req: NotionSyncRequest, background_tasks: BackgroundTasks):
    """Trigger a manual sync of Notion content."""
    background_tasks.add_task(_do_sync, req.api_key, req.page_ids, req.namespace)
    return {"status": "sync_started", "message": "Notion sync running in background"}


@router.post("/sync/schedule")
async def schedule_notion_sync(req: NotionSyncRequest):
    """Schedule hourly auto-sync for Notion."""
    global _scheduler

    if _scheduler is None:
        _scheduler = AsyncIOScheduler()
        _scheduler.start()

    job_id = f"notion_{notion_source_id(req.api_key, req.page_ids)}"

    # Remove existing job if re-scheduling
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)

    _scheduler.add_job(
        _do_sync,
        trigger=IntervalTrigger(hours=1),
        args=[req.api_key, req.page_ids, req.namespace],
        id=job_id,
        replace_existing=True,
    )

    # Store config for reference
    _sync_configs[job_id] = req.model_dump()

    # Run immediately on first schedule
    await _do_sync(req.api_key, req.page_ids, req.namespace)

    return {
        "status": "scheduled",
        "job_id": job_id,
        "message": "Notion will sync every hour. Initial sync complete.",
    }


@router.delete("/sync/schedule/{job_id}")
async def unschedule_notion_sync(job_id: str):
    """Remove a scheduled Notion sync."""
    global _scheduler
    if _scheduler and _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)
        _sync_configs.pop(job_id, None)
        return {"status": "unscheduled", "job_id": job_id}
    raise HTTPException(status_code=404, detail="Job not found")


@router.get("/sync/schedules")
async def list_schedules():
    """List all active Notion sync schedules."""
    global _scheduler
    jobs = []
    if _scheduler:
        for job in _scheduler.get_jobs():
            if job.id.startswith("notion_"):
                jobs.append({
                    "job_id": job.id,
                    "next_run": str(job.next_run_time),
                    "config": _sync_configs.get(job.id, {}),
                })
    return {"schedules": jobs}


@router.post("/webhook")
async def notion_webhook(request: Request):
    """
    Webhook endpoint — Notion calls this when a page changes.
    Notion webhooks send a verification challenge on first setup.
    """
    body = await request.json()

    # Notion webhook verification challenge
    if "challenge" in body:
        return {"challenge": body["challenge"]}

    event_type = body.get("type", "")
    entity = body.get("entity", {})
    page_id = entity.get("id")

    logger.info(f"Notion webhook received: type={event_type}, page_id={page_id}")

    # Find matching scheduled sync and re-sync that page
    if page_id and _sync_configs:
        for job_id, config in _sync_configs.items():
            api_key = config.get("api_key")
            namespace = config.get("namespace", "default")
            if api_key:
                # Re-sync just this one page
                import asyncio
                asyncio.create_task(_do_sync(api_key, [page_id], namespace))
                break

    return {"status": "received"}


@router.get("/pages")
async def list_notion_pages(api_key: str):
    """List all pages accessible by this Notion integration key."""
    import httpx
    from connectors.notion import NOTION_API_BASE, NOTION_VERSION, _search_all_pages, _page_title

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": NOTION_VERSION,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            pages = await _search_all_pages(client, api_key)
        return {
            "pages": [
                {"id": p["id"], "title": _page_title(p), "url": p.get("url", "")}
                for p in pages
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))