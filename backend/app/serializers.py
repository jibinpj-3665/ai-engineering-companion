import json
from typing import Optional


def iso(value) -> Optional[str]:
    if not value:
        return None
    return value.isoformat() + "Z" if value.tzinfo is None else value.isoformat()


def subject_dict(subject) -> dict:
    try:
        assessment = json.loads(subject.assessment_json or "{}")
    except ValueError:
        assessment = {}
    try:
        books = json.loads(subject.books_json or "{}")
    except ValueError:
        books = {}
    return {
        "id": subject.id,
        "name": subject.name,
        "code": subject.code or "",
        "semester": subject.semester or "",
        "department": subject.department or "",
        "description": subject.description or "",
        "color": subject.color or "violet",
        "academic_year": subject.academic_year or "",
        "credits": subject.credits or 0,
        "ltp": subject.ltp or "",
        "preamble": subject.preamble or "",
        "prerequisites": subject.prerequisites or "",
        "corequisites": subject.corequisites or "",
        "semester_source": subject.semester_source or "",
        "assessment": assessment,
        "books": books,
        "syllabus_updated_at": iso(subject.syllabus_updated_at),
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
        "stage": document.stage or document.status,
        "progress": int(document.progress or 0),
        "error": document.error or "",
        "page_count": document.page_count,
        "doc_kind": document.doc_kind,
        "sha256": document.sha256 or "",
        "source_path": document.source_path or "",
        "source_identity": document.source_identity or "",
        "academic_year": document.academic_year or "",
        "semester": document.semester or "",
        "semester_confidence": document.semester_confidence or "",
        "import_batch_id": document.import_batch_id,
        "version": document.version or 1,
        "active": bool(document.active if document.active is not None else True),
        "created_at": iso(document.created_at),
        "processed_at": iso(document.processed_at),
        "preview": preview,
    }


def module_dict(module, topic_count: int = 0, mastered: int = 0, learned: int = 0, in_progress: int = 0, topic_ids=None) -> dict:
    return {
        "id": module.id,
        "subject_id": module.subject_id,
        "document_id": module.document_id,
        "number": module.number,
        "label": module.label,
        "title": module.title,
        "description": module.description or "",
        "lecture_hours": module.lecture_hours or 0,
        "tutorial_hours": module.tutorial_hours or 0,
        "practical_hours": module.practical_hours or 0,
        "self_study_hours": module.self_study_hours or 0,
        "page_start": module.page_start or 0,
        "page_end": module.page_end or 0,
        "topic_count": topic_count,
        "mastered": mastered,
        "learned": learned,
        "in_progress": in_progress,
        "topic_ids": topic_ids or [],
    }


def outcome_dict(outcome) -> dict:
    try:
        po = json.loads(outcome.po_json or "[]")
    except ValueError:
        po = []
    return {
        "id": outcome.id,
        "subject_id": outcome.subject_id,
        "document_id": outcome.document_id,
        "code": outcome.code,
        "description": outcome.description or "",
        "bloom_level": outcome.bloom_level or "",
        "po_mapping": po,
        "page": outcome.page or 0,
    }


def topic_dict(topic, subject_name: str = "") -> dict:
    return {
        "id": topic.id,
        "subject_id": topic.subject_id,
        "subject_name": subject_name,
        "module": topic.module,
        "module_id": topic.module_id,
        "unit": topic.unit or "",
        "topic_number": topic.topic_number or "",
        "content_type": topic.content_type or "topic",
        "source_page": topic.source_page or 0,
        "source_document_id": topic.source_document_id,
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
