"""
Document Chunker
Supports: PDF, DOCX, TXT
Splits documents into overlapping chunks with rich metadata.
"""
import re
import logging
from pathlib import Path
from typing import List, Dict, Any
from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _clean_text(text: str) -> str:
    """Remove junk characters and normalize whitespace."""
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'[^\x20-\x7E\n]', '', text)
    return text.strip()


def _split_into_chunks(text: str, chunk_size: int, overlap: int) -> List[str]:
    """Split text into overlapping chunks by word boundaries."""
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = ' '.join(words[start:end])
        if chunk.strip():
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


# ── Extractors ────────────────────────────────────────────────────────────────

def _extract_pdf(filepath: str) -> List[Dict[str, Any]]:
    """Extract text per page from a PDF."""
    from pypdf import PdfReader
    reader = PdfReader(filepath)
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        cleaned = _clean_text(text)
        if cleaned:
            pages.append({"text": cleaned, "page": i + 1})
    return pages


def _extract_docx(filepath: str) -> List[Dict[str, Any]]:
    """Extract paragraphs from a DOCX file."""
    from docx import Document
    doc = Document(filepath)
    full_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    cleaned = _clean_text(full_text)
    return [{"text": cleaned, "page": None}]


def _extract_txt(filepath: str) -> List[Dict[str, Any]]:
    """Read raw text file."""
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        text = _clean_text(f.read())
    return [{"text": text, "page": None}]


# ── Main chunker ──────────────────────────────────────────────────────────────

def chunk_document(
    filepath: str,
    source_id: str,
    source_name: str,
    source_type: str = "file",
) -> List[Dict[str, Any]]:
    """
    Parse a document and return a list of chunks ready for embedding.
    Each chunk: {"text": str, "metadata": {...}}
    """
    ext = Path(filepath).suffix.lower()

    if ext == ".pdf":
        pages = _extract_pdf(filepath)
    elif ext in (".docx", ".doc"):
        pages = _extract_docx(filepath)
    elif ext == ".txt":
        pages = _extract_txt(filepath)
    else:
        raise ValueError(f"Unsupported file type: {ext}. Supported: PDF, DOCX, TXT")

    if not pages:
        raise ValueError("Document appears to be empty or unreadable.")

    chunks = []
    for page_data in pages:
        text_chunks = _split_into_chunks(
            page_data["text"],
            chunk_size=settings.chunk_size,
            overlap=settings.chunk_overlap,
        )
        for chunk_text in text_chunks:
            if len(chunk_text.split()) < 10:  # skip tiny chunks
                continue
            chunks.append({
                "text": chunk_text,
                "metadata": {
                    "source_id": source_id,
                    "source_name": source_name,
                    "source_type": source_type,
                    "page": page_data.get("page"),
                    "file_extension": ext,
                },
            })

    logger.info(f"Chunked '{source_name}' into {len(chunks)} chunks")
    return chunks
