"""
RAG retrieval utilities.
- Embeds text with Gemini embeddings
- Builds compact semantic queries per target field
- Returns ranked chunks plus scores for backend debug output
"""

from __future__ import annotations

from typing import Dict, List

from dotenv import load_dotenv
from google import genai

from .document_store import retrieve_ranked_chunks

load_dotenv()

_client = genai.Client()
EMBEDDING_MODEL = "gemini-embedding-001"


async def embed_texts(texts: List[str]) -> List[List[float]]:
    if not texts:
        return []

    print(f"\n[API HIT] Calling Gemini Embeddings API for {len(texts)} text(s)...", flush=True)

    result = await _client.aio.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=texts,
    )
    return [item.values for item in result.embeddings]


async def retrieve_context_for_fields(session_id: str, target_fields: List[Dict], top_k: int = 3) -> Dict[str, Dict]:
    if not target_fields:
        return {}

    queries = [field["query"] or field["label"] or field["field_id"] for field in target_fields]
    embeddings = await embed_texts(queries)
    bundles: Dict[str, Dict] = {}

    for field, embedding, query in zip(target_fields, embeddings, queries):
        ranked = retrieve_ranked_chunks(session_id, embedding, top_k=top_k)
        bundles[field["field_id"]] = {
            "query": query,
            "candidates": ranked,
            "context_text": "\n".join(item["chunk"] for item in ranked),
        }
        print(
            f"[RAG] Field '{field['field_id']}' query='{query}' retrieved {len(ranked)} chunk(s)",
            flush=True,
        )

    return bundles
