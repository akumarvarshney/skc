"""
Slack connector router for SKC.
Mount in main.py:
    from api.connectors.slack_router import router as slack_router
    app.include_router(slack_router, prefix="/connectors/slack", tags=["Slack"])

All endpoints mirror the pattern used in notion_router.py / gdrive_router.py.
"""

import os
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from connectors.slack import (
    list_channels,
    index_slack_channel,
    exchange_code_for_token,
)
from core.config import get_settings
settings = get_settings()

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory state (replace with DB/Redis for production)
# ---------------------------------------------------------------------------
_state: dict = {
    "connected": False,
    "bot_token": None,
    "team_name": None,
    "team_id": None,
    "selected_channels": [],   # list of {id, name}
    "last_sync": None,
    "indexed_count": 0,
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_token() -> str:
    # Prefer env var (for simple deployments); fall back to OAuth flow result
    token = _state.get("bot_token") or os.getenv("SLACK_BOT_TOKEN")
    if not token:
        raise HTTPException(status_code=400, detail="Slack not connected. Provide SLACK_BOT_TOKEN or complete OAuth.")
    return token


def _embed(text: str) -> list:
    from core.vector_store import vector_store
    return vector_store._embed([text])[0]


def _upsert(vectors: list):
    from core.vector_store import vector_store
    vector_store._init()
    vector_store._index.upsert(vectors=vectors)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

@router.get("/status")
def slack_status():
    token = _state.get("bot_token") or os.getenv("SLACK_BOT_TOKEN")
    connected = bool(token)
    return {
        "connected": connected,
        "team_name": _state.get("team_name"),
        "team_id": _state.get("team_id"),
        "selected_channels": _state.get("selected_channels", []),
        "last_sync": _state.get("last_sync"),
        "indexed_count": _state.get("indexed_count", 0),
    }


# ---------------------------------------------------------------------------
# OAuth (optional — skip if using a static Bot Token from .env)
# ---------------------------------------------------------------------------

@router.get("/oauth/url")
def slack_oauth_url():
    client_id = os.getenv("SLACK_CLIENT_ID")
    redirect_uri = os.getenv("SLACK_REDIRECT_URI", "http://localhost:8000/connectors/slack/oauth/callback")
    if not client_id:
        raise HTTPException(status_code=500, detail="SLACK_CLIENT_ID not set in .env")
    scopes = "channels:history,channels:read,groups:history,groups:read,users:read"
    url = (
        f"https://slack.com/oauth/v2/authorize"
        f"?client_id={client_id}"
        f"&scope={scopes}"
        f"&redirect_uri={redirect_uri}"
    )
    return {"url": url}


@router.get("/oauth/callback")
def slack_oauth_callback(code: str):
    redirect_uri = os.getenv("SLACK_REDIRECT_URI", "http://localhost:8000/connectors/slack/oauth/callback")
    try:
        data = exchange_code_for_token(code, redirect_uri)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _state["bot_token"] = data["access_token"]
    _state["team_name"] = data.get("team", {}).get("name")
    _state["team_id"] = data.get("team", {}).get("id")
    _state["connected"] = True
    return {"message": "Slack connected successfully", "team": _state["team_name"]}


# ---------------------------------------------------------------------------
# Simple token connect (for dev — just paste the Bot Token)
# ---------------------------------------------------------------------------

class TokenConnectRequest(BaseModel):
    bot_token: str

@router.post("/connect")
def slack_connect(req: TokenConnectRequest):
    """Connect using a Bot Token directly (easier for local dev)."""
    try:
        from slack_sdk import WebClient
        client = WebClient(token=req.bot_token)
        auth = client.auth_test()
        _state["bot_token"] = req.bot_token
        _state["team_name"] = auth.get("team")
        _state["team_id"] = auth.get("team_id")
        _state["connected"] = True
        return {"message": "Connected", "team": auth.get("team"), "bot": auth.get("user")}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/disconnect")
def slack_disconnect():
    _state["bot_token"] = None
    _state["team_name"] = None
    _state["team_id"] = None
    _state["connected"] = False
    _state["selected_channels"] = []
    _state["last_sync"] = None
    _state["indexed_count"] = 0
    return {"message": "Disconnected"}


# ---------------------------------------------------------------------------
# Channel management
# ---------------------------------------------------------------------------

@router.get("/channels")
def slack_list_channels():
    token = _get_token()
    try:
        channels = list_channels(token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"channels": channels}


class SelectChannelsRequest(BaseModel):
    channel_ids: list[str]

@router.post("/channels/select")
def slack_select_channels(req: SelectChannelsRequest):
    token = _get_token()
    try:
        all_channels = list_channels(token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    id_to_channel = {c["id"]: c for c in all_channels}
    selected = []
    for cid in req.channel_ids:
        if cid in id_to_channel:
            selected.append({"id": cid, "name": id_to_channel[cid]["name"]})
    _state["selected_channels"] = selected
    return {"message": f"{len(selected)} channels selected", "channels": selected}


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

class SyncRequest(BaseModel):
    days_back: int = 30

def _run_sync(days_back: int):
    token = _get_token()
    total = 0
    for ch in _state.get("selected_channels", []):
        try:
            count = index_slack_channel(
                token=token,
                channel_id=ch["id"],
                channel_name=ch["name"],
                embed_fn=_embed,
                upsert_fn=_upsert,
                days_back=days_back,
            )
            total += count
            logger.info(f"Indexed {count} messages from #{ch['name']}")
        except Exception as e:
            logger.error(f"Failed to index #{ch['name']}: {e}")
    _state["last_sync"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
    _state["indexed_count"] = _state.get("indexed_count", 0) + total
    logger.info(f"Slack sync complete. Total vectors upserted: {total}")


@router.post("/sync")
def slack_sync(req: SyncRequest, background_tasks: BackgroundTasks):
    if not _state.get("selected_channels"):
        raise HTTPException(status_code=400, detail="No channels selected. Select channels first.")
    background_tasks.add_task(_run_sync, req.days_back)
    return {"message": f"Sync started for {len(_state['selected_channels'])} channel(s)"}