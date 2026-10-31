import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..ai.rag import retrieve
from ..config import ALLOWED_DOCUMENT_EXTENSIONS, MAX_UPLOAD_MB, UPLOAD_DIR
from ..database import get_db
from ..models import Document, Subject
from ..serializers import document_dict
from ..services.documents import guess_kind, process_document_task

router = APIRouter(prefix="/documents", tags=["documents"])


class SearchRequest(BaseModel):
    query: str
    subject_id: Optional[int] = None
    top_k: int = 6


@router.get("")
def list_documents(subject_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Document)
    if subject_id:
        query = query.filter(Document.subject_id == subject_id)
    documents = query.order_by(Document.created_at.desc()).all()
    return [document_dict(document) for document in documents]


@router.post("/upload", status_code=201)
async def upload_document(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    subject_id: Optional[int] = Form(None),
    doc_kind: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    filename = Path(file.filename or "upload").name
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_DOCUMENT_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type {suffix}. Allowed: {', '.join(sorted(ALLOWED_DOCUMENT_EXTENSIONS))}")
    if subject_id is not None and not db.get(Subject, subject_id):
        raise HTTPException(status_code=404, detail="Subject not found")
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_UPLOAD_MB} MB limit.")
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_path = UPLOAD_DIR / stored_name
    stored_path.write_bytes(data)
    document = Document(
        subject_id=subject_id,
        filename=filename,
        stored_path=str(stored_path),
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(data),
        status="queued",
        doc_kind=doc_kind or guess_kind(filename),
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    background.add_task(process_document_task, document.id)
    return document_dict(document)


@router.get("/{document_id}")
def get_document(document_id: int, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document_dict(document, include_preview=True)


@router.get("/{document_id}/pages")
def get_pages(document_id: int, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        pages = json.loads(document.pages_json or "[]")
    except ValueError:
        pages = []
    return {"document": document_dict(document), "pages": pages}


@router.delete("/{document_id}")
def delete_document(document_id: int, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        Path(document.stored_path).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(document)
    db.commit()
    return {"ok": True}


@router.post("/{document_id}/reprocess")
def reprocess_document(document_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status == "processing":
        raise HTTPException(status_code=409, detail="Document is already being processed.")
    document.status = "queued"
    document.error = ""
    db.commit()
    background.add_task(process_document_task, document.id)
    return document_dict(document)


@router.post("/search")
def search_documents(payload: SearchRequest, db: Session = Depends(get_db)):
    top_k = max(1, min(payload.top_k, 20))
    result = retrieve(db, payload.query, subject_id=payload.subject_id, top_k=top_k)
    result["note"] = (
        "Retrieval combines local feature-hashed vectors with keyword overlap. "
        "Configure a remote embedding provider in Settings for dense semantic embeddings."
    )
    return result
