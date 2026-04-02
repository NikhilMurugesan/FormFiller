"""
RAG retrieval layer.
- Embeds text using Gemini text-embedding-004
- embed_texts() sends ALL chunks in ONE batched API call (not per-chunk)
- retrieve_relevant_chunks() embeds just the query string (1 API call per analyze)
"""
import os
from typing import List
from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv

from .document_store import retrieve_chunks

load_dotenv()

_client = genai.Client()
EMBEDDING_MODEL = "models/text-embedding-004"


async def embed_texts(texts: List[str]) -> List[List[float]]:
    """
    Embed a list of texts in a SINGLE batched API call.
    Uses the batch embed_content API to avoid N separate quota hits.
    Falls back to sequential if batch fails.
    """
    if not texts:
        return []

    print(f"\n[API HIT] Calling Gemini Embeddings API for {len(texts)} chunks...", flush=True)

    try:
        # Batch all texts in one call — 1 API request regardless of chunk count
        result = await _client.aio.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=texts  # pass the full list at once
        )
        return [e.values for e in result.embeddings]

    except Exception as batch_err:
        print(f"[RAG] Batch embed failed ({batch_err}), falling back to sequential...", flush=True)
        # Sequential fallback — still works, just more API calls
        embeddings = []
        for text in texts:
            result = await _client.aio.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=text
            )
            embeddings.append(result.embeddings[0].values)
        return embeddings


def build_query_string(fields: list) -> str:
    """Convert form field metadata into a concise natural-language search query."""
    parts = []
    for f in fields:
        label = f.get("label") or f.get("name") or f.get("placeholder") or f.get("id") or ""
        if label:
            parts.append(label.strip())
    return ", ".join(parts) if parts else "user profile information"


async def retrieve_relevant_chunks(session_id: str, fields: list, top_k: int = 3) -> List[str]:
    """
    Main RAG entry point:
    1. Build query from field labels (1 embedding API call)
    2. Cosine similarity retrieval from cached chunk embeddings
    3. Return top-k most relevant chunks
    """
    if not fields:
        return []

    query = build_query_string(fields)
    query_embedding = (await embed_texts([query]))[0]
    chunks = retrieve_chunks(session_id, query_embedding, top_k=top_k)

    print(f"[RAG] Query: '{query}' → {len(chunks)} chunk(s) retrieved", flush=True)
    return chunks
