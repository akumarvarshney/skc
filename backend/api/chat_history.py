"""
Chat History API for SKC
Persists Q&A conversations per namespace to disk (JSON files).

Endpoints:
  GET    /history/{namespace}              — list conversations
  POST   /history/{namespace}              — save a conversation
  GET    /history/{namespace}/{conv_id}    — get a specific conversation
  DELETE /history/{namespace}/{conv_id}    — delete a conversation
  DELETE /history/{namespace}              — clear all history for namespace

Add to main.py:
  from api.chat_history import router as history_router
  app.include_router(history_router, prefix="/history", tags=["Chat History"])
"""

import os
import json
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Store history in a local folder next to main.py
HISTORY_DIR = Path(os.getenv("HISTORY_DIR", "./chat_history"))
HISTORY_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ns_dir(namespace: str) -> Path:
    """Return (and create) the directory for a namespace."""
    d = HISTORY_DIR / namespace
    d.mkdir(parents=True, exist_ok=True)
    return d


def _conv_path(namespace: str, conv_id: str) -> Path:
    return _ns_dir(namespace) / f"{conv_id}.json"


def _read_conv(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_conv(path: Path, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Message(BaseModel):
    role: str           # "user" | "assistant" | "system" | "system-error"
    text: str
    sources: list = []
    chunks_used: int = 0
    latency_ms: int = 0
    model: str = ""


class SaveConversationRequest(BaseModel):
    title: str = ""         # auto-generated from first user message if empty
    messages: list[Message]
    namespace: str = "default"


class ConversationMeta(BaseModel):
    id: str
    title: str
    namespace: str
    message_count: int
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/{namespace}", response_model=list[ConversationMeta])
def list_conversations(namespace: str):
    """List all saved conversations for a namespace, newest first."""
    ns_dir = _ns_dir(namespace)
    convs = []
    for f in sorted(ns_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = _read_conv(f)
            convs.append(ConversationMeta(
                id=data["id"],
                title=data["title"],
                namespace=data["namespace"],
                message_count=len(data["messages"]),
                created_at=data["created_at"],
                updated_at=data["updated_at"],
            ))
        except Exception as e:
            logger.warning(f"Skipping corrupt history file {f}: {e}")
    return convs


@router.post("/{namespace}", status_code=201)
def save_conversation(namespace: str, req: SaveConversationRequest):
    """Save or update a conversation. Returns the conversation id."""
    conv_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Auto-generate title from first user message
    title = req.title
    if not title:
        for msg in req.messages:
            if msg.role == "user":
                title = msg.text[:60] + ("…" if len(msg.text) > 60 else "")
                break
    if not title:
        title = f"Conversation {now[:10]}"

    data = {
        "id": conv_id,
        "title": title,
        "namespace": namespace,
        "messages": [m.dict() for m in req.messages],
        "created_at": now,
        "updated_at": now,
    }
    _write_conv(_conv_path(namespace, conv_id), data)
    logger.info(f"Saved conversation {conv_id} in namespace {namespace}")
    return {"id": conv_id, "title": title}


@router.get("/{namespace}/{conv_id}")
def get_conversation(namespace: str, conv_id: str):
    """Get a full conversation with all messages."""
    path = _conv_path(namespace, conv_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return _read_conv(path)


@router.delete("/{namespace}/{conv_id}")
def delete_conversation(namespace: str, conv_id: str):
    """Delete a single conversation."""
    path = _conv_path(namespace, conv_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Conversation not found.")
    path.unlink()
    return {"message": "Deleted", "id": conv_id}


@router.delete("/{namespace}")
def clear_namespace_history(namespace: str):
    """Delete all conversations for a namespace."""
    ns_dir = _ns_dir(namespace)
    count = 0
    for f in ns_dir.glob("*.json"):
        f.unlink()
        count += 1
    return {"message": f"Deleted {count} conversations.", "namespace": namespace}