from __future__ import annotations

import io
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .agent import analyze_form_request
from .contracts import AnalyzeFieldsRequest, AnalyzeFieldsResponse
from .document_store import chunk_text, clear_storage, get_chunk_count, get_filename, is_cached, store_document
from .normalization import normalize_request
from .rag import embed_texts, retrieve_context_for_fields


def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        import PyPDF2

        reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        return "".join(page.extract_text() or "" for page in reader.pages).strip()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {exc}") from exc


def extract_text_from_docx(file_bytes: bytes) -> str:
    try:
        from docx import Document

        doc = Document(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip()).strip()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse DOCX: {exc}") from exc


app = FastAPI(title="AI Form Filler Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"status": "ok", "message": "AI Form Filler Backend is running"}


@app.get("/document-status")
def document_status(session_id: str = "default"):
    cached = is_cached(session_id)
    return {
        "cached": cached,
        "filename": get_filename(session_id) if cached else None,
        "chunk_count": get_chunk_count(session_id) if cached else 0,
    }


@app.post("/upload-document")
async def upload_document(file: UploadFile = File(...), session_id: str = Form(default="default")):
    print(f"\n[API HIT] POST /upload-document | File: {file.filename}", flush=True)

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
    embeddings = await embed_texts(chunks)
    store_document(session_id, filename, chunks, embeddings)

    return {
        "filename": filename,
        "chunk_count": len(chunks),
        "session_id": session_id,
        "status": "embedded_and_cached",
    }


@app.post("/analyze-fields", response_model=AnalyzeFieldsResponse)
async def analyze_fields_endpoint(request: AnalyzeFieldsRequest):
    print(
        f"\n[API HIT] POST /analyze-fields | Fields received: {len(request.detected_fields)} | Targets: {len(request.target_field_ids)}",
        flush=True,
    )

    normalized = normalize_request(request)
    print(
        f"[Normalize] Domain={normalized['page'].get('domain')} | FormType={normalized['form'].get('form_type')} | "
        f"TargetFieldIds={[field['field_id'] for field in normalized['target_fields']]}",
        flush=True,
    )

    retrieval_context = {}
    if is_cached(request.session_id):
        retrieval_context = await retrieve_context_for_fields(request.session_id, normalized["target_fields"])

    response = await analyze_form_request(
        normalized_context=normalized,
        retrieval_context=retrieval_context,
        debug=request.debug,
    )
    return response


@app.delete("/clear-storage")
def clear_storage_endpoint(session_id: Optional[str] = None):
    clear_storage(session_id)
    return {"status": "cleared", "session_id": session_id or "all"}


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
