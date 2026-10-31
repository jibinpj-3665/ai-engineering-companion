from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    code = Column(String(60), default="")
    semester = Column(String(40), default="")
    department = Column(String(120), default="")
    description = Column(Text, default="")
    color = Column(String(20), default="violet")
    created_at = Column(DateTime, default=utcnow)

    documents = relationship("Document", back_populates="subject", cascade="all, delete-orphan")
    topics = relationship("SyllabusTopic", back_populates="subject", cascade="all, delete-orphan")
    exams = relationship("Exam", back_populates="subject", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True, index=True)
    filename = Column(String(300), nullable=False)
    stored_path = Column(String(500), nullable=False)
    mime_type = Column(String(120), default="application/octet-stream")
    size_bytes = Column(Integer, default=0)
    status = Column(String(20), default="queued", index=True)
    error = Column(Text, default="")
    page_count = Column(Integer, default=0)
    doc_kind = Column(String(30), default="notes")
    pages_json = Column(Text, default="[]")
    created_at = Column(DateTime, default=utcnow)
    processed_at = Column(DateTime, nullable=True)

    subject = relationship("Subject", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "chunks"

    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), index=True)
    page = Column(Integer, default=1)
    heading = Column(String(300), default="")
    content = Column(Text, nullable=False)
    embedding = Column(Text, default="[]")
    embed_provider = Column(String(60), default="local")
    created_at = Column(DateTime, default=utcnow)

    document = relationship("Document", back_populates="chunks")


class SyllabusTopic(Base):
    __tablename__ = "syllabus_topics"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    module = Column(String(120), default="General")
    unit = Column(String(120), default="")
    title = Column(String(300), nullable=False)
    description = Column(Text, default="")
    learning_outcome = Column(Text, default="")
    priority = Column(String(20), default="medium", index=True)
    priority_score = Column(Float, default=50.0)
    priority_reason = Column(Text, default="")
    marks = Column(Integer, default=0)
    exam_frequency = Column(Float, default=0.0)
    source_document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), default="not_started", index=True)
    mastery_score = Column(Float, default=0.0)
    last_studied_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    subject = relationship("Subject", back_populates="topics")


class TeachingSession(Base):
    __tablename__ = "teaching_sessions"

    id = Column(Integer, primary_key=True)
    topic_id = Column(Integer, ForeignKey("syllabus_topics.id", ondelete="CASCADE"), unique=True)
    phases_json = Column(Text, default="{}")
    viewed_phases = Column(Text, default="[]")
    progress_percent = Column(Float, default=0.0)
    mastery_passed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(300), default="New conversation")
    personality = Column(String(40), default="study_buddy")
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role = Column(String(20), default="user")
    content = Column(Text, default="")
    sources_json = Column(Text, default="[]")
    mode = Column(String(30), default="chat")
    created_at = Column(DateTime, default=utcnow)

    conversation = relationship("Conversation", back_populates="messages")


class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    topic_id = Column(Integer, ForeignKey("syllabus_topics.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(300), nullable=False)
    mode = Column(String(30), default="quick")
    difficulty = Column(String(20), default="mixed")
    generator = Column(String(20), default="offline")
    duration_minutes = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)

    questions = relationship("QuizQuestion", back_populates="quiz", cascade="all, delete-orphan")


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(Integer, primary_key=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id", ondelete="CASCADE"), index=True)
    qtype = Column(String(30), default="mcq")
    prompt = Column(Text, nullable=False)
    options_json = Column(Text, default="[]")
    correct_answer = Column(Text, default="")
    explanation = Column(Text, default="")
    marks = Column(Integer, default=1)
    source_json = Column(Text, default="{}")
    position = Column(Integer, default=0)

    quiz = relationship("Quiz", back_populates="questions")


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id = Column(Integer, primary_key=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id", ondelete="CASCADE"), index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    topic_id = Column(Integer, ForeignKey("syllabus_topics.id", ondelete="SET NULL"), nullable=True)
    answers_json = Column(Text, default="{}")
    score = Column(Float, default=0)
    max_score = Column(Float, default=0)
    percent = Column(Float, default=0)
    feedback_json = Column(Text, default="[]")
    duration_seconds = Column(Integer, default=0)
    started_at = Column(DateTime, default=utcnow)
    completed_at = Column(DateTime, default=utcnow)


class Flashcard(Base):
    __tablename__ = "flashcards"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    topic_id = Column(Integer, ForeignKey("syllabus_topics.id", ondelete="SET NULL"), nullable=True)
    front = Column(Text, nullable=False)
    back = Column(Text, nullable=False)
    source_json = Column(Text, default="{}")
    ease = Column(Float, default=2.5)
    interval_days = Column(Float, default=0)
    repetitions = Column(Integer, default=0)
    due_date = Column(DateTime, default=utcnow)
    last_reviewed_at = Column(DateTime, nullable=True)
    total_reviews = Column(Integer, default=0)
    lapses = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)


class StudySession(Base):
    __tablename__ = "study_sessions"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True, index=True)
    topic_id = Column(Integer, ForeignKey("syllabus_topics.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(30), default="focus")
    duration_minutes = Column(Float, default=0)
    started_at = Column(DateTime, default=utcnow)
    ended_at = Column(DateTime, default=utcnow)
    notes = Column(Text, default="")


class Exam(Base):
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    title = Column(String(300), default="Examination")
    exam_date = Column(Date, nullable=False)
    weight = Column(Float, default=0)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)

    subject = relationship("Subject", back_populates="exams")


class ScheduleSession(Base):
    __tablename__ = "schedule_sessions"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    topic_id = Column(Integer, ForeignKey("syllabus_topics.id", ondelete="SET NULL"), nullable=True)
    date = Column(Date, nullable=False, index=True)
    start_time = Column(String(10), default="18:00")
    duration_minutes = Column(Integer, default=50)
    kind = Column(String(30), default="study")
    status = Column(String(20), default="planned")
    rationale = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)


class Preference(Base):
    __tablename__ = "preferences"

    key = Column(String(80), primary_key=True)
    value = Column(Text, default="")


class Secret(Base):
    __tablename__ = "secrets"

    key = Column(String(80), primary_key=True)
    encrypted_value = Column(Text, default="")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    body = Column(Text, default="")
    kind = Column(String(30), default="info")
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class SavedQuestion(Base):
    __tablename__ = "saved_questions"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    topic_id = Column(Integer, ForeignKey("syllabus_topics.id", ondelete="SET NULL"), nullable=True)
    qtype = Column(String(30), default="short")
    prompt = Column(Text, nullable=False)
    answer = Column(Text, default="")
    explanation = Column(Text, default="")
    source_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=utcnow)


class LabArtifact(Base):
    __tablename__ = "lab_artifacts"

    id = Column(Integer, primary_key=True)
    lab_slug = Column(String(120), unique=True, nullable=False)
    language = Column(String(30), default="python")
    code = Column(Text, default="")
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
