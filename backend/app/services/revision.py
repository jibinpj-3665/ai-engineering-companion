import json
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from ..ai.providers import AIError, chat_completion
from ..ai.rag import retrieve
from ..models import Document, DocumentChunk, Flashcard, Subject, SyllabusTopic, utcnow
from ..services.settings import get_ai_config

_DEF_RE = re.compile(r"^([A-Z][A-Za-z0-9 /&(\-]{2,55}?)\s+(?:is|are|refers to|is defined as|means|denotes)\s+(.{25,240})$")
_EQ_RE = re.compile(r"^[^=]{1,90}=[^=]{1,120}$")


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _topic_rows(db: Session, subject_id: int, topic: Optional[SyllabusTopic], limit: int = 30):
    query = (
        db.query(DocumentChunk, Document)
        .join(Document, DocumentChunk.document_id == Document.id)
        .filter(Document.subject_id == subject_id, Document.status == "ready")
    )
    rows = query.limit(1800).all()
    if topic:
        terms = {w.lower() for w in re.findall(r"[a-zA-Z]{4,}", topic.title + " " + (topic.description or ""))}
        filtered = []
        for chunk, document in rows:
            lowered = (chunk.content + " " + (chunk.heading or "")).lower()
            if terms and any(term in lowered for term in terms):
                filtered.append((chunk, document))
        rows = filtered or rows
    return rows[:limit]


def _heuristic_cards(db: Session, subject_id: int, topic: Optional[SyllabusTopic], limit: int) -> List[dict]:
    rows = _topic_rows(db, subject_id, topic, 40)
    cards: List[dict] = []
    seen = set()

    def add(front: str, back: str, chunk: DocumentChunk, document: Document):
        key = re.sub(r"[^a-z0-9]", "", front.lower())[:100]
        if key in seen or not back.strip():
            return
        seen.add(key)
        cards.append({
            "front": front[:900],
            "back": back[:2000],
            "source": {
                "document": document.filename,
                "document_id": document.id,
                "page": chunk.page,
                "heading": chunk.heading,
            },
        })

    if topic and topic.description:
        cards.append({
            "front": f"What does the syllabus say about “{topic.title}”?",
            "back": _clean(topic.description)[:1600],
            "source": {"syllabus": True, "module": topic.module},
        })

    for chunk, document in rows:
        text = re.sub(r"\n+", " ", chunk.content)
        for sentence in re.split(r"(?<=[.!?])\s+", text):
            sentence = _clean(sentence)
            if len(sentence) < 40 or len(sentence) > 300:
                continue
            match = _DEF_RE.match(sentence)
            if match:
                term = _clean(match.group(1))
                definition = _clean(match.group(2)).rstrip(".")
                if len(term.split()) <= 8:
                    add(f"Define: {term}", definition, chunk, document)
        for line in chunk.content.splitlines():
            line = line.strip()
            if _EQ_RE.match(line) and 4 < len(line) < 160:
                add(f"State the relationship: {line.split('=')[0].strip()[:70]} = ?", line, chunk, document)
        if chunk.heading and len(chunk.heading) > 5 and not chunk.heading.lower().startswith("page "):
            add(f"Explain the key idea of “{chunk.heading}”.", chunk.content[:900], chunk, document)
        if len(cards) >= limit:
            break
    return cards[:limit]


async def _ai_cards(db: Session, topic: Optional[SyllabusTopic], subject: Subject, context: str, limit: int) -> List[dict]:
    cfg = get_ai_config(db)
    if not cfg["configured"]:
        return []
    prompt = (
        "Create spaced-repetition flashcards from this engineering material. Return ONLY JSON: "
        '{"cards":[{"front":"...","back":"..."}]}. '
        f"Make exactly {limit} focused cards: formulas, definitions, derivations, viva questions, exam facts. "
        "Do not invent facts or citations. Material:\n"
        f"Subject: {subject.name}\nTopic: {topic.title if topic else 'mixed'}\n{context[:8000]}"
    )
    try:
        raw = await chat_completion(db, [{"role": "user", "content": prompt}], temperature=0.2, max_tokens=2400, json_mode=True)
        start = raw.find("{")
        end = raw.rfind("}")
        data = json.loads(raw[start:end + 1])
        cards = []
        for item in data.get("cards", [])[:limit]:
            front = _clean(str(item.get("front", "")))
            back = _clean(str(item.get("back", "")))
            if len(front) > 4 and len(back) > 4:
                cards.append({"front": front[:900], "back": back[:2000], "source": {"generated": "ai"}})
        return cards
    except (AIError, ValueError, TypeError):
        return []


async def generate_flashcards(db: Session, subject_id: int, topic_id: Optional[int], limit: int = 12) -> List[Flashcard]:
    subject = db.get(Subject, subject_id)
    if not subject:
        raise ValueError("Subject not found")
    topic = db.get(SyllabusTopic, topic_id) if topic_id else None
    retrieval = retrieve(db, topic.title if topic else subject.name, subject_id=subject_id, top_k=8)
    cards = await _ai_cards(db, topic, subject, retrieval.get("context", ""), limit)
    if len(cards) < limit:
        heuristic = _heuristic_cards(db, subject_id, topic, limit - len(cards))
        existing_fronts = {card["front"] for card in cards}
        cards.extend(card for card in heuristic if card["front"] not in existing_fronts)
    if not cards:
        raise ValueError("No flashcard content could be generated. Upload and index study material first.")
    created = []
    for item in cards[:limit]:
        existing = db.query(Flashcard).filter(
            Flashcard.subject_id == subject_id,
            Flashcard.front == item["front"],
        ).first()
        if existing:
            created.append(existing)
            continue
        card = Flashcard(
            subject_id=subject_id,
            topic_id=topic_id,
            front=item["front"],
            back=item["back"],
            source_json=json.dumps(item.get("source", {})),
            due_date=utcnow(),
        )
        db.add(card)
        created.append(card)
    db.commit()
    for card in created:
        db.refresh(card)
    return created


def review_card(db: Session, card_id: int, grade: int) -> Flashcard:
    card = db.get(Flashcard, card_id)
    if not card:
        raise ValueError("Flashcard not found")
    grade = max(0, min(5, int(grade)))
    ease = card.ease or 2.5
    if grade >= 3:
        if card.repetitions == 0:
            interval = 1
        elif card.repetitions == 1:
            interval = 6
        else:
            interval = max(1, round((card.interval_days or 1) * ease))
        card.repetitions = (card.repetitions or 0) + 1
    else:
        card.repetitions = 0
        card.interval_days = 0
        card.lapses = (card.lapses or 0) + 1
        interval = 0 if grade <= 1 else 1
    ease = ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
    card.ease = max(1.3, round(ease, 2))
    card.interval_days = interval
    card.last_reviewed_at = utcnow()
    card.total_reviews = (card.total_reviews or 0) + 1
    card.due_date = utcnow() + timedelta(days=interval, hours=4 if interval == 0 else 0)
    db.commit()
    db.refresh(card)
    return card


def revision_stats(db: Session) -> dict:
    now = utcnow()
    today_end = datetime(now.year, now.month, now.day) + timedelta(days=1)
    cards = db.query(Flashcard).all()
    due = [c for c in cards if c.due_date and c.due_date < today_end]
    overdue = [c for c in cards if c.due_date and c.due_date < now - timedelta(hours=12)]
    mastered = [c for c in cards if (c.interval_days or 0) >= 21]
    reviews = sum(c.total_reviews or 0 for c in cards)
    lapses = sum(c.lapses or 0 for c in cards)
    retention = round(max(0.0, (reviews - lapses) / reviews) * 100, 1) if reviews else 0.0
    return {
        "total": len(cards),
        "due_today": len(due),
        "overdue": len(overdue),
        "mastered": len(mastered),
        "retention": retention,
        "average_ease": round(sum(c.ease or 2.5 for c in cards) / len(cards), 2) if cards else 2.5,
    }
