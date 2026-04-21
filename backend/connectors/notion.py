"""
Notion Connector — fetches pages/databases from Notion and indexes them.
"""
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

NOTION_API_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"


def _headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


# ── Block → plain text ────────────────────────────────────────────────────────

def _rich_text(rt_list: list) -> str:
    return "".join(rt.get("plain_text", "") for rt in rt_list)


def _block_to_text(block: dict) -> str:
    btype = block.get("type", "")
    data = block.get(btype, {})
    rt = data.get("rich_text", [])
    text = _rich_text(rt).strip()

    prefix_map = {
        "heading_1": "# ", "heading_2": "## ", "heading_3": "### ",
        "bulleted_list_item": "• ", "numbered_list_item": "1. ",
        "to_do": "☐ ", "toggle": "▶ ", "quote": "> ", "callout": "💡 ",
    }
    prefix = prefix_map.get(btype, "")

    # Code block
    if btype == "code":
        lang = data.get("language", "")
        return f"```{lang}\n{text}\n```"

    # Table row
    if btype == "table_row":
        cells = [_rich_text(cell) for cell in data.get("cells", [])]
        return " | ".join(cells)

    return f"{prefix}{text}" if text else ""


async def _fetch_blocks(client: httpx.AsyncClient, block_id: str,
                        api_key: str, depth: int = 0) -> list[str]:
    if depth > 3:
        return []
    lines: list[str] = []
    cursor = None
    while True:
        params = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        r = await client.get(
            f"{NOTION_API_BASE}/blocks/{block_id}/children",
            headers=_headers(api_key), params=params,
        )
        r.raise_for_status()
        data = r.json()
        for block in data.get("results", []):
            line = _block_to_text(block)
            if line:
                lines.append(line)
            if block.get("has_children"):
                child_lines = await _fetch_blocks(
                    client, block["id"], api_key, depth + 1
                )
                lines.extend(f"  {l}" for l in child_lines)
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return lines


# ── Page metadata ─────────────────────────────────────────────────────────────

def _page_title(page: dict) -> str:
    props = page.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            return _rich_text(prop["title"]).strip()
    return page.get("id", "Untitled")


def _page_last_edited(page: dict) -> str:
    return page.get("last_edited_time", "")


# ── Search all accessible pages ───────────────────────────────────────────────

async def _search_all_pages(client: httpx.AsyncClient,
                             api_key: str) -> list[dict]:
    pages: list[dict] = []
    cursor = None
    while True:
        body: dict[str, Any] = {"page_size": 100, "filter": {"value": "page", "property": "object"}}
        if cursor:
            body["start_cursor"] = cursor
        r = await client.post(
            f"{NOTION_API_BASE}/search", headers=_headers(api_key), json=body
        )
        r.raise_for_status()
        data = r.json()
        pages.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return pages


async def _search_databases(client: httpx.AsyncClient,
                             api_key: str) -> list[dict]:
    dbs: list[dict] = []
    cursor = None
    while True:
        body: dict[str, Any] = {"page_size": 100, "filter": {"value": "database", "property": "object"}}
        if cursor:
            body["start_cursor"] = cursor
        r = await client.post(
            f"{NOTION_API_BASE}/search", headers=_headers(api_key), json=body
        )
        r.raise_for_status()
        data = r.json()
        dbs.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return dbs


async def _query_database_pages(client: httpx.AsyncClient,
                                 db_id: str, api_key: str) -> list[dict]:
    pages: list[dict] = []
    cursor = None
    while True:
        body: dict[str, Any] = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        r = await client.post(
            f"{NOTION_API_BASE}/databases/{db_id}/query",
            headers=_headers(api_key), json=body,
        )
        r.raise_for_status()
        data = r.json()
        pages.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return pages


# ── Main fetch function ───────────────────────────────────────────────────────

async def fetch_notion_content(
    api_key: str,
    page_ids: list[str] | None = None,
) -> list[dict]:
    """
    Returns a list of chunks ready for vector_store.upsert_chunks().
    Each chunk: { "text": str, "metadata": dict }

    If page_ids is None, fetches ALL pages the integration can access.
    """
    chunks: list[dict] = []

    async with httpx.AsyncClient(timeout=30) as client:
        # Determine which pages to fetch
        if page_ids:
            pages_to_fetch = []
            for pid in page_ids:
                r = await client.get(
                    f"{NOTION_API_BASE}/pages/{pid}",
                    headers=_headers(api_key),
                )
                if r.status_code == 200:
                    pages_to_fetch.append(r.json())
        else:
            pages_to_fetch = await _search_all_pages(client, api_key)
            # Also get pages inside databases
            dbs = await _search_databases(client, api_key)
            for db in dbs:
                db_pages = await _query_database_pages(client, db["id"], api_key)
                pages_to_fetch.extend(db_pages)

        logger.info(f"Notion: found {len(pages_to_fetch)} pages to index")

        for page in pages_to_fetch:
            page_id = page["id"]
            title = _page_title(page)
            last_edited = _page_last_edited(page)
            page_url = page.get("url", "")

            try:
                lines = await _fetch_blocks(client, page_id, api_key)
            except Exception as e:
                logger.warning(f"Notion: failed to fetch blocks for {page_id}: {e}")
                continue

            full_text = f"{title}\n\n" + "\n".join(lines)
            full_text = full_text.strip()
            if not full_text:
                continue

            # Split into chunks of ~800 chars with 100 char overlap
            chunk_size = 800
            overlap = 100
            text_chunks = []
            start = 0
            while start < len(full_text):
                end = start + chunk_size
                text_chunks.append(full_text[start:end])
                start = end - overlap
                if start >= len(full_text):
                    break

            for i, chunk_text in enumerate(text_chunks):
                chunks.append({
                    "text": chunk_text,
                    "metadata": {
                        "source_name": title,
                        "source_type": "notion",
                        "page_id": page_id,
                        "page_url": page_url,
                        "last_edited": last_edited,
                        "chunk_index": i,
                    }
                })

    logger.info(f"Notion: produced {len(chunks)} chunks total")
    return chunks


def notion_source_id(api_key: str, page_ids: list[str] | None) -> str:
    key = f"notion_{api_key[:8]}_{sorted(page_ids or [])}"
    return hashlib.md5(key.encode()).hexdigest()