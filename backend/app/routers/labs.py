from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import current_user_id, get_db
from ..labs import LAB_INDEX, LABS
from ..models import LabArtifact, utcnow

router = APIRouter(prefix="/labs", tags=["labs"])


class ArtifactRequest(BaseModel):
    code: str
    language: str = "python"


@router.get("")
def list_labs():
    return [
        {
            "slug": lab["slug"],
            "title": lab["title"],
            "domain": lab["domain"],
            "difficulty": lab["difficulty"],
            "duration_minutes": lab["duration_minutes"],
            "language": lab["language"],
            "tools": lab["tools"],
        }
        for lab in LABS
    ]


def _artifact(db: Session, slug: str) -> tuple[LabArtifact | None, str]:
    uid = current_user_id.get()
    scoped = f"u{uid}:{slug}" if uid is not None else slug
    artifact = db.query(LabArtifact).filter(LabArtifact.lab_slug == scoped).first()
    if not artifact:
        artifact = db.query(LabArtifact).filter(LabArtifact.lab_slug == slug).first()
    return artifact, scoped


@router.get("/{slug}")
def get_lab(slug: str, db: Session = Depends(get_db)):
    lab = LAB_INDEX.get(slug)
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    artifact, _ = _artifact(db, slug)
    return {
        **lab,
        "disclaimer": "All experiments are educational simulations. Nothing is reported as hardware-tested unless you personally executed it on physical equipment.",
        "saved_code": artifact.code if artifact else "",
        "saved_language": artifact.language if artifact else lab["language"],
        "saved_at": artifact.updated_at.isoformat() + "Z" if artifact and artifact.updated_at else None,
    }


@router.put("/{slug}/artifact")
def save_artifact(slug: str, payload: ArtifactRequest, db: Session = Depends(get_db)):
    if slug not in LAB_INDEX:
        raise HTTPException(status_code=404, detail="Lab not found")
    artifact, scoped = _artifact(db, slug)
    if not artifact:
        artifact = LabArtifact(lab_slug=scoped, code=payload.code, language=payload.language)
        db.add(artifact)
    else:
        artifact.code = payload.code
        artifact.language = payload.language
        artifact.updated_at = utcnow()
    db.commit()
    return {"ok": True}
