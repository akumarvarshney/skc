"""
Google Drive Connector — fetches files from Google Drive and indexes them.
"""
import io
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_API = "https://www.googleapis.com/drive/v3"
DOCS_EXPORT = "https://docs.google.com/document/d/{id}/export?format=txt"
SHEETS_EXPORT = "https://docs.google.com/spreadsheets/d/{id}/export?format=csv"


# ── Token helpers ─────────────────────────────────────────────────────────────

async def refresh_access_token(client_id: str, client_secret: str,
                                refresh_token: str) -> str:
    async with httpx.AsyncClient() as client:
        r = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        })
        r.raise_for_status()
        return r.json()["access_token"]


def _auth_headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


# ── File listing ──────────────────────────────────────────────────────────────

SUPPORTED_MIME_TYPES = [
    "application/vnd.google-apps.document",       # Google Docs
    "application/vnd.google-apps.spreadsheet",    # Google Sheets
    "application/pdf",                             # PDFs
    "text/plain",                                  # TXT
]

MIME_QUERY = " or ".join(
    f"mimeType='{m}'" for m in SUPPORTED_MIME_TYPES
)


async def list_drive_files(access_token: str,
                            folder_id: str | None = None) -> list[dict]:
    files: list[dict] = []
    page_token = None
    q = f"({MIME_QUERY}) and trashed=false"
    if folder_id:
        q += f" and '{folder_id}' in parents"

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params: dict[str, Any] = {
                "q": q,
                "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)",
                "pageSize": 100,
            }
            if page_token:
                params["pageToken"] = page_token
            r = await client.get(
                f"{DRIVE_API}/files",
                headers=_auth_headers(access_token),
                params=params,
            )
            r.raise_for_status()
            data = r.json()
            files.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
    return files


# ── File content extraction ───────────────────────────────────────────────────

async def _export_google_doc(client: httpx.AsyncClient,
                              file_id: str, access_token: str) -> str:
    r = await client.get(
        DOCS_EXPORT.format(id=file_id),
        headers=_auth_headers(access_token),
        follow_redirects=True,
    )
    r.raise_for_status()
    return r.text


async def _export_google_sheet(client: httpx.AsyncClient,
                                file_id: str, access_token: str) -> str:
    r = await client.get(
        SHEETS_EXPORT.format(id=file_id),
        headers=_auth_headers(access_token),
        follow_redirects=True,
    )
    r.raise_for_status()
    # Convert CSV to readable text
    lines = r.text.strip().split("\n")
    return "\n".join(lines[:200])  # cap at 200 rows


async def _download_file(client: httpx.AsyncClient,
                          file_id: str, access_token: str) -> bytes:
    r = await client.get(
        f"{DRIVE_API}/files/{file_id}?alt=media",
        headers=_auth_headers(access_token),
        follow_redirects=True,
    )
    r.raise_for_status()
    return r.content


async def extract_file_text(client: httpx.AsyncClient, file: dict,
                             access_token: str) -> str:
    mime = file["mimeType"]
    file_id = file["id"]

    try:
        if mime == "application/vnd.google-apps.document":
            return await _export_google_doc(client, file_id, access_token)

        elif mime == "application/vnd.google-apps.spreadsheet":
            return await _export_google_sheet(client, file_id, access_token)

        elif mime == "text/plain":
            raw = await _download_file(client, file_id, access_token)
            return raw.decode("utf-8", errors="ignore")

        elif mime == "application/pdf":
            raw = await _download_file(client, file_id, access_token)
            # Basic PDF text extraction using pypdf if available
            try:
                import pypdf, io as _io
                reader = pypdf.PdfReader(_io.BytesIO(raw))
                return "\n".join(
                    page.extract_text() or "" for page in reader.pages
                )
            except ImportError:
                logger.warning("pypdf not installed, skipping PDF text extraction")
                return ""
    except Exception as e:
        logger.warning(f"Failed to extract text from {file['name']}: {e}")
        return ""

    return ""


# ── Chunking ──────────────────────────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap
        if start >= len(text):
            break
    return chunks


# ── Main fetch function ───────────────────────────────────────────────────────

async def fetch_drive_content(
    access_token: str,
    folder_id: str | None = None,
    file_ids: list[str] | None = None,
) -> list[dict]:
    """
    Returns list of chunks: { "text": str, "metadata": dict }
    """
    chunks: list[dict] = []

    async with httpx.AsyncClient(timeout=60) as client:
        if file_ids:
            files = []
            for fid in file_ids:
                r = await client.get(
                    f"{DRIVE_API}/files/{fid}",
                    headers=_auth_headers(access_token),
                    params={"fields": "id,name,mimeType,modifiedTime,webViewLink"},
                )
                if r.status_code == 200:
                    files.append(r.json())
        else:
            files = await list_drive_files(access_token, folder_id)

        logger.info(f"Google Drive: found {len(files)} files to index")

        for file in files:
            text = await extract_file_text(client, file, access_token)
            text = text.strip()
            if not text:
                continue

            full_text = f"{file['name']}\n\n{text}"
            text_chunks = chunk_text(full_text)

            for i, chunk in enumerate(text_chunks):
                chunks.append({
                    "text": chunk,
                    "metadata": {
                        "source_name": file["name"],
                        "source_type": "google_drive",
                        "file_id": file["id"],
                        "mime_type": file["mimeType"],
                        "modified_time": file.get("modifiedTime", ""),
                        "web_url": file.get("webViewLink", ""),
                        "chunk_index": i,
                    }
                })

    logger.info(f"Google Drive: produced {len(chunks)} chunks total")
    return chunks