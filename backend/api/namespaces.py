"""
Namespaces API for SKC
Lets users create isolated knowledge bases (namespaces) in Pinecone.

Endpoints:
  GET    /namespaces          — list all namespaces
  POST   /namespaces          — create a namespace
  DELETE /namespaces/{name}   — delete a namespace and all its vectors
"""

import re
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.vector_store import vector_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/namespaces", tags=["Namespaces"])

# ---------------------------------------------------------------------------
# In-memory store (persists for the server lifetime)
# Replace with a DB for production
# ---------------------------------------------------------------------------
_namespaces: dict[str, dict] = {
    "default": {
        "name": "default",
        "display_name": "Default",
        "description": "Main knowledge base",
        "created_at": "2024-01-01T00:00:00Z",
    }
}

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class NamespaceCreate(BaseModel):
    name: str                        # slug, e.g. "product-team"
    display_name: str                # human label, e.g. "Product Team"
    description: str = ""


class NamespaceOut(BaseModel):
    name: str
    display_name: str
    description: str
    created_at: str

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("", response_model=list[NamespaceOut])
def list_namespaces():
    return list(_namespaces.values())


@router.post("", response_model=NamespaceOut, status_code=201)
def create_namespace(req: NamespaceCreate):
    # Slugify name: lowercase, only alphanumeric and hyphens
    slug = re.sub(r"[^a-z0-9-]", "-", req.name.lower()).strip("-")
    if not slug:
        raise HTTPException(status_code=400, detail="Invalid namespace name.")
    if slug in _namespaces:
        raise HTTPException(status_code=409, detail=f"Namespace '{slug}' already exists.")

    from datetime import datetime, timezone
    ns = {
        "name": slug,
        "display_name": req.display_name or slug,
        "description": req.description,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _namespaces[slug] = ns
    logger.info(f"Created namespace: {slug}")
    return ns


@router.delete("/{name}", status_code=200)
def delete_namespace(name: str):
    if name == "default":
        raise HTTPException(status_code=400, detail="Cannot delete the default namespace.")
    if name not in _namespaces:
        raise HTTPException(status_code=404, detail=f"Namespace '{name}' not found.")

    # Delete all vectors in this Pinecone namespace
    try:
        vector_store._init()
        vector_store._index.delete(delete_all=True, namespace=name)
        logger.info(f"Deleted all vectors in namespace: {name}")
    except Exception as e:
        logger.warning(f"Could not delete Pinecone vectors for namespace {name}: {e}")

    del _namespaces[name]
    return {"message": f"Namespace '{name}' deleted.", "name": name}


@router.get("/{name}/stats")
def namespace_stats(name: str):
    if name not in _namespaces:
        raise HTTPException(status_code=404, detail=f"Namespace '{name}' not found.")
    try:
        vector_store._init()
        stats = vector_store._index.describe_index_stats()
        ns_stats = stats.get("namespaces", {}).get(name, {})
        vector_count = ns_stats.get("vector_count", 0)
    except Exception as e:
        logger.warning(f"Could not fetch stats for namespace {name}: {e}")
        vector_count = 0
    return {
        **_namespaces[name],
        "vector_count": vector_count,
    }