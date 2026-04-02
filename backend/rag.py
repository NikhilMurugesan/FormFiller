"""
RAG retrieval layer.
- Embeds text using Gemini text-embedding-004 (low cost, purpose-built for retrieval)
- Provides embed_chunks() for upload (batch embed all chunks once)
- Provides build_query_and_retrieve() for analyze (embed field metadata, cosine search)
"""
import os
from typing import List
from google import genai
from dotenv import load_dotenv

from .document_store import retrieve_chunks

load_dotenv()

_client = genai.Client()
EMBEDDING_MODEL = "models/text-embedding-004"


async def embed_texts(texts: List[str]) -> List[List[float]]:
    """
    Batch-embed a list of texts using Gemini Embeddings.
    Returns a list of float vectors.
    """
    embeddings = []
    # Gemini SDK embeds one at a time in the async interface, so we batch sequentially
    for text in texts:
        result = await _client.aio.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=text
        )
        embeddings.append(result.embeddings[0].values)
    return embeddings


def build_query_string(fields: list) -> str:
    """
    Converts a list of FormField dicts to a natural-language search query.
    Example: "Full Name, Email Address, Years of Experience, Skills"
    The embedding of this string is used to find the most relevant document chunks.
    """
    parts = []
    for f in fields:
        label = f.get("label") or f.get("name") or f.get("placeholder") or f.get("id") or ""
        if label:
            parts.append(label.strip())
    return ", ".join(parts) if parts else "user profile information"


async def retrieve_relevant_chunks(session_id: str, fields: list, top_k: int = 4) -> List[str]:
    """
    Main RAG entry point for the /analyze-fields endpoint.
    1. Build a query string from form field labels
    2. Embed the query
    3. Retrieve top-k chunks via cosine similarity
    """
    if not fields:
        return []

    query = build_query_string(fields)
    query_embedding = (await embed_texts([query]))[0]
    chunks = retrieve_chunks(session_id, query_embedding, top_k=top_k)

    print(f"[RAG] Query: '{query}' → retrieved {len(chunks)} chunk(s) from '{session_id}'")
    return chunks
