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


class TenantMixin:
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(320), unique=True, nullable=False, index=True)
    name = Column(String(200), default="Engineer")
    password_hash = Column(String(300), default="")
    is_local = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    last_login_at = Column(DateTime, nullable=True)
    password_changed_at = Column(DateTime, nullable=True)


class UserSession(Base):
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow)
    last_seen_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime, nullable=False, index=True)
    user_agent = Column(String(300), default="")
    ip_address = Column(String(80), default="")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class AIUsageLog(Base):
    __tablename__ = "ai_usage_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(40), default="")
    model = Column(String(120), default="")
    operation = Column(String(40), default="chat")
    status = Column(String(20), default="ok")
    input_chars = Column(Integer, default=0)
    output_chars = Column(Integer, default=0)
    latency_ms = Column(Integer, default=0)
    error = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)


class Subject(TenantMixin, Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    code = Column(String(60), default="")
    semester = Column(String(40), default="")
    department = Column(String(120), default="")
    description = Column(Text, default="")
    color = Column(String(20), default="violet")
    academic_year = Column(String(40), default="")
    credits = Column(Integer, default=0)
    ltp = Column(String(40), default="")
    preamble = Column(Text, default="")
    prerequisites = Column(Text, default="")
    corequisites = Column(Text, default="")
    semester_source = Column(String(30), default="")
    assessment_json = Column(Text, default="{}")
    books_json = Column(Text, default="{}")
    syllabus_updated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    documents = relationship("Document", back_populates="subject", cascade="all, delete-orphan")
    topics = relationship("SyllabusTopic", back_populates="subject", cascade="all, delete-orphan")
    modules = relationship("SyllabusModule", back_populates="subject", cascade="all, delete-orphan")
    outcomes = relationship("SyllabusCourseOutcome", back_populates="subject", cascade="all, delete-orphan")
    exams = relationship("Exam", back_populates="subject", cascade="all, delete-orphan")


class SyllabusImportBatch(TenantMixin, Base):
    __tablename__ = "syllabus_import_batches"

    id = Column(Integer, primary_key=True)
    source_root = Column(String(1000), default="")
    status = Column(String(64), default="discovering", index=True)
    total_files = Column(Integer, default=0)
    imported_files = Column(Integer, default=0)
    duplicate_files = Column(Integer, default=0)
    unsupported_files = Column(Integer, default=0)
    skipped_files = Column(Integer, default=0)
    failed_files = Column(Integer, default=0)
    manifest_json = Column(Text, default="[]")
    error = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)
    completed_at = Column(DateTime, nullable=True)


class Document(TenantMixin, Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True, index=True)
    filename = Column(String(300), nullable=False)
    stored_path = Column(String(500), nullable=False)
    mime_type = Column(String(120), default="application/octet-stream")
    size_bytes = Column(Integer, default=0)
    status = Column(String(20), default="queued", index=True)
    stage = Column(String(255), default="queued")
    progress = Column(Integer, default=0)
    error = Column(Text, default="")
    page_count = Column(Integer, default=0)
    doc_kind = Column(String(30), default="notes")
    pages_json = Column(Text, default="[]")
    sha256 = Column(String(64), default="", index=True)
    source_path = Column(Text, default="")
    source_identity = Column(String(1000), default="")
    academic_year = Column(String(40), default="")
    semester = Column(String(40), default="")
    semester_confidence = Column(String(30), default="")
    import_batch_id = Column(Integer, ForeignKey("syllabus_import_batches.id", ondelete="SET NULL"), nullable=True)
    version = Column(Integer, default=1)
    active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=utcnow)
    processed_at = Column(DateTime, nullable=True)

    subject = relationship("Subject", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class SyllabusModule(TenantMixin, Base):
    __tablename__ = "syllabus_modules"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    number = Column(Integer, default=1)
    label = Column(String(80), default="")
    title = Column(String(300), default="")
    description = Column(Text, default="")
    lecture_hours = Column(Integer, default=0)
    tutorial_hours = Column(Integer, default=0)
    practical_hours = Column(Integer, default=0)
    self_study_hours = Column(Integer, default=0)
    page_start = Column(Integer, default=1)
    page_end = Column(Integer, default=1)
    created_at = Column(DateTime, default=utcnow)

    subject = relationship("Subject", back_populates="modules")


class SyllabusCourseOutcome(TenantMixin, Base):
    __tablename__ = "syllabus_course_outcomes"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    code = Column(String(20), default="CO1")
    description = Column(Text, default="")
    bloom_level = Column(String(60), default="")
    po_json = Column(Text, default="{}")
    page = Column(Integer, default=1)
    created_at = Column(DateTime, default=utcnow)

    subject = relationship("Subject", back_populates="outcomes")


class DocumentChunk(TenantMixin, Base):
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


class SyllabusTopic(TenantMixin, Base):
    __tablename__ = "syllabus_topics"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    module = Column(String(120), default="General")
    module_id = Column(Integer, ForeignKey("syllabus_modules.id", ondelete="SET NULL"), nullable=True)
    unit = Column(String(120), default="")
    topic_number = Column(String(20), default="")
    content_type = Column(String(30), default="topic")
    title = Column(String(300), nullable=False)
    description = Column(Text, default="")
    learning_outcome = Column(Text, default="")
    priority = Column(String(20), default="medium", index=True)
    priority_score = Column(Float, default=50.0)
    priority_reason = Column(Text, default="")
    marks = Column(Integer, default=0)
    exam_frequency = Column(Float, default=0.0)
    source_document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    source_page = Column(Integer, default=0)
    status = Column(String(20), default="not_started", index=True)
    mastery_score = Column(Float, default=0.0)
    last_studied_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    subject = relationship("Subject", back_populates="topics")


class TeachingSession(TenantMixin, Base):
    __tablename__ = "teaching_sessions"

    id = Column(Integer, primary_key=True)
    topic_id = Column(Integer, ForeignKey("syllabus_topics.id", ondelete="CASCADE"), unique=True)
    phases_json = Column(Text, default="{}")
    viewed_phases = Column(Text, default="[]")
    progress_percent = Column(Float, default=0.0)
    mastery_passed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class Conversation(TenantMixin, Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(300), default="New conversation")
    personality = Column(String(40), default="study_buddy")
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")


class Message(TenantMixin, Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role = Column(String(20), default="user")
    content = Column(Text, default="")
    sources_json = Column(Text, default="[]")
    mode = Column(String(30), default="chat")
    created_at = Column(DateTime, default=utcnow)

    conversation = relationship("Conversation", back_populates="messages")


class Quiz(TenantMixin, Base):
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


class QuizQuestion(TenantMixin, Base):
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


class QuizAttempt(TenantMixin, Base):
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


class Flashcard(TenantMixin, Base):
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


class StudySession(TenantMixin, Base):
    __tablename__ = "study_sessions"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True, index=True)
    topic_id = Column(Integer, ForeignKey("syllabus_topics.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(30), default="focus")
    duration_minutes = Column(Float, default=0)
    started_at = Column(DateTime, default=utcnow)
    ended_at = Column(DateTime, default=utcnow)
    notes = Column(Text, default="")


class Exam(TenantMixin, Base):
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), index=True)
    title = Column(String(300), default="Examination")
    exam_date = Column(Date, nullable=False)
    weight = Column(Float, default=0)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)

    subject = relationship("Subject", back_populates="exams")


class ScheduleSession(TenantMixin, Base):
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


class Preference(TenantMixin, Base):
    __tablename__ = "preferences"

    key = Column(String(80), primary_key=True)
    value = Column(Text, default="")


class Secret(TenantMixin, Base):
    __tablename__ = "secrets"

    key = Column(String(80), primary_key=True)
    encrypted_value = Column(Text, default="")


class Notification(TenantMixin, Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    body = Column(Text, default="")
    kind = Column(String(30), default="info")
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class SavedQuestion(TenantMixin, Base):
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


class LabArtifact(TenantMixin, Base):
    __tablename__ = "lab_artifacts"

    id = Column(Integer, primary_key=True)
    lab_slug = Column(String(120), unique=True, nullable=False)
    language = Column(String(30), default="python")
    code = Column(Text, default="")
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
