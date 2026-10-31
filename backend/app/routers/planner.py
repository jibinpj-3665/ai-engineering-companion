from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Exam, ScheduleSession, StudySession, Subject, SyllabusTopic
from ..serializers import exam_dict, schedule_dict
from ..services.planner import generate_plan, log_study_session, ranked_topics

router = APIRouter(tags=["planner"])


class ExamCreate(BaseModel):
    subject_id: int
    title: str = "Examination"
    exam_date: date
    weight: float = 0
    notes: str = ""


class PlanRequest(BaseModel):
    daily_minutes: int = 120
    horizon_days: int = 14


class SessionStatus(BaseModel):
    status: str


class StudyLog(BaseModel):
    minutes: float = Field(gt=0, le=600)
    subject_id: Optional[int] = None
    topic_id: Optional[int] = None
    kind: str = "focus"
    notes: str = ""


@router.get("/exams")
def list_exams(db: Session = Depends(get_db)):
    subjects = {subject.id: subject.name for subject in db.query(Subject).all()}
    exams = db.query(Exam).order_by(Exam.exam_date).all()
    return [exam_dict(exam, subjects.get(exam.subject_id, "")) for exam in exams]


@router.post("/exams", status_code=201)
def create_exam(payload: ExamCreate, db: Session = Depends(get_db)):
    if not db.get(Subject, payload.subject_id):
        raise HTTPException(status_code=404, detail="Subject not found")
    exam = Exam(**payload.model_dump())
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam_dict(exam, db.get(Subject, payload.subject_id).name)


@router.delete("/exams/{exam_id}")
def delete_exam(exam_id: int, db: Session = Depends(get_db)):
    exam = db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    db.delete(exam)
    db.commit()
    return {"ok": True}


@router.post("/planner/generate")
def generate(payload: PlanRequest, db: Session = Depends(get_db)):
    try:
        sessions = generate_plan(db, payload.daily_minutes, horizon_days=payload.horizon_days)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"count": len(sessions), "sessions": [schedule_dict(session) for session in sessions]}


@router.get("/planner")
def get_plan(days: int = 14, db: Session = Depends(get_db)):
    start = date.today()
    end = start + timedelta(days=max(1, min(days, 60)))
    sessions = (
        db.query(ScheduleSession)
        .filter(ScheduleSession.date >= start, ScheduleSession.date <= end)
        .order_by(ScheduleSession.date, ScheduleSession.start_time)
        .all()
    )
    subjects = {subject.id: subject.name for subject in db.query(Subject).all()}
    topics = {topic.id: topic.title for topic in db.query(SyllabusTopic).all()}
    output = []
    for session in sessions:
        data = schedule_dict(session)
        data["subject_name"] = subjects.get(session.subject_id, "")
        data["topic_title"] = topics.get(session.topic_id, "")
        output.append(data)
    return output


@router.patch("/planner/sessions/{session_id}")
def update_session(session_id: int, payload: SessionStatus, db: Session = Depends(get_db)):
    session = db.get(ScheduleSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Schedule session not found")
    if payload.status not in {"planned", "completed", "missed", "skipped"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    previous = session.status
    session.status = payload.status
    if payload.status == "completed" and previous != "completed":
        log_study_session(db, session.subject_id, session.topic_id, session.kind, session.duration_minutes, "Completed scheduled session")
    db.commit()
    return schedule_dict(session)


@router.post("/study-sessions", status_code=201)
def log_session(payload: StudyLog, db: Session = Depends(get_db)):
    record = log_study_session(db, payload.subject_id, payload.topic_id, payload.kind, payload.minutes, payload.notes)
    return {
        "id": record.id,
        "minutes": record.duration_minutes,
        "kind": record.kind,
        "ended_at": record.ended_at.isoformat() + "Z",
    }


@router.get("/study-sessions")
def list_sessions(days: int = 7, db: Session = Depends(get_db)):
    since = date.today() - timedelta(days=max(1, min(days, 90)))
    rows = db.query(StudySession).filter(StudySession.ended_at >= since).order_by(StudySession.ended_at.desc()).all()
    subjects = {subject.id: subject.name for subject in db.query(Subject).all()}
    return [
        {
            "id": row.id,
            "subject_id": row.subject_id,
            "subject_name": subjects.get(row.subject_id, ""),
            "topic_id": row.topic_id,
            "kind": row.kind,
            "minutes": row.duration_minutes,
            "notes": row.notes,
            "ended_at": row.ended_at.isoformat() + "Z" if row.ended_at else None,
        }
        for row in rows
    ]


@router.get("/planner/ranked-topics")
def ranked(db: Session = Depends(get_db)):
    output = []
    subjects = {subject.id: subject.name for subject in db.query(Subject).all()}
    for entry in ranked_topics(db)[:20]:
        topic = entry["topic"]
        output.append({
            "id": topic.id,
            "title": topic.title,
            "subject": subjects.get(topic.subject_id, ""),
            "priority": topic.priority,
            "mastery": topic.mastery_score,
            "score": entry["score"],
            "exam_date": entry["exam_date"].isoformat() if entry["exam_date"] else None,
        })
    return output
