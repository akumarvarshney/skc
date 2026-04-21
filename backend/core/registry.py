"""
Document Registry — tracks all indexed sources in memory.
In production, replace with a PostgreSQL table.
"""
from typing import Dict, List, Optional
from datetime import datetime
import threading

class DocumentRegistry:
    def __init__(self):
        self._store: Dict[str, dict] = {}
        self._lock = threading.Lock()

    def add(self, source_id: str, name: str, file_type: str, chunk_count: int, size_bytes: int):
        with self._lock:
            self._store[source_id] = {
                "source_id": source_id,
                "name": name,
                "file_type": file_type,
                "chunk_count": chunk_count,
                "size_bytes": size_bytes,
                "indexed_at": datetime.utcnow().isoformat(),
                "status": "indexed",
            }

    def remove(self, source_id: str) -> bool:
        with self._lock:
            if source_id in self._store:
                del self._store[source_id]
                return True
            return False

    def get(self, source_id: str) -> Optional[dict]:
        return self._store.get(source_id)

    def list_all(self) -> List[dict]:
        return list(self._store.values())

    def count(self) -> int:
        return len(self._store)


registry = DocumentRegistry()
