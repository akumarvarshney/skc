"""
RAG Engine — uses Groq for generation (free tier).
"""
from groq import Groq
from core.vector_store import vector_store
from core.config import get_settings
from typing import List, Dict, Any
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

SYSTEM_PROMPT = """You are a Semantic Knowledge Copilot — an AI assistant that answers questions strictly using the company's internal knowledge base.

Rules you MUST follow:
1. Answer ONLY from the provided context chunks. Never use outside knowledge.
2. If the context doesn't contain enough information, say: "I couldn't find a clear answer in the knowledge base. Try rephrasing or check the source docs directly."
3. Always cite which source(s) your answer comes from using [Source: <n>] inline.
4. Be concise and direct. Avoid filler phrases.
5. If multiple sources say different things, mention the discrepancy.
"""

def _build_context_block(chunks: List[Dict]) -> str:
    if not chunks:
        return "No relevant context found."
    blocks = []
    for i, chunk in enumerate(chunks, 1):
        source = chunk.get("source_name") or chunk.get("source_id", "Unknown")
        page_info = f", page {chunk['page']}" if chunk.get("page") else ""
        blocks.append(
            f"[Chunk {i} | Source: {source}{page_info} | Relevance: {chunk['score']}]\n"
            f"{chunk['text'].strip()}"
        )
    return "\n\n---\n\n".join(blocks)

def _deduplicate_sources(chunks: List[Dict]) -> List[Dict]:
    seen = set()
    sources = []
    for chunk in chunks:
        sid = chunk.get("source_id", "")
        if sid not in seen:
            seen.add(sid)
            sources.append({
                "source_id": sid,
                "source_name": chunk.get("source_name", sid),
                "source_type": chunk.get("source_type", "file"),
                "relevance_score": chunk.get("score", 0),
            })
    return sources

class RAGEngine:
    def __init__(self):
        self._client = None

    def _get_client(self):
        if not self._client:
            self._client = Groq(api_key=settings.groq_api_key)
        return self._client

    def query(self, question: str, namespace: str = "default", top_k: int = None) -> Dict[str, Any]:
        if not question.strip():
            return {"answer": "Please provide a question.", "sources": [], "chunks_used": 0}

        chunks = vector_store.search(question, top_k=top_k, namespace=namespace)
        if not chunks:
            return {
                "answer": "The knowledge base appears to be empty. Please upload some documents first.",
                "sources": [], "chunks_used": 0, "model": settings.llm_model,
            }

        relevant_chunks = [c for c in chunks if c["score"] >= 0.30]
        if not relevant_chunks:
            return {
                "answer": "I couldn't find relevant information in the knowledge base for this question.",
                "sources": [], "chunks_used": 0, "model": settings.llm_model,
            }

        context_block = _build_context_block(relevant_chunks)
        user_message = (
            f"Context from knowledge base:\n\n{context_block}\n\n"
            f"---\n\nQuestion: {question}"
        )

        client = self._get_client()
        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message}
            ],
            temperature=settings.llm_temperature,
            max_tokens=settings.max_tokens,
        )

        answer = response.choices[0].message.content.strip()
        sources = _deduplicate_sources(relevant_chunks)
        return {
            "answer": answer,
            "sources": sources,
            "chunks_used": len(relevant_chunks),
            "model": settings.llm_model,
        }

rag_engine = RAGEngine()