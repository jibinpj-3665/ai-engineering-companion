from contextvars import ContextVar
from typing import Optional

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker, with_loader_criteria

from .config import DATABASE_URL, auth_required, ensure_directories

ensure_directories()

IS_SQLITE = DATABASE_URL.startswith("sqlite")

engine_kwargs = {"pool_pre_ping": True}
if IS_SQLITE:
    engine_kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
else:
    engine_kwargs["pool_size"] = 5
    engine_kwargs["max_overflow"] = 5
engine = create_engine(DATABASE_URL, **engine_kwargs)

if IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

SCHEMA_VERSION = 6

current_user_id: ContextVar[Optional[int]] = ContextVar("aec_current_user_id", default=None)
TENANT_MODEL_NAMES = [
    "Subject",
    "Document",
    "DocumentChunk",
    "SyllabusTopic",
    "SyllabusImportBatch",
    "SyllabusModule",
    "SyllabusCourseOutcome",
    "TeachingSession",
    "Conversation",
    "Message",
    "Quiz",
    "QuizQuestion",
    "QuizAttempt",
    "Flashcard",
    "StudySession",
    "Exam",
    "ScheduleSession",
    "Preference",
    "Secret",
    "Notification",
    "SavedQuestion",
    "LabArtifact",
    "AIUsageLog",
]
TENANT_TABLE_NAMES = [
    "subjects",
    "documents",
    "chunks",
    "syllabus_topics",
    "syllabus_import_batches",
    "syllabus_modules",
    "syllabus_course_outcomes",
    "teaching_sessions",
    "conversations",
    "messages",
    "quizzes",
    "quiz_questions",
    "quiz_attempts",
    "flashcards",
    "study_sessions",
    "exams",
    "schedule_sessions",
    "preferences",
    "secrets",
    "notifications",
    "saved_questions",
    "lab_artifacts",
    "ai_usage_logs",
]


def _tenant_models():
    from . import models

    return [getattr(models, name) for name in TENANT_MODEL_NAMES]


@event.listens_for(SessionLocal, "do_orm_execute")
def _apply_tenant_filter(execute_state) -> None:
    if execute_state.execution_options.get("include_all_users"):
        return
    if not execute_state.is_select:
        return
    uid = current_user_id.get()
    if uid is None:
        return
    statement = execute_state.statement
    for model in _tenant_models():
        statement = statement.options(
            with_loader_criteria(model, model.user_id == uid, include_aliases=True)
        )
    execute_state.statement = statement


@event.listens_for(SessionLocal, "before_flush")
def _stamp_tenant(session: Session, flush_context, instances) -> None:
    uid = current_user_id.get()
    if uid is None:
        return
    for obj in session.new:
        if hasattr(type(obj), "user_id") and getattr(obj, "user_id", None) is None:
            obj.user_id = uid


def set_current_user(user_id: Optional[int]):
    return current_user_id.set(user_id)


def reset_current_user(token) -> None:
    current_user_id.reset(token)


def run_migrations() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"))
        if "users" not in tables:
            return
        for table in TENANT_TABLE_NAMES:
            if table not in tables:
                continue
            columns = {column["name"] for column in inspector.get_columns(table)}
            if "user_id" not in columns:
                connection.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
                )
            connection.execute(
                text(f"CREATE INDEX IF NOT EXISTS ix_{table}_user_id ON {table} (user_id)")
            )
        if "documents" in tables:
            document_columns = {column["name"] for column in inspector.get_columns("documents")}
            if "stage" not in document_columns:
                connection.execute(text("ALTER TABLE documents ADD COLUMN stage VARCHAR(40) DEFAULT 'queued'"))
                connection.execute(
                    text(
                        "UPDATE documents SET stage = CASE "
                        "WHEN status = 'ready' THEN 'ready' "
                        "WHEN status = 'failed' THEN 'failed' "
                        "WHEN status = 'processing' THEN 'indexing' "
                        "ELSE 'queued' END"
                    )
                )
            if "progress" not in document_columns:
                connection.execute(text("ALTER TABLE documents ADD COLUMN progress INTEGER DEFAULT 0"))
                connection.execute(
                    text(
                        "UPDATE documents SET progress = CASE "
                        "WHEN status = 'ready' THEN 100 "
                        "WHEN status = 'failed' THEN 100 "
                        "WHEN status = 'processing' THEN 60 "
                        "ELSE 5 END"
                    )
                )
            document_additions = {
                "sha256": "VARCHAR(64) DEFAULT ''",
                "source_path": "TEXT DEFAULT ''",
                "source_identity": "VARCHAR(1000) DEFAULT ''",
                "academic_year": "VARCHAR(40) DEFAULT ''",
                "semester": "VARCHAR(40) DEFAULT ''",
                "semester_confidence": "VARCHAR(30) DEFAULT ''",
                "import_batch_id": "INTEGER",
                "version": "INTEGER DEFAULT 1",
                "active": "BOOLEAN DEFAULT 1",
            }
            for column, definition in document_additions.items():
                if column not in document_columns:
                    connection.execute(text(f"ALTER TABLE documents ADD COLUMN {column} {definition}"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_documents_sha256 ON documents (sha256)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_documents_active ON documents (active)"))
        if "subjects" in tables:
            subject_columns = {column["name"] for column in inspector.get_columns("subjects")}
            subject_additions = {
                "academic_year": "VARCHAR(40) DEFAULT ''",
                "credits": "INTEGER DEFAULT 0",
                "ltp": "VARCHAR(40) DEFAULT ''",
                "preamble": "TEXT DEFAULT ''",
                "prerequisites": "TEXT DEFAULT ''",
                "corequisites": "TEXT DEFAULT ''",
                "semester_source": "VARCHAR(30) DEFAULT ''",
                "assessment_json": "TEXT DEFAULT '{}'",
                "books_json": "TEXT DEFAULT '{}'",
                "syllabus_updated_at": "DATETIME",
            }
            for column, definition in subject_additions.items():
                if column not in subject_columns:
                    connection.execute(text(f"ALTER TABLE subjects ADD COLUMN {column} {definition}"))
        if "syllabus_topics" in tables:
            topic_columns = {column["name"] for column in inspector.get_columns("syllabus_topics")}
            topic_additions = {
                "module_id": "INTEGER",
                "topic_number": "VARCHAR(20) DEFAULT ''",
                "content_type": "VARCHAR(30) DEFAULT 'topic'",
                "source_page": "INTEGER DEFAULT 0",
            }
            for column, definition in topic_additions.items():
                if column not in topic_columns:
                    connection.execute(text(f"ALTER TABLE syllabus_topics ADD COLUMN {column} {definition}"))
        if "chunks" in tables:
            if "documents" in tables:
                connection.execute(
                    text(
                        "UPDATE chunks SET subject_id = "
                        "(SELECT documents.subject_id FROM documents WHERE documents.id = chunks.document_id) "
                        "WHERE chunks.subject_id IS NULL AND EXISTS "
                        "(SELECT 1 FROM documents WHERE documents.id = chunks.document_id "
                        "AND documents.subject_id IS NOT NULL)"
                    )
                )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_chunks_embedding_provider ON chunks (embed_provider)"))
        if "flashcards" in tables:
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_flashcards_due ON flashcards (due_date)"))
        row = connection.execute(text("SELECT version FROM schema_version LIMIT 1")).fetchone()
        if row is None:
            connection.execute(text("INSERT INTO schema_version (version) VALUES (:v)"), {"v": SCHEMA_VERSION})
        elif row[0] != SCHEMA_VERSION:
            connection.execute(text("UPDATE schema_version SET version = :v"), {"v": SCHEMA_VERSION})


def claim_legacy_data(user_id: int) -> int:
    claimed = 0
    with engine.begin() as connection:
        for table in TENANT_TABLE_NAMES:
            result = connection.execute(
                text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL"), {"uid": user_id}
            )
            claimed += result.rowcount or 0
    return claimed


def count_users() -> int:
    from .models import User

    db = SessionLocal()
    try:
        return db.query(User).count()
    finally:
        db.close()


def init_db(create_local_user: bool = True) -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    run_migrations()
    if create_local_user and not auth_required():
        from .services.auth import ensure_local_user

        db = SessionLocal()
        try:
            ensure_local_user(db, claim_legacy=True)
        finally:
            db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
