"""
Query API
POST /query  — ask a question, get a grounded answer with sources
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from core.rag_engine import rag_engine
from core.registry import registry
import logging, time

router = APIRouter(prefix="/query", tags=["Query"])
logger = logging.getLogger(__name__)


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=1000, description="The question to ask")
    top_k: int = Field(default=6, ge=1, le=20, description="Number of chunks to retrieve")
    namespace: str = Field(default="default", description="Pinecone namespace")


class SourceRef(BaseModel):
    source_id: str
    source_name: str
    source_type: str
    relevance_score: float


class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceRef]
    chunks_used: int
    model: str
    latency_ms: int


@router.post("", response_model=QueryResponse)
def query_knowledge_base(request: QueryRequest):
    """
    Ask a question. Returns an answer grounded in your uploaded documents,
    with citations pointing back to the source files.
    """
    if registry.count() == 0:
        raise HTTPException(
            status_code=400,
            detail="Knowledge base is empty. Upload documents first via /ingest/upload"
        )

    start = time.time()

    try:
        result = rag_engine.query(
            question=request.question,
            namespace=request.namespace,
            top_k=request.top_k,
        )
    except Exception as e:
        logger.error(f"Query failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")

    latency_ms = int((time.time() - start) * 1000)

    return QueryResponse(
        answer=result["answer"],
        sources=result["sources"],
        chunks_used=result["chunks_used"],
        model=result["model"],
        latency_ms=latency_ms,
    )


@router.get("/health")
def health():
    return {
        "status": "ok",
        "indexed_sources": registry.count(),
        "sources": [s["name"] for s in registry.list_all()],
    }
