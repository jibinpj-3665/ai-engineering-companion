from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Document, Subject, SyllabusTopic
from ..serializers import subject_dict

router = APIRouter(prefix="/subjects", tags=["subjects"])


class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str = ""
    semester: str = ""
    department: str = ""
    description: str = ""
    color: str = "violet"


class SubjectUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    semester: Optional[str] = None
    department: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None


def _with_counts(db: Session, subject: Subject) -> dict:
    data = subject_dict(subject)
    data["topic_count"] = db.query(SyllabusTopic).filter(SyllabusTopic.subject_id == subject.id).count()
    data["mastered_count"] = db.query(SyllabusTopic).filter(
        SyllabusTopic.subject_id == subject.id, SyllabusTopic.status == "mastered"
    ).count()
    data["document_count"] = db.query(Document).filter(Document.subject_id == subject.id).count()
    return data


@router.get("")
def list_subjects(db: Session = Depends(get_db)):
    subjects = db.query(Subject).order_by(Subject.created_at.desc()).all()
    return [_with_counts(db, subject) for subject in subjects]


@router.post("", status_code=201)
def create_subject(payload: SubjectCreate, db: Session = Depends(get_db)):
    subject = Subject(**payload.model_dump())
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return _with_counts(db, subject)


@router.get("/{subject_id}")
def get_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    return _with_counts(db, subject)


@router.patch("/{subject_id}")
def update_subject(subject_id: int, payload: SubjectUpdate, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(subject, key, value)
    db.commit()
    db.refresh(subject)
    return _with_counts(db, subject)


@router.delete("/{subject_id}")
def delete_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.get(Subject, subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    for document in db.query(Document).filter(Document.subject_id == subject_id).all():
        try:
            Path(document.stored_path).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(subject)
    db.commit()
    return {"ok": True}
