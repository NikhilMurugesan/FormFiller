from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from pydantic import BaseModel
import uvicorn
import io

from .agent import analyze_form_fields, FormField, AnalyzeResponse
from .document_store import (
    chunk_text, store_document, get_filename,
    get_chunk_count, is_cached, clear_storage
)
from .rag import embed_texts, retrieve_relevant_chunks

# ---- File Parsers ----
def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        return "".join(page.extract_text() or "" for page in reader.pages).strip()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {e}")


def extract_text_from_docx(file_bytes: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip()).strip()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse DOCX: {e}")


# ---- FastAPI App ----
app = FastAPI(title="AI Form Filler Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    fields: List[FormField]
    session_id: Optional[str] = "default"


@app.get("/")
def read_root():
    return {"status": "ok", "message": "AI Form Filler Backend is running"}


@app.get("/document-status")
def document_status(session_id: str = "default"):
    """Check if a document is already embedded in the backend cache."""
    cached = is_cached(session_id)
    return {
        "cached": cached,
        "filename": get_filename(session_id) if cached else None,
        "chunk_count": get_chunk_count(session_id) if cached else 0
    }


@app.post("/upload-document")
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Form(default="default")
):
    """
    Upload PDF or DOCX:
    1. Extract text
    2. Chunk the text
    3. Embed ALL chunks via Gemini Embeddings (done ONCE and cached)
    4. Return metadata (filename + chunk count) — NOT the chunks themselves
    """
    filename = file.filename or "document"
    content = await file.read()

    if filename.lower().endswith(".pdf"):
        text = extract_text_from_pdf(content)
    elif filename.lower().endswith(".docx"):
        text = extract_text_from_docx(content)
    else:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported.")

    if not text:
        raise HTTPException(status_code=400, detail="Could not extract readable text.")

    chunks = chunk_text(text)
    print(f"[Upload] '{filename}' → {len(chunks)} chunks. Embedding now...")

    # Embed all chunks and store with vectors — expensive only once
    embeddings = await embed_texts(chunks)
    store_document(session_id, filename, chunks, embeddings)

    print(f"[Upload] Embeddings cached for session '{session_id}'")

    return {
        "filename": filename,
        "chunk_count": len(chunks),
        "session_id": session_id,
        "status": "embedded_and_cached"
    }


@app.post("/analyze-fields", response_model=AnalyzeResponse)
async def analyze_fields_endpoint(request: AnalyzeRequest):
    """
    Analyze form fields:
    1. Build a query from field labels/names
    2. Retrieve ONLY the top-K relevant chunks using RAG (cosine similarity)
    3. Pass those chunks to Gemini for mapping — minimal tokens used
    """
    session_id = request.session_id or "default"

    # RAG: retrieve only relevant chunks — no chunks sent if no doc uploaded
    relevant_chunks = []
    if is_cached(session_id):
        fields_as_dicts = [f.model_dump() for f in request.fields]
        relevant_chunks = await retrieve_relevant_chunks(session_id, fields_as_dicts)
        print(f"[RAG] Using {len(relevant_chunks)} chunk(s) for this request.")

    response = await analyze_form_fields(request.fields, relevant_chunks)
    return response


@app.delete("/clear-storage")
def clear_storage_endpoint(session_id: Optional[str] = None):
    clear_storage(session_id)
    return {"status": "cleared", "session_id": session_id or "all"}


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
