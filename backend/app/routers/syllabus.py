from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Document, Subject, SyllabusTopic
from ..serializers import topic_dict
from ..services.syllabus import coverage, parse_syllabus

router = APIRouter(prefix="/syllabus", tags=["syllabus"])

VALID_STATUS = {"not_started", "in_progress", "learned", "mastered"}


class ParseRequest(BaseModel):
    subject_id: int
    document_id: int
    use_ai: bool = True


class TopicCreate(BaseModel):
    subject_id: int
    title: str = Field(min_length=1, max_length=300)
    module: str = "General"
    description: str = ""
    priority: str = "medium"
    marks: int = 0


class TopicUpdate(BaseModel):
    title: Optional[str] = None
    module: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    mastery_score: Optional[float] = None


def _subject_names(db: Session) -> dict:
    return {subject.id: subject.name for subject in db.query(Subject).all()}


@router.post("/parse")
async def parse(payload: ParseRequest, db: Session = Depends(get_db)):
    subject = db.get(Subject, payload.subject_id)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    document = db.get(Document, payload.document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status != "ready":
        raise HTTPException(status_code=409, detail="Document is not processed yet. Wait for indexing to finish.")
    try:
        topics = await parse_syllabus(db, payload.subject_id, payload.document_id, payload.use_ai)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "count": len(topics),
        "topics": [topic_dict(topic, subject.name) for topic in topics],
        "note": "Priority scores are study estimates based on your documents, not exam predictions.",
    }


@router.get("/topics")
def list_topics(subject_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(SyllabusTopic)
    if subject_id:
        query = query.filter(SyllabusTopic.subject_id == subject_id)
    topics = query.order_by(SyllabusTopic.module, SyllabusTopic.id).all()
    names = _subject_names(db)
    return [topic_dict(topic, names.get(topic.subject_id, "")) for topic in topics]


@router.post("/topics", status_code=201)
def create_topic(payload: TopicCreate, db: Session = Depends(get_db)):
    if not db.get(Subject, payload.subject_id):
        raise HTTPException(status_code=404, detail="Subject not found")
    topic = SyllabusTopic(
        subject_id=payload.subject_id,
        title=payload.title,
        module=payload.module,
        description=payload.description,
        marks=max(0, payload.marks),
        priority=payload.priority if payload.priority in {"high", "medium", "low"} else "medium",
        priority_reason="Manually added topic; priority set by the student.",
    )
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return topic_dict(topic, db.get(Subject, payload.subject_id).name)


@router.patch("/topics/{topic_id}")
def update_topic(topic_id: int, payload: TopicUpdate, db: Session = Depends(get_db)):
    topic = db.get(SyllabusTopic, topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    data = payload.model_dump(exclude_none=True)
    if "status" in data and data["status"] not in VALID_STATUS:
        raise HTTPException(status_code=400, detail=f"Status must be one of {sorted(VALID_STATUS)}")
    if "priority" in data and data["priority"] not in {"high", "medium", "low"}:
        raise HTTPException(status_code=400, detail="Priority must be high, medium or low")
    if "mastery_score" in data:
        data["mastery_score"] = max(0.0, min(100.0, float(data["mastery_score"])))
    for key, value in data.items():
        setattr(topic, key, value)
    db.commit()
    db.refresh(topic)
    subject = db.get(Subject, topic.subject_id)
    return topic_dict(topic, subject.name if subject else "")


@router.delete("/topics/{topic_id}")
def delete_topic(topic_id: int, db: Session = Depends(get_db)):
    topic = db.get(SyllabusTopic, topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    db.delete(topic)
    db.commit()
    return {"ok": True}


@router.get("/coverage/{subject_id}")
def subject_coverage(subject_id: int, db: Session = Depends(get_db)):
    if not db.get(Subject, subject_id):
        raise HTTPException(status_code=404, detail="Subject not found")
    return coverage(db, subject_id)
