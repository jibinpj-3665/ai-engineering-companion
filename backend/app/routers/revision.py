from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Flashcard, Subject, SyllabusTopic, utcnow
from ..serializers import flashcard_dict
from ..services.revision import generate_flashcards, revision_stats, review_card

router = APIRouter(prefix="/revision", tags=["revision"])


class GenerateRequest(BaseModel):
    subject_id: int
    topic_id: Optional[int] = None
    limit: int = 12


class ReviewRequest(BaseModel):
    grade: int


def _names(db: Session):
    subjects = {subject.id: subject.name for subject in db.query(Subject).all()}
    topics = {topic.id: topic.title for topic in db.query(SyllabusTopic).all()}
    return subjects, topics


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    return revision_stats(db)


@router.get("/cards")
def list_cards(subject_id: Optional[int] = None, due_only: bool = False, db: Session = Depends(get_db)):
    query = db.query(Flashcard)
    if subject_id:
        query = query.filter(Flashcard.subject_id == subject_id)
    if due_only:
        query = query.filter(Flashcard.due_date <= utcnow())
    cards = query.order_by(Flashcard.due_date).limit(300).all()
    subjects, topics = _names(db)
    return [flashcard_dict(card, subjects.get(card.subject_id, ""), topics.get(card.topic_id, "")) for card in cards]


@router.post("/generate", status_code=201)
async def generate(payload: GenerateRequest, db: Session = Depends(get_db)):
    if not db.get(Subject, payload.subject_id):
        raise HTTPException(status_code=404, detail="Subject not found")
    try:
        cards = await generate_flashcards(db, payload.subject_id, payload.topic_id, max(1, min(payload.limit, 40)))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    subjects, topics = _names(db)
    return [flashcard_dict(card, subjects.get(card.subject_id, ""), topics.get(card.topic_id, "")) for card in cards]


@router.post("/{card_id}/review")
def review(card_id: int, payload: ReviewRequest, db: Session = Depends(get_db)):
    try:
        card = review_card(db, card_id, payload.grade)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    subjects, topics = _names(db)
    return flashcard_dict(card, subjects.get(card.subject_id, ""), topics.get(card.topic_id, ""))


@router.delete("/{card_id}")
def delete_card(card_id: int, db: Session = Depends(get_db)):
    card = db.get(Flashcard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Flashcard not found")
    db.delete(card)
    db.commit()
    return {"ok": True}
