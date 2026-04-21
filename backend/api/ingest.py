"""
Ingestion API
POST /ingest/upload  — upload + index a document
GET  /ingest/sources — list all indexed sources
DELETE /ingest/sources/{source_id} — remove a source
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from core.chunker import chunk_document
from core.vector_store import vector_store
from core.registry import registry
from core.config import get_settings
import tempfile, os, hashlib, logging, time
from pathlib import Path

router = APIRouter(prefix="/ingest", tags=["Ingestion"])
logger = logging.getLogger(__name__)
settings = get_settings()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
MAX_BYTES = settings.max_file_size_mb * 1024 * 1024


@router.post("/upload")
async def upload_document(file: UploadFile = File(...), namespace: str = "default"):
    """
    Upload and index a document into the knowledge base.
    Supported: PDF, DOCX, TXT (max 20MB)
    """
    # ── Validate ──────────────────────────────────────────────────────────
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max size: {settings.max_file_size_mb}MB"
        )

    # ── Generate stable source ID from content hash ───────────────────────
    source_id = hashlib.sha256(content).hexdigest()[:16]

    if registry.get(source_id):
        return JSONResponse({
            "message": "Document already indexed.",
            "source_id": source_id,
            "skipped": True,
        })

    # ── Save to temp file ─────────────────────────────────────────────────
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        start = time.time()

        # ── Chunk ─────────────────────────────────────────────────────────
        chunks = chunk_document(
            filepath=tmp_path,
            source_id=source_id,
            source_name=file.filename,
            source_type="file_upload",
        )

        if not chunks:
            raise HTTPException(status_code=422, detail="Could not extract text from document.")

        # ── Embed + Store ─────────────────────────────────────────────────
        chunk_count = vector_store.upsert_chunks(chunks, source_id=source_id, namespace=namespace)

        # ── Register ──────────────────────────────────────────────────────
        registry.add(
            source_id=source_id,
            name=file.filename,
            file_type=ext.lstrip("."),
            chunk_count=chunk_count,
            size_bytes=len(content),
        )

        elapsed = round(time.time() - start, 2)
        logger.info(f"Indexed '{file.filename}' in {elapsed}s — {chunk_count} chunks")

        return {
            "message": "Document indexed successfully.",
            "source_id": source_id,
            "filename": file.filename,
            "chunks_created": chunk_count,
            "processing_time_seconds": elapsed,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Indexing failed for '{file.filename}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")
    finally:
        os.unlink(tmp_path)


@router.get("/sources")
def list_sources():
    """List all indexed documents."""
    sources = registry.list_all()
    return {
        "total": len(sources),
        "sources": sources,
    }


@router.delete("/sources/{source_id}")
def delete_source(source_id: str):
    """Remove a document from the knowledge base."""
    if not registry.get(source_id):
        raise HTTPException(status_code=404, detail="Source not found.")

    vector_store.delete_source(source_id)
    registry.remove(source_id)

    return {"message": "Source deleted successfully.", "source_id": source_id}
