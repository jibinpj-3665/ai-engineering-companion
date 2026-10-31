from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Exam, ScheduleSession, StudySession, Subject, SyllabusTopic, utcnow


def _days_until(exam_date: date) -> int:
    return (exam_date - date.today()).days


def ranked_topics(db: Session) -> List[dict]:
    topics = db.query(SyllabusTopic).all()
    exams = db.query(Exam).filter(Exam.exam_date >= date.today()).all()
    nearest = {}
    for exam in exams:
        current = nearest.get(exam.subject_id)
        if current is None or exam.exam_date < current:
            nearest[exam.subject_id] = exam.exam_date
    ranked = []
    for topic in topics:
        mastery = topic.mastery_score or 0
        priority = topic.priority_score or 50
        urgency = 0
        exam_date = nearest.get(topic.subject_id)
        if exam_date:
            days = _days_until(exam_date)
            urgency = max(0, 30 - days) * 1.2
        score = priority * 0.55 + (100 - mastery) * 0.35 + urgency
        if topic.status == "mastered" and mastery >= 85:
            score -= 45
        ranked.append({
            "topic": topic,
            "score": round(score, 2),
            "exam_date": exam_date,
            "mastery": mastery,
        })
    ranked.sort(key=lambda item: item["score"], reverse=True)
    return ranked


def generate_plan(db: Session, daily_minutes: int = 120, start: Optional[date] = None, horizon_days: int = 14) -> List[ScheduleSession]:
    start = start or date.today()
    horizon_days = max(1, min(horizon_days, 60))
    daily_minutes = max(25, min(daily_minutes, 720))
    ranked = ranked_topics(db)
    if not ranked:
        raise ValueError("Add syllabus topics before generating a study plan.")

    exams = db.query(Exam).filter(Exam.exam_date >= start).order_by(Exam.exam_date).all()
    end = start + timedelta(days=horizon_days - 1)
    if exams:
        earliest = min(exam.exam_date for exam in exams)
        if start <= earliest < end:
            end = earliest

    db.query(ScheduleSession).filter(
        ScheduleSession.date >= start,
        ScheduleSession.status == "planned",
    ).delete(synchronize_session=False)

    block = 50 if daily_minutes >= 100 else 25
    sessions_per_day = max(1, daily_minutes // block)
    created: List[ScheduleSession] = []
    topic_index = 0
    day = start
    while day <= end:
        slots = min(sessions_per_day, 6)
        start_hour = 18
        for slot in range(slots):
            if not ranked:
                break
            entry = ranked[topic_index % len(ranked)]
            topic = entry["topic"]
            subject = db.get(Subject, topic.subject_id) if topic.subject_id else None
            reason_bits = [
                f"priority score {round(topic.priority_score or 50)}",
                f"mastery {round(topic.mastery_score or 0)}%",
            ]
            if entry["exam_date"]:
                days_left = _days_until(entry["exam_date"])
                reason_bits.append(f"{days_left} day(s) to exam")
            if topic.priority == "high":
                reason_bits.append("high-priority syllabus topic")
            session = ScheduleSession(
                subject_id=topic.subject_id,
                topic_id=topic.id,
                date=day,
                start_time=f"{start_hour + (slot * block) // 60:02d}:{((slot * block) % 60):02d}",
                duration_minutes=block,
                kind="deep_work" if block == 50 else "focus",
                status="planned",
                rationale=(
                    f"{topic.title} ({subject.name if subject else 'General'}) — " + ", ".join(reason_bits)
                    + ". Schedule adapts from current mastery and exam dates, not a prediction of exam content."
                ),
            )
            db.add(session)
            created.append(session)
            topic_index += 1
        day += timedelta(days=1)

    for session in db.query(ScheduleSession).filter(ScheduleSession.date < date.today(), ScheduleSession.status == "planned").all():
        session.status = "missed"
    db.commit()
    for session in created:
        db.refresh(session)
    return created


def mark_missed(db: Session) -> int:
    count = 0
    for session in db.query(ScheduleSession).filter(ScheduleSession.date < date.today(), ScheduleSession.status == "planned").all():
        session.status = "missed"
        count += 1
    db.commit()
    return count


def log_study_session(db: Session, subject_id: Optional[int], topic_id: Optional[int], kind: str, minutes: float, notes: str = "") -> StudySession:
    minutes = max(0.1, min(float(minutes), 600))
    ended = utcnow()
    started = ended - timedelta(minutes=minutes)
    record = StudySession(
        subject_id=subject_id,
        topic_id=topic_id,
        kind=kind[:30],
        duration_minutes=round(minutes, 1),
        started_at=started,
        ended_at=ended,
        notes=notes[:1000],
    )
    db.add(record)
    if topic_id:
        topic = db.get(SyllabusTopic, topic_id)
        if topic:
            topic.last_studied_at = ended
            if topic.status == "not_started":
                topic.status = "in_progress"
    db.commit()
    db.refresh(record)
    return record
