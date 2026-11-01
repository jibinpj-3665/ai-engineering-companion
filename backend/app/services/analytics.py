from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models import (
    Document,
    Exam,
    Flashcard,
    Notification,
    QuizAttempt,
    ScheduleSession,
    StudySession,
    Subject,
    SyllabusModule,
    SyllabusTopic,
    utcnow,
)
from ..services.planner import ranked_topics
from ..services.revision import revision_stats
from ..services.settings import get_settings


def _day_key(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def study_minutes(db: Session, since: Optional[datetime] = None) -> float:
    query = db.query(StudySession)
    if since:
        query = query.filter(StudySession.ended_at >= since)
    total = sum(session.duration_minutes or 0 for session in query.all())
    quiz_query = db.query(QuizAttempt)
    if since:
        quiz_query = quiz_query.filter(QuizAttempt.completed_at >= since)
    total += sum((attempt.duration_seconds or 0) / 60 for attempt in quiz_query.all())
    return round(total, 1)


def streak_days(db: Session) -> int:
    days = set()
    for session in db.query(StudySession).all():
        if session.ended_at:
            days.add(session.ended_at.date())
    for attempt in db.query(QuizAttempt).all():
        if attempt.completed_at:
            days.add(attempt.completed_at.date())
    if not days:
        return 0
    cursor = date.today()
    if cursor not in days:
        cursor -= timedelta(days=1)
    count = 0
    while cursor in days:
        count += 1
        cursor -= timedelta(days=1)
    return count


def subject_progress(db: Session) -> list:
    subjects = db.query(Subject).order_by(Subject.name).all()
    output = []
    for subject in subjects:
        topics = db.query(SyllabusTopic).filter(SyllabusTopic.subject_id == subject.id).all()
        total = len(topics)
        mastered = len([t for t in topics if t.status == "mastered"])
        learned = len([t for t in topics if t.status == "learned"])
        in_progress = len([t for t in topics if t.status == "in_progress"])
        avg_mastery = round(sum(t.mastery_score or 0 for t in topics) / total, 1) if total else 0.0
        weighted = 0.0
        if total:
            weighted = ((mastered * 100) + (learned * 75) + (in_progress * 35)) / total
        documents = db.query(Document).filter(Document.subject_id == subject.id, Document.status == "ready").count()
        attempts = db.query(QuizAttempt).filter(QuizAttempt.subject_id == subject.id).all()
        quiz_avg = round(sum(a.percent or 0 for a in attempts) / len(attempts), 1) if attempts else 0.0
        exam = db.query(Exam).filter(Exam.subject_id == subject.id, Exam.exam_date >= date.today()).order_by(Exam.exam_date).first()
        readiness = round(min(100, (weighted * 0.55) + (quiz_avg * 0.25) + (min(documents, 3) / 3 * 20 * 0.2)), 1)
        output.append({
            "id": subject.id,
            "name": subject.name,
            "code": subject.code,
            "color": subject.color,
            "semester": subject.semester,
            "topics": total,
            "mastered": mastered,
            "learned": learned,
            "in_progress": in_progress,
            "completion": round(weighted, 1),
            "average_mastery": avg_mastery,
            "documents": documents,
            "quiz_average": quiz_avg,
            "exam_date": exam.exam_date.isoformat() if exam else None,
            "exam_title": exam.title if exam else None,
            "readiness": readiness,
        })
    return output


def semester_progress(db: Session) -> list:
    subjects = db.query(Subject).order_by(Subject.semester, Subject.name).all()
    buckets = {}
    for subject in subjects:
        semester = subject.semester or "Unassigned"
        bucket = buckets.setdefault(semester, {
            "semester": semester,
            "academic_year": subject.academic_year or "",
            "subjects": 0,
            "modules": 0,
            "topics": 0,
            "mastered": 0,
            "learned": 0,
            "in_progress": 0,
            "completion": 0.0,
            "credits": 0,
        })
        topics = db.query(SyllabusTopic).filter(SyllabusTopic.subject_id == subject.id).all()
        bucket["subjects"] += 1
        bucket["modules"] += db.query(SyllabusModule).filter(SyllabusModule.subject_id == subject.id).count()
        bucket["topics"] += len(topics)
        bucket["mastered"] += len([topic for topic in topics if topic.status == "mastered"])
        bucket["learned"] += len([topic for topic in topics if topic.status == "learned"])
        bucket["in_progress"] += len([topic for topic in topics if topic.status == "in_progress"])
        bucket["credits"] += subject.credits or 0
        bucket["completion"] += sum(
            100 if topic.status == "mastered" else 75 if topic.status == "learned" else 35 if topic.status == "in_progress" else 0
            for topic in topics
        )
        if not bucket["academic_year"] and subject.academic_year:
            bucket["academic_year"] = subject.academic_year
    for bucket in buckets.values():
        bucket["completion"] = round(bucket["completion"] / max(1, bucket["topics"]), 1)
    return sorted(buckets.values(), key=lambda item: (item["semester"] == "Unassigned", item["semester"]))


def daily_minutes(db: Session, days: int = 7) -> list:
    start = date.today() - timedelta(days=days - 1)
    buckets = {start + timedelta(days=i): 0.0 for i in range(days)}
    for session in db.query(StudySession).filter(StudySession.ended_at >= datetime.combine(start, datetime.min.time())).all():
        if session.ended_at and session.ended_at.date() in buckets:
            buckets[session.ended_at.date()] += session.duration_minutes or 0
    for attempt in db.query(QuizAttempt).filter(QuizAttempt.completed_at >= datetime.combine(start, datetime.min.time())).all():
        if attempt.completed_at and attempt.completed_at.date() in buckets:
            buckets[attempt.completed_at.date()] += (attempt.duration_seconds or 0) / 60
    return [
        {"date": day.isoformat(), "label": day.strftime("%a"), "minutes": round(minutes, 1)}
        for day, minutes in buckets.items()
    ]


def weak_topics(db: Session, limit: int = 6) -> list:
    topics = db.query(SyllabusTopic).filter(SyllabusTopic.mastery_score < 60, SyllabusTopic.status != "mastered").all()
    topics.sort(key=lambda t: (-(t.priority_score or 0), t.mastery_score or 0))
    return [
        {
            "id": topic.id,
            "title": topic.title,
            "module": topic.module,
            "priority": topic.priority,
            "mastery": round(topic.mastery_score or 0, 1),
            "subject_id": topic.subject_id,
            "status": topic.status,
        }
        for topic in topics[:limit]
    ]


def analytics_overview(db: Session) -> dict:
    now = utcnow()
    week_ago = now - timedelta(days=7)
    today_start = datetime.combine(date.today(), datetime.min.time())
    attempts = db.query(QuizAttempt).order_by(QuizAttempt.completed_at.desc()).all()
    avg_quiz = round(sum(a.percent or 0 for a in attempts) / len(attempts), 1) if attempts else 0.0
    topics = db.query(SyllabusTopic).all()
    mastered = len([t for t in topics if t.status == "mastered"])
    mastered_high = len([t for t in topics if (t.mastery_score or 0) >= 85])
    studied = len([t for t in topics if t.status in {"in_progress", "learned", "mastered"}])
    revision = revision_stats(db)
    hours_week = round(study_minutes(db, week_ago) / 60, 1)
    hours_today = round(study_minutes(db, today_start) / 60, 1)
    subject_rows = subject_progress(db)
    readiness = round(
        sum(row["readiness"] * max(1, row["topics"]) for row in subject_rows)
        / max(1, sum(max(1, row["topics"]) for row in subject_rows)),
        1,
    ) if subject_rows else 0.0
    return {
        "hours_week": hours_week,
        "hours_today": hours_today,
        "total_topics": len(topics),
        "studied_topics": studied,
        "mastered_topics": mastered,
        "mastered_high": mastered_high,
        "quiz_attempts": len(attempts),
        "quiz_average": avg_quiz,
        "streak_days": streak_days(db),
        "revision": revision,
        "subjects": subject_rows,
        "semesters": semester_progress(db),
        "daily": daily_minutes(db, 7),
        "weak_topics": weak_topics(db),
        "recent_attempts": [
            {
                "id": attempt.id,
                "quiz_id": attempt.quiz_id,
                "percent": attempt.percent,
                "score": attempt.score,
                "max_score": attempt.max_score,
                "completed_at": attempt.completed_at.isoformat() + "Z" if attempt.completed_at else None,
            }
            for attempt in attempts[:8]
        ],
        "exam_readiness": readiness,
        "readiness_note": "Readiness is an estimate from mastery, quiz performance and material coverage. It is not a guarantee of examination results.",
    }


def dashboard(db: Session) -> dict:
    settings = get_settings(db)
    overview = analytics_overview(db)
    now = datetime.now()
    hour = now.hour
    greeting = "Good morning" if hour < 12 else "Good afternoon" if hour < 17 else "Good evening"
    name = settings.get("student_name") or "Engineer"
    ranked = ranked_topics(db)
    next_topic = ranked[0]["topic"] if ranked else None
    recent_topic = (
        db.query(SyllabusTopic)
        .filter(SyllabusTopic.status.in_(["in_progress", "learned"]))
        .order_by(SyllabusTopic.last_studied_at.desc().nullslast())
        .first()
    )
    continue_topic = recent_topic or next_topic
    due_cards = db.query(Flashcard).filter(Flashcard.due_date <= utcnow() + timedelta(days=1)).count()
    exams = db.query(Exam).filter(Exam.exam_date >= date.today()).order_by(Exam.exam_date).limit(5).all()
    today_sessions = db.query(ScheduleSession).filter(ScheduleSession.date == date.today()).order_by(ScheduleSession.start_time).all()
    goal = int(settings.get("daily_goal_minutes") or 120)
    today_minutes = study_minutes(db, datetime.combine(date.today(), datetime.min.time()))
    mission = None
    if due_cards:
        mission = {
            "kind": "revision",
            "title": f"Review {due_cards} due flashcard{'s' if due_cards != 1 else ''}",
            "detail": "Spaced repetition keeps earlier topics from fading.",
            "action": "revision",
            "topic_id": None,
        }
    elif next_topic:
        mission = {
            "kind": "learn",
            "title": next_topic.title,
            "detail": f"{next_topic.module} · priority {next_topic.priority.upper()} · mastery {round(next_topic.mastery_score or 0)}%",
            "action": "learn",
            "topic_id": next_topic.id,
        }
    unread = db.query(Notification).filter(Notification.read == False).count()  # noqa: E712
    subject_names = {subject.id: subject.name for subject in db.query(Subject).all()}
    return {
        "greeting": greeting,
        "student_name": name,
        "daily_goal_minutes": goal,
        "today_minutes": today_minutes,
        "mission": mission,
        "continue_topic": {
            "id": continue_topic.id,
            "title": continue_topic.title,
            "module": continue_topic.module,
            "subject_id": continue_topic.subject_id,
            "subject": subject_names.get(continue_topic.subject_id, "General"),
            "mastery": round(continue_topic.mastery_score or 0, 1),
            "priority": continue_topic.priority,
            "status": continue_topic.status,
        } if continue_topic else None,
        "upcoming_exams": [
            {
                "id": exam.id,
                "title": exam.title,
                "subject": subject_names.get(exam.subject_id, ""),
                "date": exam.exam_date.isoformat(),
                "days_left": (exam.exam_date - date.today()).days,
            }
            for exam in exams
        ],
        "today_plan": [
            {
                "id": session.id,
                "start_time": session.start_time,
                "duration_minutes": session.duration_minutes,
                "kind": session.kind,
                "status": session.status,
                "rationale": session.rationale,
                "topic_id": session.topic_id,
            }
            for session in today_sessions
        ],
        "unread_notifications": unread,
        "stats": {
            "hours_week": overview["hours_week"],
            "hours_today": overview["hours_today"],
            "streak_days": overview["streak_days"],
            "mastered_topics": overview["mastered_topics"],
            "topics_mastered_high": overview["mastered_high"],
            "quiz_average": overview["quiz_average"],
            "due_flashcards": due_cards,
            "exam_readiness": overview["exam_readiness"],
        },
        "subjects": overview["subjects"],
        "semesters": overview["semesters"],
        "daily": overview["daily"],
        "weak_topics": overview["weak_topics"],
        "revision": overview["revision"],
        "has_data": bool(overview["total_topics"] or overview["subjects"]),
    }
