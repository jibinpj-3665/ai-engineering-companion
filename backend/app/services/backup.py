import json
import shutil
import uuid
import zipfile
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, text
from sqlalchemy.orm import Session

from ..config import BACKUP_DIR, DATABASE_URL, UPLOAD_DIR, VERSION
from ..database import SCHEMA_VERSION, current_user_id
from ..models import (
    AIUsageLog,
    Conversation,
    Document,
    DocumentChunk,
    Exam,
    Flashcard,
    LabArtifact,
    Message,
    Notification,
    Preference,
    Quiz,
    QuizAttempt,
    QuizQuestion,
    SavedQuestion,
    ScheduleSession,
    Secret,
    StudySession,
    Subject,
    SyllabusTopic,
    TeachingSession,
    User,
    UserSession,
)

FORMAT = "aec-backup-v2"
MAX_RESTORE_BYTES = 500 * 1024 * 1024
IS_POSTGRESQL = str(DATABASE_URL).startswith("postgresql")

EXPORT_ORDER = [
    ("subjects", Subject),
    ("documents", Document),
    ("chunks", DocumentChunk),
    ("syllabus_topics", SyllabusTopic),
    ("teaching_sessions", TeachingSession),
    ("conversations", Conversation),
    ("messages", Message),
    ("quizzes", Quiz),
    ("quiz_questions", QuizQuestion),
    ("quiz_attempts", QuizAttempt),
    ("flashcards", Flashcard),
    ("study_sessions", StudySession),
    ("exams", Exam),
    ("schedule_sessions", ScheduleSession),
    ("notifications", Notification),
    ("saved_questions", SavedQuestion),
    ("lab_artifacts", LabArtifact),
    ("preferences", Preference),
]

FK_MAP = {
    "documents": {"subject_id": "subjects"},
    "chunks": {"document_id": "documents", "subject_id": "subjects"},
    "syllabus_topics": {"subject_id": "subjects", "source_document_id": "documents"},
    "teaching_sessions": {"topic_id": "syllabus_topics"},
    "conversations": {"subject_id": "subjects"},
    "messages": {"conversation_id": "conversations"},
    "quizzes": {"subject_id": "subjects", "topic_id": "syllabus_topics"},
    "quiz_questions": {"quiz_id": "quizzes"},
    "quiz_attempts": {"quiz_id": "quizzes", "subject_id": "subjects", "topic_id": "syllabus_topics"},
    "flashcards": {"subject_id": "subjects", "topic_id": "syllabus_topics"},
    "study_sessions": {"subject_id": "subjects", "topic_id": "syllabus_topics"},
    "exams": {"subject_id": "subjects"},
    "schedule_sessions": {"subject_id": "subjects", "topic_id": "syllabus_topics"},
    "saved_questions": {"subject_id": "subjects", "topic_id": "syllabus_topics"},
}

DELETE_ORDER = [
    Message,
    QuizQuestion,
    QuizAttempt,
    Flashcard,
    DocumentChunk,
    ScheduleSession,
    SavedQuestion,
    TeachingSession,
    Quiz,
    SyllabusTopic,
    Document,
    Conversation,
    Exam,
    StudySession,
    Subject,
    Notification,
    LabArtifact,
    Preference,
    Secret,
    AIUsageLog,
]


def _current_uid() -> int:
    uid = current_user_id.get()
    if uid is None:
        raise RuntimeError("Backup requires an authenticated user context.")
    return uid


def _serialize(value):
    if isinstance(value, datetime):
        return {"__type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"__type": "date", "value": value.isoformat()}
    return value


def _deserialize(value, column):
    if isinstance(value, dict) and value.get("__type") == "datetime":
        return datetime.fromisoformat(value["value"])
    if isinstance(value, dict) and value.get("__type") == "date":
        return date.fromisoformat(value["value"])
    if isinstance(column.type, DateTime) and isinstance(value, str):
        return datetime.fromisoformat(value)
    if isinstance(column.type, Date) and isinstance(value, str):
        return date.fromisoformat(value)
    if isinstance(column.type, Boolean):
        return bool(value)
    if isinstance(column.type, Integer) and value is not None:
        return int(value)
    if isinstance(column.type, Float) and value is not None:
        return float(value)
    return value


def _logical_preference_key(key: str) -> str:
    if key.startswith("u") and ":" in key:
        prefix, rest = key.split(":", 1)
        if prefix[1:].isdigit():
            return rest
    return key


def export_user_backup(db: Session) -> Path:
    uid = _current_uid()
    user = db.get(User, uid)
    if not user:
        raise RuntimeError("User not found.")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"ai-engineering-companion-{stamp}.zip"
    data = {}
    upload_paths = []
    for name, model in EXPORT_ORDER:
        rows = []
        for obj in db.query(model).all():
            row = {}
            for column in model.__table__.columns:
                if column.name in {"user_id"}:
                    continue
                value = getattr(obj, column.name)
                if isinstance(obj, Preference) and column.name == "key":
                    value = _logical_preference_key(value or "")
                if isinstance(obj, LabArtifact) and column.name == "lab_slug" and ":" in (value or ""):
                    value = value.split(":", 1)[1]
                row[column.name] = _serialize(value)
            rows.append(row)
            if isinstance(obj, Document):
                path = Path(obj.stored_path or "")
                if path.is_file() and path.resolve().is_relative_to(UPLOAD_DIR.resolve()):
                    upload_paths.append((obj.id, path))
        data[name] = rows
    upload_names = {}
    upload_entries = []
    document_uploads = {}
    for document_id, path in upload_paths:
        name = path.name
        if name in upload_names:
            name = f"{uuid.uuid4().hex}-{name}"
        upload_names[name] = path
        archive_name = f"uploads/{name}"
        upload_entries.append((archive_name, path))
        document_uploads[str(document_id)] = archive_name
    manifest = {
        "format": FORMAT,
        "app_version": VERSION,
        "schema_version": SCHEMA_VERSION,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "user": {"email": user.email, "name": user.name},
        "credentials_excluded": True,
        "tables": {name: len(rows) for name, rows in data.items()},
        "uploads": document_uploads,
    }
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        archive.writestr("data.json", json.dumps(data, ensure_ascii=False))
        for archive_name, path in upload_entries:
            archive.write(path, archive_name)
    return target


def _safe_extract_upload(archive: zipfile.ZipFile, member, upload_dir: Path) -> Optional[Path]:
    name = Path(member.filename).name
    if not name:
        return None
    suffix = Path(name).suffix.lower()
    target = upload_dir / f"{uuid.uuid4().hex}{suffix}"
    with archive.open(member) as source, target.open("wb") as destination:
        shutil.copyfileobj(source, destination)
    return target


def restore_user_backup(db: Session, archive_path: Path) -> dict:
    uid = _current_uid()
    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as exc:
        raise ValueError("Invalid backup archive.") from exc
    with archive:
        names = set(archive.namelist())
        if "manifest.json" not in names or "data.json" not in names:
            raise ValueError("This is not a version 2 per-user backup. Legacy whole-database backups can only be restored on a local desktop installation.")
        try:
            manifest = json.loads(archive.read("manifest.json"))
            data = json.loads(archive.read("data.json"))
        except (ValueError, TypeError) as exc:
            raise ValueError("Backup manifest or data is unreadable.") from exc
        if manifest.get("format") != FORMAT:
            raise ValueError("Unsupported backup format.")
        if not isinstance(data, dict):
            raise ValueError("Backup data is malformed.")
        total = sum(len(json.dumps(rows)) for rows in data.values() if isinstance(rows, list))
        if total > MAX_RESTORE_BYTES:
            raise ValueError("Backup data is too large to restore.")
        uncompressed = sum(info.file_size for info in archive.infolist())
        if uncompressed > MAX_RESTORE_BYTES * 4:
            raise ValueError("Backup archive expands beyond the restore limit.")

        for model in DELETE_ORDER:
            db.query(model).filter(model.user_id == uid).delete(synchronize_session=False)
        db.query(Secret).filter(Secret.user_id == uid).delete(synchronize_session=False)
        db.query(AIUsageLog).filter(AIUsageLog.user_id == uid).delete(synchronize_session=False)

        upload_members = {
            Path(name).name: name for name in names if name.startswith("uploads/") and not name.endswith("/")
        }
        document_uploads = manifest.get("uploads") if isinstance(manifest.get("uploads"), dict) else {}
        id_maps: dict[str, dict[int, int]] = {}
        counts = {}
        extracted_paths: list[Path] = []
        try:
            _restore_tables(
                db,
                archive,
                data,
                uid,
                id_maps,
                counts,
                extracted_paths,
                upload_members,
                document_uploads,
            )
            if IS_POSTGRESQL:
                _advance_postgres_sequences(db)
            db.commit()
        except Exception:
            db.rollback()
            for path in extracted_paths:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
            raise
    return {"ok": True, "message": "Backup restored into your account.", "counts": counts}


def _restore_tables(
    db: Session,
    archive: zipfile.ZipFile,
    data: dict,
    uid: int,
    id_maps: dict[str, dict[int, int]],
    counts: dict[str, int],
    extracted_paths: list[Path],
    upload_members: dict[str, str],
    document_uploads: dict,
) -> None:
    for table, model in EXPORT_ORDER:
        rows = data.get(table, [])
        if not isinstance(rows, list):
            raise ValueError(f"Backup table {table} is malformed.")
        mapping = id_maps.setdefault(table, {})
        fks = FK_MAP.get(table, {})
        inserted = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            old_id = row.get("id")
            values = {}
            for column in model.__table__.columns:
                if column.name == "user_id":
                    continue
                value = _deserialize(row.get(column.name), column)
                if column.name in fks and value is not None:
                    target_map = id_maps.get(fks[column.name], {})
                    if isinstance(value, int):
                        if value not in target_map:
                            raise ValueError(f"Backup table {table} references a missing {fks[column.name]} row.")
                        value = target_map[value]
                if isinstance(model, Document) and column.name == "stored_path":
                    member_name = document_uploads.get(str(old_id)) or upload_members.get(Path(str(value or "")).name)
                    if member_name and member_name in archive.namelist():
                        new_path = _safe_extract_upload(archive, archive.getinfo(member_name), UPLOAD_DIR)
                        if new_path:
                            extracted_paths.append(new_path)
                            value = str(new_path)
                        else:
                            value = ""
                    else:
                        value = ""
                if isinstance(model, Preference) and column.name == "key":
                    value = f"u{uid}:{_logical_preference_key(str(value or ''))}"
                if isinstance(model, LabArtifact) and column.name == "lab_slug":
                    value = f"u{uid}:{str(value or '')}"
                values[column.name] = value
            if model is Preference and values.get("key", "").endswith(":ai_api_key"):
                continue
            obj = model(user_id=uid, **values)
            db.add(obj)
            db.flush()
            if isinstance(old_id, int):
                mapping[old_id] = obj.id
            inserted += 1
        counts[table] = inserted


def _advance_postgres_sequences(db: Session) -> None:
    if not IS_POSTGRESQL:
        return
    for _table, model in EXPORT_ORDER:
        if "id" not in model.__table__.columns:
            continue
        table = model.__tablename__
        try:
            seq = db.execute(
                text("SELECT pg_get_serial_sequence(:table, 'id')"),
                {"table": table},
            ).scalar()
        except Exception:
            continue
        if not seq:
            continue
        db.execute(
            text(
                f"SELECT setval(:seq, COALESCE((SELECT max(id) FROM {table}), 1), true)"
            ),
            {"seq": seq},
        )
