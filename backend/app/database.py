from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import DATABASE_URL, ensure_directories

ensure_directories()

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

SCHEMA_VERSION = 3


def run_migrations() -> None:
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"))
        row = connection.execute(text("SELECT version FROM schema_version LIMIT 1")).fetchone()
        if row is None:
            connection.execute(text("INSERT INTO schema_version (version) VALUES (:v)"), {"v": SCHEMA_VERSION})
            return
        current = row[0]
        if current < 2:
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_chunks_embedding_provider ON chunks (embed_provider)"))
        if current < 3:
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_flashcards_due ON flashcards (due_date)"))
        if current != SCHEMA_VERSION:
            connection.execute(text("UPDATE schema_version SET version = :v"), {"v": SCHEMA_VERSION})


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    run_migrations()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
