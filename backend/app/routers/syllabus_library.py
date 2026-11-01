import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import SyllabusImportBatch
from ..services.syllabus_library import (
    batch_dict,
    import_syllabus_folder,
    library_overview,
    manifest_export,
    rebuild_library,
    reparse_document,
    search_library,
    subject_library_detail,
    unindex_document,
)

router = APIRouter(prefix="/syllabus/library", tags=["syllabus-library"])


class ImportRequest(BaseModel):
    path: str


def _allowed_import_roots() -> list[Path]:
    raw = os.environ.get("AEC_IMPORT_ROOTS", "")
    return [Path(item.strip()).expanduser().resolve() for item in raw.split(os.pathsep) if item.strip()]


def _check_local_import(request: Request, source: Path) -> None:
    host = request.client.host if request.client else ""
    roots = _allowed_import_roots()
    if roots:
        if not any(source == root or source.is_relative_to(root) for root in roots):
            raise HTTPException(status_code=403, detail="The selected folder is outside the configured AEC_IMPORT_ROOTS allow-list.")
        return
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise HTTPException(
            status_code=403,
            detail="Folder import is only available from the local desktop app. On a deployed server, upload documents through the Knowledge Base instead.",
        )


@router.get("")
def overview(db: Session = Depends(get_db)):
    return library_overview(db)


@router.get("/search")
def search(q: str = "", limit: int = 30, db: Session = Depends(get_db)):
    return search_library(db, q, max(1, min(limit, 100)))


@router.get("/manifest")
def manifest(db: Session = Depends(get_db)):
    return manifest_export(db)


@router.get("/imports")
def imports(db: Session = Depends(get_db)):
    batches = db.query(SyllabusImportBatch).order_by(SyllabusImportBatch.created_at.desc()).limit(50).all()
    return [batch_dict(batch) for batch in batches]


@router.get("/imports/{batch_id}")
def import_detail(batch_id: int, db: Session = Depends(get_db)):
    batch = db.get(SyllabusImportBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Import batch not found")
    return batch_dict(batch)


@router.post("/import", status_code=201)
def import_folder(payload: ImportRequest, request: Request, db: Session = Depends(get_db)):
    raw = (payload.path or "").strip().strip('"')
    if not raw:
        raise HTTPException(status_code=400, detail="Choose a folder to import.")
    if "\x00" in raw:
        raise HTTPException(status_code=400, detail="Invalid folder path.")
    source = Path(raw).expanduser()
    if not source.exists():
        raise HTTPException(status_code=404, detail="The selected folder does not exist.")
    if not source.is_dir():
        raise HTTPException(status_code=400, detail="The selected path is not a folder.")
    source = source.resolve()
    _check_local_import(request, source)
    try:
        batch = import_syllabus_folder(db, source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return batch_dict(batch)


@router.get("/subjects/{subject_id}")
def subject_detail(subject_id: int, db: Session = Depends(get_db)):
    try:
        return subject_library_detail(db, subject_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/documents/{document_id}/unindex")
def unindex(document_id: int, db: Session = Depends(get_db)):
    try:
        return unindex_document(db, document_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/documents/{document_id}/reparse")
def reparse(document_id: int, db: Session = Depends(get_db)):
    try:
        return reparse_document(db, document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rebuild")
def rebuild(db: Session = Depends(get_db)):
    return rebuild_library(db)
