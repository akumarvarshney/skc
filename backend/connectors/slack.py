"""
Slack Connector for SKC
Indexes messages from selected channels into Pinecone.
Pattern mirrors: backend/connectors/notion.py and gdrive.py
"""

import os
import time
import logging
from datetime import datetime, timedelta
from typing import Optional
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Low-level Slack helpers
# ---------------------------------------------------------------------------

def get_slack_client(token: str) -> WebClient:
    return WebClient(token=token)


def list_channels(token: str) -> list[dict]:
    """Return all public channels the bot has access to."""
    client = get_slack_client(token)
    channels = []
    cursor = None
    try:
        while True:
            kwargs = {"types": "public_channel,private_channel", "limit": 200}
            if cursor:
                kwargs["cursor"] = cursor
            resp = client.conversations_list(**kwargs)
            channels.extend(resp["channels"])
            cursor = resp.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break
    except SlackApiError as e:
        logger.error(f"Slack list_channels error: {e.response['error']}")
        raise
    return [{"id": c["id"], "name": c["name"], "is_private": c.get("is_private", False)} for c in channels]


def fetch_messages(token: str, channel_id: str, days_back: int = 30) -> list[dict]:
    """Fetch messages from a channel going back `days_back` days."""
    client = get_slack_client(token)
    oldest = str((datetime.utcnow() - timedelta(days=days_back)).timestamp())
    messages = []
    cursor = None
    try:
        while True:
            kwargs = {"channel": channel_id, "oldest": oldest, "limit": 200}
            if cursor:
                kwargs["cursor"] = cursor
            resp = client.conversations_history(**kwargs)
            messages.extend(resp["messages"])
            cursor = resp.get("response_metadata", {}).get("next_cursor")
            if not cursor or not resp.get("has_more"):
                break
    except SlackApiError as e:
        logger.error(f"Slack fetch_messages error: {e.response['error']}")
        raise
    return messages


def resolve_user_name(client: WebClient, user_id: str, cache: dict) -> str:
    if user_id in cache:
        return cache[user_id]
    try:
        resp = client.users_info(user=user_id)
        name = resp["user"].get("real_name") or resp["user"].get("name", user_id)
    except Exception:
        name = user_id
    cache[user_id] = name
    return name


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------

def index_slack_channel(
    token: str,
    channel_id: str,
    channel_name: str,
    embed_fn,          # callable(text: str) -> list[float]
    upsert_fn,         # callable(vectors: list[dict]) -> None
    days_back: int = 30,
    batch_size: int = 50,
) -> int:
    """
    Fetch messages from a channel, embed them, and upsert into Pinecone.
    Returns the number of vectors indexed.
    """
    client = get_slack_client(token)
    user_cache: dict = {}
    messages = fetch_messages(token, channel_id, days_back)

    # Filter: skip bot messages, join/leave events, empty text
    messages = [
        m for m in messages
        if m.get("type") == "message"
        and not m.get("subtype")          # skip channel_join, bot_message, etc.
        and m.get("text", "").strip()
    ]

    if not messages:
        logger.info(f"No indexable messages in #{channel_name}")
        return 0

    vectors = []
    for msg in messages:
        text = msg.get("text", "").strip()
        if not text:
            continue

        user_id = msg.get("user", "unknown")
        user_name = resolve_user_name(client, user_id, user_cache)
        ts = msg.get("ts", "0")
        # Convert Slack ts (epoch.microseconds) to ISO
        try:
            dt = datetime.utcfromtimestamp(float(ts)).isoformat() + "Z"
        except Exception:
            dt = ts

        # Prefix with author for richer semantic context
        full_text = f"[#{channel_name}] {user_name}: {text}"

        try:
            embedding = embed_fn(full_text)
        except Exception as e:
            logger.warning(f"Embedding failed for message ts={ts}: {e}")
            continue

        vector_id = f"slack-{channel_id}-{ts}"
        vectors.append({
            "id": vector_id,
            "values": embedding,
            "metadata": {
                "source": "slack",
                "channel_id": channel_id,
                "channel_name": channel_name,
                "user_id": user_id,
                "user_name": user_name,
                "timestamp": dt,
                "text": full_text[:1000],   # Pinecone metadata limit
            },
        })

    # Upsert in batches
    total = 0
    for i in range(0, len(vectors), batch_size):
        batch = vectors[i : i + batch_size]
        upsert_fn(batch)
        total += len(batch)
        logger.info(f"Upserted batch {i // batch_size + 1} ({len(batch)} vectors) for #{channel_name}")

    return total


# ---------------------------------------------------------------------------
# OAuth helpers (Bot Token flow — simpler than user OAuth)
# ---------------------------------------------------------------------------

def exchange_code_for_token(code: str, redirect_uri: str) -> dict:
    """Exchange an OAuth code for a bot token using slack_sdk."""
    import requests
    client_id = os.getenv("SLACK_CLIENT_ID")
    client_secret = os.getenv("SLACK_CLIENT_SECRET")
    resp = requests.post(
        "https://slack.com/api/oauth.v2.access",
        data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
        },
    )
    data = resp.json()
    if not data.get("ok"):
        raise ValueError(f"Slack OAuth error: {data.get('error')}")
    return data   # contains access_token, team, authed_user, etc.