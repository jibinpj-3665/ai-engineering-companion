import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Subject, SyllabusTopic
from ..serializers import topic_dict
from ..services.teaching import PHASES, generate_phase, get_session

router = APIRouter(prefix="/teaching", tags=["teaching"])


class PhaseRequest(BaseModel):
    phase: int
    regenerate: bool = False
    personality: str = "study_buddy"


@router.get("/phases")
def list_phases():
    return PHASES


@router.get("/{topic_id}/progress")
def progress(topic_id: int, db: Session = Depends(get_db)):
    topic = db.get(SyllabusTopic, topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    session = get_session(db, topic_id)
    subject = db.get(Subject, topic.subject_id) if topic.subject_id else None
    try:
        viewed = json.loads(session.viewed_phases or "[]")
    except ValueError:
        viewed = []
    try:
        cached = list(json.loads(session.phases_json or "{}").keys())
    except ValueError:
        cached = []
    return {
        "topic": topic_dict(topic, subject.name if subject else ""),
        "phases": PHASES,
        "viewed_phases": viewed,
        "cached_phases": [int(key) for key in cached],
        "progress_percent": session.progress_percent,
        "mastery_passed": session.mastery_passed,
        "note": "Viewing phases marks progress but does not mark the topic complete. Pass a mastery quiz (70%+) to mark it learned.",
    }


@router.post("/{topic_id}/phase")
async def phase(topic_id: int, payload: PhaseRequest, db: Session = Depends(get_db)):
    if payload.phase < 1 or payload.phase > 10:
        raise HTTPException(status_code=400, detail="Phase must be between 1 and 10")
    try:
        return await generate_phase(db, topic_id, payload.phase, payload.regenerate, payload.personality)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{topic_id}/reset")
def reset_progress(topic_id: int, db: Session = Depends(get_db)):
    topic = db.get(SyllabusTopic, topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    session = get_session(db, topic_id)
    session.phases_json = "{}"
    session.viewed_phases = "[]"
    session.progress_percent = 0
    session.mastery_passed = False
    db.commit()
    return {"ok": True}
