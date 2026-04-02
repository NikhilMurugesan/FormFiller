"""
RAG-style document store.
- Chunks are embedded ONCE on upload using Gemini text-embedding-004
- Embeddings are cached in memory alongside raw chunks
- On every analyze request, only the top-K most relevant chunks are retrieved
  using cosine similarity, dramatically reducing token usage
"""
from typing import Dict, List, Optional
import numpy as np

CHUNK_SIZE = 400       # characters per chunk — smaller = more precise retrieval
CHUNK_OVERLAP = 60    # slight overlap to avoid mid-sentence cuts
TOP_K = 3             # retrieve only 3 chunks per query (≈1200 chars max)

# In-memory store: { session_id: { "filename", "chunks", "embeddings" } }
_store: Dict[str, Dict] = {}


def chunk_text(text: str) -> List[str]:
    """Split text into overlapping windows of CHUNK_SIZE characters."""
    chunks, start = [], 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end == len(text):
            break
        start = end - CHUNK_OVERLAP
    return chunks


def store_document(session_id: str, filename: str, chunks: List[str], embeddings: List[List[float]]):
    """Persist chunks + pre-computed embeddings for a session."""
    _store[session_id] = {
        "filename": filename,
        "chunks": chunks,
        "embeddings": np.array(embeddings, dtype=np.float32),  # shape: (N, D)
    }


def retrieve_chunks(session_id: str, query_embedding: List[float], top_k: int = TOP_K) -> List[str]:
    """
    Given a query embedding, return the top-k most relevant chunks
    using cosine similarity against the cached chunk embeddings.
    Returns empty list if session has no document.
    """
    entry = _store.get(session_id)
    if not entry or len(entry["chunks"]) == 0:
        return []

    chunk_embeddings: np.ndarray = entry["embeddings"]   # (N, D)
    q = np.array(query_embedding, dtype=np.float32)       # (D,)

    # Cosine similarity: normalise then dot product
    q_norm = q / (np.linalg.norm(q) + 1e-10)
    doc_norms = chunk_embeddings / (np.linalg.norm(chunk_embeddings, axis=1, keepdims=True) + 1e-10)
    scores = doc_norms @ q_norm                            # (N,)

    # Pick top-k indices
    top_indices = np.argsort(scores)[::-1][:top_k]
    return [entry["chunks"][i] for i in top_indices]


def get_filename(session_id: str) -> str:
    entry = _store.get(session_id)
    return entry["filename"] if entry else ""


def get_chunk_count(session_id: str) -> int:
    entry = _store.get(session_id)
    return len(entry["chunks"]) if entry else 0


def is_cached(session_id: str) -> bool:
    """Check whether a session already has embeddings stored."""
    return session_id in _store and len(_store[session_id].get("chunks", [])) > 0


def clear_storage(session_id: Optional[str] = None):
    global _store
    if session_id:
        _store.pop(session_id, None)
    else:
        _store.clear()
