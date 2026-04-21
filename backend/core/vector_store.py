"""
Vector Store — wraps Pinecone.
Uses Google Gemini for embeddings (free tier).
"""
from pinecone import Pinecone, ServerlessSpec
import google.generativeai as genai
from core.config import get_settings
from typing import List, Dict, Any
import hashlib, time, logging

logger = logging.getLogger(__name__)
settings = get_settings()


class VectorStore:
    def __init__(self):
        self._pc = None
        self._index = None

    def _init(self):
        if self._index:
            return
        genai.configure(api_key=settings.gemini_api_key)
        self._pc = Pinecone(api_key=settings.pinecone_api_key)
        existing = [i.name for i in self._pc.list_indexes()]
        if settings.pinecone_index_name not in existing:
            self._pc.create_index(
                name=settings.pinecone_index_name,
                dimension=settings.embedding_dimensions,
                metric="cosine",
                spec=ServerlessSpec(cloud="aws", region="us-east-1"),
            )
            while not self._pc.describe_index(settings.pinecone_index_name).status["ready"]:
                time.sleep(1)
        self._index = self._pc.Index(settings.pinecone_index_name)

    def _embed(self, texts: List[str]) -> List[List[float]]:
        self._init()
        embeddings = []
        for text in texts:
            result = genai.embed_content(
                model="models/gemini-embedding-001",
                content=text,
                task_type="retrieval_document",
                title="Knowledge chunk"
            )
            embeddings.append(result["embedding"])
        return embeddings

    def _embed_query(self, text: str) -> List[float]:
        self._init()
        result = genai.embed_content(
            model="models/gemini-embedding-001",
            content=text,
            task_type="retrieval_query",
        )
        return result["embedding"]

    def upsert_chunks(self, chunks: List[Dict[str, Any]], source_id: str, namespace: str = "default") -> int:
        self._init()
        texts = [c["text"] for c in chunks]
        embeddings = self._embed(texts)
        vectors = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            chunk_id = hashlib.md5(f"{source_id}_{i}".encode()).hexdigest()
            vectors.append({
                "id": chunk_id,
                "values": embedding,
                "metadata": {
                    **chunk["metadata"],
                    "text": chunk["text"],
                    "source_id": source_id,
                    "chunk_index": i,
                },
            })
        batch_size = 100
        for i in range(0, len(vectors), batch_size):
            self._index.upsert(vectors=vectors[i:i+batch_size], namespace=namespace)
        return len(vectors)

    def search(self, query: str, top_k: int = None, namespace: str = "default") -> List[Dict]:
        self._init()
        k = top_k or settings.top_k
        query_embedding = self._embed_query(query)
        results = self._index.query(
            vector=query_embedding,
            top_k=k,
            include_metadata=True,
            namespace=namespace,
        )
        return [
            {
                "text": match.metadata.get("text", ""),
                "score": round(match.score, 4),
                "source_id": match.metadata.get("source_id", ""),
                "source_name": match.metadata.get("source_name", ""),
                "source_type": match.metadata.get("source_type", ""),
                "page": match.metadata.get("page"),
                "chunk_index": match.metadata.get("chunk_index"),
            }
            for match in results.matches
        ]

    def delete_source(self, source_id: str, namespace: str = "default"):
        self._init()
        self._index.delete(filter={"source_id": {"$eq": source_id}}, namespace=namespace)

    def stats(self) -> Dict:
        self._init()
        return self._index.describe_index_stats()


vector_store = VectorStore()