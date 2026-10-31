import json
from typing import Optional


def iso(value) -> Optional[str]:
    if not value:
        return None
    return value.isoformat() + "Z" if value.tzinfo is None else value.isoformat()


def subject_dict(subject) -> dict:
    return {
        "id": subject.id,
        "name": subject.name,
        "code": subject.code or "",
        "semester": subject.semester or "",
        "department": subject.department or "",
        "description": subject.description or "",
        "color": subject.color or "violet",
        "created_at": iso(subject.created_at),
    }


def document_dict(document, include_preview: bool = False) -> dict:
    preview = []
    if include_preview:
        try:
            pages = json.loads(document.pages_json or "[]")
            preview = [{"page": p.get("page"), "text": (p.get("text") or "")[:1200]} for p in pages[:3]]
        except ValueError:
            preview = []
    return {
        "id": document.id,
        "subject_id": document.subject_id,
        "filename": document.filename,
        "mime_type": document.mime_type,
        "size_bytes": document.size_bytes,
        "status": document.status,
        "error": document.error or "",
        "page_count": document.page_count,
        "doc_kind": document.doc_kind,
        "created_at": iso(document.created_at),
        "processed_at": iso(document.processed_at),
        "preview": preview,
    }


def topic_dict(topic, subject_name: str = "") -> dict:
    return {
        "id": topic.id,
        "subject_id": topic.subject_id,
        "subject_name": subject_name,
        "module": topic.module,
        "unit": topic.unit or "",
        "title": topic.title,
        "description": topic.description or "",
        "learning_outcome": topic.learning_outcome or "",
        "priority": topic.priority,
        "priority_score": round(topic.priority_score or 0, 1),
        "priority_reason": topic.priority_reason or "",
        "marks": topic.marks or 0,
        "exam_frequency": round(topic.exam_frequency or 0, 3),
        "status": topic.status,
        "mastery_score": round(topic.mastery_score or 0, 1),
        "last_studied_at": iso(topic.last_studied_at),
        "created_at": iso(topic.created_at),
    }


def quiz_dict(quiz, include_questions: bool = False) -> dict:
    data = {
        "id": quiz.id,
        "subject_id": quiz.subject_id,
        "topic_id": quiz.topic_id,
        "title": quiz.title,
        "mode": quiz.mode,
        "difficulty": quiz.difficulty,
        "generator": quiz.generator,
        "duration_minutes": quiz.duration_minutes,
        "created_at": iso(quiz.created_at),
        "question_count": len(quiz.questions) if quiz.questions is not None else 0,
    }
    if include_questions:
        questions = []
        for question in sorted(quiz.questions, key=lambda q: q.position):
            try:
                options = json.loads(question.options_json or "[]")
            except ValueError:
                options = []
            try:
                source = json.loads(question.source_json or "{}")
            except ValueError:
                source = {}
            questions.append({
                "id": question.id,
                "qtype": question.qtype,
                "prompt": question.prompt,
                "options": options,
                "marks": question.marks,
                "source": source,
                "position": question.position,
            })
        data["questions"] = questions
    return data


def attempt_dict(attempt, quiz_title: str = "") -> dict:
    try:
        feedback = json.loads(attempt.feedback_json or "[]")
    except ValueError:
        feedback = []
    return {
        "id": attempt.id,
        "quiz_id": attempt.quiz_id,
        "quiz_title": quiz_title,
        "subject_id": attempt.subject_id,
        "topic_id": attempt.topic_id,
        "score": attempt.score,
        "max_score": attempt.max_score,
        "percent": attempt.percent,
        "duration_seconds": attempt.duration_seconds,
        "completed_at": iso(attempt.completed_at),
        "feedback": feedback,
    }


def flashcard_dict(card, subject_name: str = "", topic_title: str = "") -> dict:
    try:
        source = json.loads(card.source_json or "{}")
    except ValueError:
        source = {}
    return {
        "id": card.id,
        "subject_id": card.subject_id,
        "subject_name": subject_name,
        "topic_id": card.topic_id,
        "topic_title": topic_title,
        "front": card.front,
        "back": card.back,
        "source": source,
        "ease": card.ease,
        "interval_days": card.interval_days,
        "repetitions": card.repetitions,
        "due_date": iso(card.due_date),
        "last_reviewed_at": iso(card.last_reviewed_at),
        "total_reviews": card.total_reviews,
        "lapses": card.lapses,
    }


def exam_dict(exam, subject_name: str = "") -> dict:
    from datetime import date

    return {
        "id": exam.id,
        "subject_id": exam.subject_id,
        "subject_name": subject_name,
        "title": exam.title,
        "exam_date": exam.exam_date.isoformat(),
        "days_left": (exam.exam_date - date.today()).days,
        "weight": exam.weight,
        "notes": exam.notes or "",
    }


def schedule_dict(session) -> dict:
    return {
        "id": session.id,
        "subject_id": session.subject_id,
        "topic_id": session.topic_id,
        "date": session.date.isoformat(),
        "start_time": session.start_time,
        "duration_minutes": session.duration_minutes,
        "kind": session.kind,
        "status": session.status,
        "rationale": session.rationale or "",
    }


def notification_dict(notification) -> dict:
    return {
        "id": notification.id,
        "title": notification.title,
        "body": notification.body or "",
        "kind": notification.kind,
        "read": bool(notification.read),
        "created_at": iso(notification.created_at),
    }
