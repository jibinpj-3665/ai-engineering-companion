import json
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Quiz, QuizAttempt, SavedQuestion, Subject, SyllabusTopic
from ..serializers import attempt_dict, quiz_dict
from ..services.quizzes import MODE_CONFIG, evaluate_attempt, generate_quiz

router = APIRouter(prefix="/quizzes", tags=["quizzes"])


class GenerateRequest(BaseModel):
    subject_id: int
    topic_id: Optional[int] = None
    mode: str = "quick"
    count: Optional[int] = None
    difficulty: str = "mixed"
    title: str = ""


class SubmitRequest(BaseModel):
    answers: Dict[str, str]
    duration_seconds: int = 0


class SaveQuestionRequest(BaseModel):
    subject_id: Optional[int] = None
    topic_id: Optional[int] = None
    qtype: str = "short"
    prompt: str = Field(min_length=3)
    answer: str = ""
    explanation: str = ""
    source: dict = {}


@router.post("/generate", status_code=201)
async def generate(payload: GenerateRequest, db: Session = Depends(get_db)):
    if not db.get(Subject, payload.subject_id):
        raise HTTPException(status_code=404, detail="Subject not found")
    if payload.topic_id:
        topic = db.get(SyllabusTopic, payload.topic_id)
        if not topic:
            raise HTTPException(status_code=404, detail="Topic not found")
        if topic.subject_id != payload.subject_id:
            raise HTTPException(status_code=400, detail="Topic does not belong to the selected subject")
    if payload.mode not in MODE_CONFIG:
        raise HTTPException(status_code=400, detail=f"Mode must be one of {sorted(MODE_CONFIG)}")
    try:
        quiz = await generate_quiz(
            db,
            payload.subject_id,
            payload.topic_id,
            payload.mode,
            payload.count,
            payload.difficulty,
            payload.title,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return quiz_dict(quiz, include_questions=True)


@router.get("")
def list_quizzes(subject_id: Optional[int] = None, topic_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Quiz)
    if subject_id:
        query = query.filter(Quiz.subject_id == subject_id)
    if topic_id:
        query = query.filter(Quiz.topic_id == topic_id)
    quizzes = query.order_by(Quiz.created_at.desc()).limit(100).all()
    return [quiz_dict(quiz) for quiz in quizzes]


@router.get("/attempts")
def list_attempts(subject_id: Optional[int] = None, topic_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(QuizAttempt)
    if subject_id:
        query = query.filter(QuizAttempt.subject_id == subject_id)
    if topic_id:
        query = query.filter(QuizAttempt.topic_id == topic_id)
    attempts = query.order_by(QuizAttempt.completed_at.desc()).limit(100).all()
    titles = {quiz.id: quiz.title for quiz in db.query(Quiz).all()}
    return [attempt_dict(attempt, titles.get(attempt.quiz_id, "")) for attempt in attempts]


@router.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: int, db: Session = Depends(get_db)):
    attempt = db.get(QuizAttempt, attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")
    quiz = db.get(Quiz, attempt.quiz_id)
    return attempt_dict(attempt, quiz.title if quiz else "")


@router.get("/saved")
def list_saved(db: Session = Depends(get_db)):
    rows = db.query(SavedQuestion).order_by(SavedQuestion.created_at.desc()).all()
    output = []
    for row in rows:
        try:
            source = json.loads(row.source_json or "{}")
        except ValueError:
            source = {}
        output.append({
            "id": row.id,
            "subject_id": row.subject_id,
            "topic_id": row.topic_id,
            "qtype": row.qtype,
            "prompt": row.prompt,
            "answer": row.answer,
            "explanation": row.explanation,
            "source": source,
            "created_at": row.created_at.isoformat() + "Z" if row.created_at else None,
        })
    return output


@router.post("/saved", status_code=201)
def save_question(payload: SaveQuestionRequest, db: Session = Depends(get_db)):
    row = SavedQuestion(
        subject_id=payload.subject_id,
        topic_id=payload.topic_id,
        qtype=payload.qtype,
        prompt=payload.prompt,
        answer=payload.answer,
        explanation=payload.explanation,
        source_json=json.dumps(payload.source),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "ok": True}


@router.delete("/saved/{saved_id}")
def delete_saved(saved_id: int, db: Session = Depends(get_db)):
    row = db.get(SavedQuestion, saved_id)
    if not row:
        raise HTTPException(status_code=404, detail="Saved question not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/{quiz_id}")
def get_quiz(quiz_id: int, db: Session = Depends(get_db)):
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return quiz_dict(quiz, include_questions=True)


@router.post("/{quiz_id}/submit")
async def submit(quiz_id: int, payload: SubmitRequest, db: Session = Depends(get_db)):
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    try:
        attempt = await evaluate_attempt(db, quiz, payload.answers, payload.duration_seconds)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return attempt_dict(attempt, quiz.title)


@router.delete("/{quiz_id}")
def delete_quiz(quiz_id: int, db: Session = Depends(get_db)):
    quiz = db.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    db.delete(quiz)
    db.commit()
    return {"ok": True}
