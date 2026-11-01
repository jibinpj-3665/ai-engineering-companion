import hashlib
import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import ALLOWED_DOCUMENT_EXTENSIONS, MAX_UPLOAD_MB, UPLOAD_DIR
from ..models import (
    Document,
    DocumentChunk,
    Subject,
    SyllabusCourseOutcome,
    SyllabusImportBatch,
    SyllabusModule,
    SyllabusTopic,
    utcnow,
)
from ..serializers import document_dict, module_dict, outcome_dict, subject_dict, topic_dict
from .documents import extract_document, guess_kind, process_document, validate_upload
from .syllabus import _heuristic_parse, _priority
from .syllabus_parser import parse_syllabus_pages

LIBRARY_EXTENSIONS = set(ALLOWED_DOCUMENT_EXTENSIONS)
UNSUPPORTED_LIBRARY_EXTENSIONS = {".doc", ".rtf", ".odt", ".xls", ".xlsx", ".ppt"}
_COLORS = ["violet", "blue", "emerald", "amber", "rose", "cyan", "fuchsia", "lime"]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest_entry(path: Path, relative: str, size: int, sha256: str, status: str, **extra) -> dict:
    return {
        "relative_path": relative,
        "source_path": str(path),
        "filename": path.name,
        "size_bytes": size,
        "sha256": sha256,
        "status": status,
        "document_id": extra.get("document_id"),
        "subject_id": extra.get("subject_id"),
        "course_code": extra.get("course_code", ""),
        "course_title": extra.get("course_title", ""),
        "semester": extra.get("semester", ""),
        "academic_year": extra.get("academic_year", ""),
        "pages": extra.get("pages", 0),
        "modules": extra.get("modules", 0),
        "topics": extra.get("topics", 0),
        "course_outcomes": extra.get("course_outcomes", 0),
        "warnings": extra.get("warnings", []),
        "message": extra.get("message", ""),
    }


def _choose_color(code: str) -> str:
    return _COLORS[sum(ord(char) for char in code or "subject") % len(_COLORS)]


def _upsert_subject(db: Session, document: Document, parsed: dict) -> Subject:
    existing = None
    if parsed.get("code"):
        existing = db.query(Subject).filter(Subject.code.ilike(parsed["code"])).first()
    if existing is None and parsed.get("title"):
        existing = db.query(Subject).filter(Subject.name.ilike(parsed["title"])).first()
    subject = existing or Subject(name=parsed["title"][:200], color=_choose_color(parsed.get("code") or parsed["title"]))
    subject.name = (parsed.get("title") or subject.name)[:200]
    subject.code = (parsed.get("code") or subject.code or "")[:60]
    subject.semester = (parsed.get("semester") or subject.semester or "")[:40]
    subject.department = (parsed.get("department") or subject.department or "")[:120]
    subject.description = (parsed.get("preamble") or subject.description or "")[:6000]
    subject.preamble = (parsed.get("preamble") or subject.preamble or "")[:6000]
    subject.prerequisites = (parsed.get("prerequisites") or subject.prerequisites or "")[:3000]
    subject.corequisites = (parsed.get("corequisites") or subject.corequisites or "")[:3000]
    subject.academic_year = (parsed.get("academic_year") or subject.academic_year or "")[:40]
    subject.credits = int(parsed.get("credits") or subject.credits or 0)
    subject.ltp = (parsed.get("ltp") or subject.ltp or "")[:40]
    subject.semester_source = (parsed.get("semester_source") or subject.semester_source or "")[:30]
    subject.books_json = json.dumps(parsed.get("books") or {}, ensure_ascii=False)
    subject.syllabus_updated_at = utcnow()
    if not existing:
        db.add(subject)
    db.flush()
    return subject


def _replace_outcomes(db: Session, subject: Subject, document: Document, parsed: dict) -> int:
    db.query(SyllabusCourseOutcome).filter(SyllabusCourseOutcome.subject_id == subject.id).delete(synchronize_session=False)
    count = 0
    for outcome in parsed.get("outcomes", []):
        db.add(SyllabusCourseOutcome(
            subject_id=subject.id,
            document_id=document.id,
            code=(outcome.get("code") or "")[:20],
            description=(outcome.get("description") or "")[:5000],
            bloom_level=(outcome.get("bloom_level") or "")[:60],
            po_json=outcome.get("po_json") or "[]",
            page=int(outcome.get("page") or 0),
        ))
        count += 1
    return count


def _upsert_modules(db: Session, subject: Subject, document: Document, parsed: dict) -> dict:
    existing = {module.number: module for module in db.query(SyllabusModule).filter(SyllabusModule.subject_id == subject.id).all()}
    modules = {}
    for item in parsed.get("modules", []):
        number = int(item.get("number") or 0)
        if number <= 0:
            continue
        module = existing.get(number)
        if module is None:
            module = SyllabusModule(subject_id=subject.id, number=number)
            db.add(module)
        module.document_id = document.id
        module.label = (item.get("label") or f"Module {number}")[:80]
        module.title = (item.get("title") or "")[:300]
        module.description = (item.get("description") or "")[:7000]
        module.lecture_hours = int(item.get("lecture_hours") or 0)
        module.tutorial_hours = int(item.get("tutorial_hours") or 0)
        module.practical_hours = int(item.get("practical_hours") or 0)
        module.self_study_hours = int(item.get("self_study_hours") or 0)
        module.page_start = int(item.get("page_start") or 0)
        module.page_end = int(item.get("page_end") or 0)
        db.flush()
        modules[number] = module
    return modules


def _upsert_topics(db: Session, subject: Subject, document: Document, parsed: dict, modules: dict) -> int:
    existing = db.query(SyllabusTopic).filter(SyllabusTopic.subject_id == subject.id).all()
    by_number = {topic.topic_number: topic for topic in existing if topic.topic_number}
    by_title = {topic.title.lower(): topic for topic in existing}
    kept = set()
    items = parsed.get("topics") or []

    if not items:
        for index, item in enumerate(_heuristic_parse("\n".join(
            f"{module.get('title', '')}\n{module.get('description', '')}" for module in parsed.get("modules", [])
        ))):
            module_number = int(re.search(r"\d+", item.get("module", "1")).group() if re.search(r"\d+", item.get("module", "1")) else 1)
            items.append({
                "number": str(index + 1),
                "module_number": module_number,
                "title": item["title"],
                "content_type": "topic",
                "hours": 0,
                "page": parsed.get("page", 1),
            })

    total = len(items)
    for index, item in enumerate(items):
        number = str(item.get("number") or "")[:20]
        title = (item.get("title") or "").strip()[:300]
        if len(title) < 2:
            continue
        module_number = int(item.get("module_number") or 1)
        module = modules.get(module_number)
        module_label = f"{module.label}: {module.title}" if module and module.title else (module.label if module else f"Module {module_number}")
        record = by_number.get(number) if number else None
        if record is None:
            record = by_title.get(title.lower())
        if record is None:
            record = SyllabusTopic(subject_id=subject.id, title=title)
            db.add(record)
        description = (item.get("description") or "")
        priority_item = {
            "title": title,
            "description": description,
            "module": module_label,
            "marks": int(item.get("marks") or 0),
        }
        priority, score, reason, frequency = _priority(db, subject.id, priority_item, index, total)
        record.module = module_label[:120]
        record.module_id = module.id if module else None
        record.unit = ""
        record.topic_number = number
        record.content_type = (item.get("content_type") or "topic")[:30]
        record.title = title
        record.description = description[:900]
        record.marks = priority_item["marks"]
        record.priority = priority
        record.priority_score = score
        record.priority_reason = reason
        record.exam_frequency = frequency
        record.source_document_id = document.id
        record.source_page = int(item.get("page") or 0)
        db.flush()
        kept.add(record.id)

    for record in existing:
        if record.id not in kept and record.status == "not_started" and (record.mastery_score or 0) == 0:
            db.delete(record)
    return len(kept)


def _library_file(db: Session, batch: SyllabusImportBatch, path: Path, root: Path) -> dict:
    relative = path.relative_to(root).as_posix()
    size = path.stat().st_size
    sha256 = _sha256(path)
    suffix = path.suffix.lower()
    if suffix in UNSUPPORTED_LIBRARY_EXTENSIONS:
        return _manifest_entry(path, relative, size, sha256, "unsupported", message=f"{suffix} files are not supported. Convert legacy documents to DOCX or a text-based PDF before importing.")
    if suffix not in LIBRARY_EXTENSIONS:
        return _manifest_entry(path, relative, size, sha256, "unsupported", message=f"{suffix or 'No extension'} is not an allowed document type.")
    if size > MAX_UPLOAD_MB * 1024 * 1024:
        return _manifest_entry(path, relative, size, sha256, "unsupported", message=f"File exceeds the {MAX_UPLOAD_MB} MB import limit.")

    duplicate = db.query(Document).filter(
        Document.sha256 == sha256,
        Document.doc_kind == "syllabus",
        Document.active == True,  # noqa: E712
    ).first()
    if duplicate:
        subject = db.get(Subject, duplicate.subject_id) if duplicate.subject_id else None
        return _manifest_entry(
            path, relative, size, sha256, "duplicate",
            document_id=duplicate.id, subject_id=duplicate.subject_id,
            course_code=subject.code if subject else "", course_title=subject.name if subject else "",
            semester=subject.semester if subject else "", pages=duplicate.page_count,
            message="Identical file content is already imported.",
        )

    previous_versions = db.query(Document).filter(
        Document.source_identity == str(path),
        Document.doc_kind == "syllabus",
        Document.active == True,  # noqa: E712
    ).all()
    for previous in previous_versions:
        previous.active = False
        previous.status = "unindexed"
        previous.stage = "Superseded by a newer import of the same source file."
        db.query(DocumentChunk).filter(DocumentChunk.document_id == previous.id).delete(synchronize_session=False)
        previous.error = "Superseded by a newer import of the same source file."
    version = max([document.version or 1 for document in previous_versions] + [0]) + 1

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    try:
        shutil.copy2(path, stored_path)
        validate_upload(stored_path, suffix)
        document = Document(
            filename=path.name[:300],
            stored_path=str(stored_path),
            mime_type="application/pdf" if suffix == ".pdf" else "application/octet-stream",
            size_bytes=size,
            status="queued",
            stage="Queued for syllabus import",
            progress=5,
            doc_kind="syllabus",
            sha256=sha256,
            source_path=str(path),
            source_identity=str(path)[:1000],
            import_batch_id=batch.id,
            version=version,
            active=True,
        )
        db.add(document)
        db.flush()
        process_document(db, document.id)
        db.refresh(document)
    except Exception as exc:
        stored_path.unlink(missing_ok=True)
        return _manifest_entry(path, relative, size, sha256, "failed", message=str(exc)[:800])

    if document.status != "ready":
        return _manifest_entry(path, relative, size, sha256, "failed", document_id=document.id, message=document.error or "Extraction failed.")

    try:
        pages = json.loads(document.pages_json or "[]")
        parsed = parse_syllabus_pages(pages)
    except Exception as exc:
        return _manifest_entry(path, relative, size, sha256, "failed", document_id=document.id, pages=document.page_count, message=f"Syllabus parsing failed: {exc}"[:800])

    has_structure = bool(parsed.get("code") and (parsed.get("modules") or parsed.get("outcomes") or parsed.get("topics")))
    if not has_structure:
        document.active = False
        document.doc_kind = "reference"
        document.error = "No course code, modules, course outcomes or topic schedule were detected. Kept as a reference file but not added to the syllabus library."
        db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).delete(synchronize_session=False)
        db.commit()
        return _manifest_entry(
            path, relative, size, sha256, "skipped",
            document_id=document.id, pages=document.page_count,
            warnings=parsed.get("warnings", []),
            message=document.error,
        )

    try:
        subject = _upsert_subject(db, document, parsed)
        document.subject_id = subject.id
        db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).update(
            {DocumentChunk.subject_id: subject.id}, synchronize_session=False
        )
        document.academic_year = (parsed.get("academic_year") or "")[:40]
        document.semester = (parsed.get("semester") or "")[:40]
        document.semester_confidence = (parsed.get("semester_source") or "")[:30]
        document.doc_kind = "syllabus"
        document.active = True
        modules = _upsert_modules(db, subject, document, parsed)
        outcome_count = _replace_outcomes(db, subject, document, parsed)
        topic_count = _upsert_topics(db, subject, document, parsed, modules)
        db.commit()
        return _manifest_entry(
            path, relative, size, sha256, "imported",
            document_id=document.id, subject_id=subject.id,
            course_code=parsed.get("code", ""), course_title=parsed.get("title", ""),
            semester=parsed.get("semester", ""), academic_year=parsed.get("academic_year", ""),
            pages=document.page_count, modules=len(modules), topics=topic_count,
            course_outcomes=outcome_count, warnings=parsed.get("warnings", []),
            message="Imported and indexed.",
        )
    except Exception as exc:
        db.rollback()
        document = db.get(Document, document.id)
        if document:
            document.status = "failed"
            document.stage = "Syllabus import failed"
            document.error = str(exc)[:1000]
            db.commit()
        return _manifest_entry(path, relative, size, sha256, "failed", document_id=document.id if document else None, pages=document.page_count if document else 0, message=str(exc)[:800])


def import_syllabus_folder(db: Session, source: Path) -> SyllabusImportBatch:
    root = source.expanduser()
    if not root.is_dir():
        raise ValueError("The selected folder does not exist or is not a directory.")
    root = root.resolve()
    batch = SyllabusImportBatch(source_root=str(root), status="running")
    db.add(batch)
    db.commit()
    db.refresh(batch)

    files = sorted(path for path in root.rglob("*") if path.is_file() and not path.name.startswith("~$"))
    batch.total_files = len(files)
    db.commit()
    manifest: List[dict] = []
    counts = {"imported": 0, "duplicate": 0, "unsupported": 0, "skipped": 0, "failed": 0}
    try:
        for path in files:
            try:
                resolved = path.resolve()
                if not resolved.is_relative_to(root):
                    entry = _manifest_entry(path, path.name, 0, "", "failed", message="Resolved path escapes the selected folder.")
                else:
                    entry = _library_file(db, batch, resolved, root)
            except Exception as exc:
                entry = _manifest_entry(path, path.relative_to(root).as_posix(), 0, "", "failed", message=str(exc)[:800])
            manifest.append(entry)
            counts[entry["status"]] = counts.get(entry["status"], 0) + 1
            batch.manifest_json = json.dumps(manifest, ensure_ascii=False)
            batch.imported_files = counts["imported"]
            batch.duplicate_files = counts["duplicate"]
            batch.unsupported_files = counts["unsupported"]
            batch.skipped_files = counts["skipped"]
            batch.failed_files = counts["failed"]
            db.commit()
        batch.status = "completed_with_errors" if (counts["failed"] or counts["unsupported"] or counts["skipped"]) else "completed"
    except Exception as exc:
        db.rollback()
        batch = db.get(SyllabusImportBatch, batch.id)
        batch.status = "failed"
        batch.error = str(exc)[:1000]
    batch.completed_at = utcnow()
    db.commit()
    db.refresh(batch)
    return batch


def batch_dict(batch: SyllabusImportBatch) -> dict:
    try:
        manifest = json.loads(batch.manifest_json or "[]")
    except ValueError:
        manifest = []
    return {
        "id": batch.id,
        "source_root": batch.source_root,
        "status": batch.status,
        "total_files": batch.total_files,
        "imported_files": batch.imported_files,
        "duplicate_files": batch.duplicate_files,
        "unsupported_files": batch.unsupported_files,
        "skipped_files": batch.skipped_files,
        "failed_files": batch.failed_files,
        "error": batch.error or "",
        "manifest": manifest,
        "created_at": batch.created_at.isoformat() + "Z" if batch.created_at else None,
        "completed_at": batch.completed_at.isoformat() + "Z" if batch.completed_at else None,
    }


def library_overview(db: Session) -> dict:
    library_subject_ids = select(Document.subject_id).where(
        Document.doc_kind == "syllabus",
        Document.subject_id.isnot(None),
    )
    subjects = db.query(Subject).filter(Subject.id.in_(library_subject_ids)).order_by(Subject.semester, Subject.code, Subject.name).all()
    documents = db.query(Document).filter(Document.doc_kind == "syllabus").all()
    semesters = {}
    subject_rows = []
    for subject in subjects:
        topics = db.query(SyllabusTopic).filter(SyllabusTopic.subject_id == subject.id).all()
        modules = db.query(SyllabusModule).filter(SyllabusModule.subject_id == subject.id).all()
        outcomes = db.query(SyllabusCourseOutcome).filter(SyllabusCourseOutcome.subject_id == subject.id).count()
        docs = [document for document in documents if document.subject_id == subject.id]
        completed = len([topic for topic in topics if topic.status in {"learned", "mastered"}])
        semester = subject.semester or "Unassigned"
        bucket = semesters.setdefault(semester, {
            "semester": semester,
            "subjects": 0, "modules": 0, "topics": 0, "completed_topics": 0,
            "mastered": 0, "documents": 0, "credits": 0,
        })
        bucket["subjects"] += 1
        bucket["modules"] += len(modules)
        bucket["topics"] += len(topics)
        bucket["completed_topics"] += completed
        bucket["mastered"] += len([topic for topic in topics if topic.status == "mastered"])
        bucket["documents"] += len([document for document in docs if document.active])
        bucket["credits"] += subject.credits or 0
        subject_rows.append({
            **subject_dict(subject),
            "module_count": len(modules),
            "topic_count": len(topics),
            "completed_topics": completed,
            "mastered_count": len([topic for topic in topics if topic.status == "mastered"]),
            "in_progress_count": len([topic for topic in topics if topic.status == "in_progress"]),
            "outcome_count": outcomes,
            "document_count": len([document for document in docs if document.active]),
            "progress": round(sum(
                100 if topic.status == "mastered" else 75 if topic.status == "learned" else 35 if topic.status == "in_progress" else 0
                for topic in topics
            ) / max(1, len(topics)), 1),
        })
    for bucket in semesters.values():
        bucket["progress"] = round(bucket["completed_topics"] / max(1, bucket["topics"]) * 100, 1)
    active_documents = [document for document in documents if document.active]
    batches = db.query(SyllabusImportBatch).order_by(SyllabusImportBatch.created_at.desc()).limit(20).all()
    return {
        "semesters": sorted(semesters.values(), key=lambda item: (item["semester"] == "Unassigned", item["semester"])),
        "subjects": subject_rows,
        "totals": {
            "subjects": len(subjects),
            "semesters": len([semester for semester in semesters if semester != "Unassigned"]),
            "modules": sum(bucket["modules"] for bucket in semesters.values()),
            "topics": sum(bucket["topics"] for bucket in semesters.values()),
            "documents": len(active_documents),
            "indexed_documents": len([document for document in active_documents if document.status == "ready"]),
            "import_batches": len(batches),
        },
        "recent_batches": [batch_dict(batch) for batch in batches],
        "note": "Library counts come from imported documents only. Semester values marked 'inferred' in a subject were derived from the course code, not an explicit statement in that PDF.",
    }


def subject_library_detail(db: Session, subject_id: int) -> dict:
    subject = db.get(Subject, subject_id)
    if not subject:
        raise ValueError("Subject not found")
    topics = db.query(SyllabusTopic).filter(SyllabusTopic.subject_id == subject.id).order_by(SyllabusTopic.module, SyllabusTopic.id).all()
    modules = db.query(SyllabusModule).filter(SyllabusModule.subject_id == subject.id).order_by(SyllabusModule.number).all()
    outcomes = db.query(SyllabusCourseOutcome).filter(SyllabusCourseOutcome.subject_id == subject.id).order_by(SyllabusCourseOutcome.code).all()
    documents = db.query(Document).filter(Document.subject_id == subject.id).order_by(Document.created_at).all()
    topic_dicts = [topic_dict(topic, subject.name) for topic in topics]
    module_rows = []
    for module in modules:
        module_topics = [topic for topic in topics if topic.module_id == module.id]
        module_rows.append(module_dict(
            module,
            topic_count=len(module_topics),
            mastered=len([topic for topic in module_topics if topic.status == "mastered"]),
            learned=len([topic for topic in module_topics if topic.status == "learned"]),
            in_progress=len([topic for topic in module_topics if topic.status == "in_progress"]),
            topic_ids=[topic.id for topic in module_topics],
        ))
    return {
        "subject": subject_dict(subject),
        "modules": module_rows,
        "course_outcomes": [outcome_dict(outcome) for outcome in outcomes],
        "topics": topic_dicts,
        "documents": [document_dict(document, include_preview=False) for document in documents],
        "progress": {
            "topics": len(topics),
            "modules": len(modules),
            "mastered": len([topic for topic in topics if topic.status == "mastered"]),
            "learned": len([topic for topic in topics if topic.status == "learned"]),
            "in_progress": len([topic for topic in topics if topic.status == "in_progress"]),
            "not_started": len([topic for topic in topics if topic.status == "not_started"]),
            "completion": round(sum(
                100 if topic.status == "mastered" else 75 if topic.status == "learned" else 35 if topic.status == "in_progress" else 0
                for topic in topics
            ) / max(1, len(topics)), 1),
        },
        "note": "Module descriptions, course outcomes and page references are copied from the imported syllabus. Progress is per signed-in student.",
    }


def search_library(db: Session, query: str, limit: int = 30) -> dict:
    query = (query or "").strip()
    if not query:
        return {"results": [], "note": "Enter a subject, course code, module or topic."}
    pattern = f"%{query}%"
    results = []
    subjects = db.query(Subject).filter(
        (Subject.name.ilike(pattern)) | (Subject.code.ilike(pattern)) | (Subject.semester.ilike(pattern))
    ).limit(limit).all()
    subject_names = {subject.id: subject.name for subject in db.query(Subject).all()}
    subject_codes = {subject.id: subject.code for subject in db.query(Subject).all()}
    for subject in subjects:
        results.append({
            "kind": "subject",
            "subject_id": subject.id,
            "subject": subject.name,
            "course_code": subject.code,
            "semester": subject.semester,
            "title": subject.name,
            "module": "",
            "page": None,
            "document": "",
            "document_id": None,
        })
    document_names = {document.id: document.filename for document in db.query(Document).all()}
    modules = db.query(SyllabusModule).filter(
        (SyllabusModule.title.ilike(pattern)) | (SyllabusModule.description.ilike(pattern)) | (SyllabusModule.label.ilike(pattern))
    ).limit(limit).all()
    for module in modules:
        results.append({
            "kind": "module",
            "subject_id": module.subject_id,
            "subject": subject_names.get(module.subject_id, ""),
            "course_code": subject_codes.get(module.subject_id, ""),
            "semester": "",
            "title": f"{module.label}: {module.title}",
            "module": module.label,
            "page": module.page_start,
            "document": document_names.get(module.document_id, ""),
            "document_id": module.document_id,
        })
    topics = db.query(SyllabusTopic).filter(
        (SyllabusTopic.title.ilike(pattern)) | (SyllabusTopic.description.ilike(pattern))
    ).limit(limit).all()
    for topic in topics:
        results.append({
            "kind": "topic",
            "subject_id": topic.subject_id,
            "subject": subject_names.get(topic.subject_id, ""),
            "course_code": subject_codes.get(topic.subject_id, ""),
            "semester": "",
            "title": topic.title,
            "module": topic.module,
            "page": topic.source_page,
            "document": document_names.get(topic.source_document_id, ""),
            "document_id": topic.source_document_id,
        })
    return {
        "results": results[:limit],
        "note": "Search covers imported subject metadata, modules and lecture-schedule topics. Open the source PDF for the authoritative wording.",
    }


def reparse_document(db: Session, document_id: int) -> dict:
    document = db.get(Document, document_id)
    if not document:
        raise ValueError("Document not found")
    document.active = True
    document.status = "queued"
    document.stage = "Queued for syllabus re-parse"
    db.commit()
    process_document(db, document.id)
    db.refresh(document)
    if document.status != "ready":
        raise ValueError(document.error or "Document could not be extracted.")
    pages = json.loads(document.pages_json or "[]")
    parsed = parse_syllabus_pages(pages)
    if not (parsed.get("code") and (parsed.get("modules") or parsed.get("outcomes") or parsed.get("topics"))):
        raise ValueError("No syllabus structure was detected in this document.")
    subject = _upsert_subject(db, document, parsed)
    document.subject_id = subject.id
    document.academic_year = (parsed.get("academic_year") or "")[:40]
    document.semester = (parsed.get("semester") or "")[:40]
    document.semester_confidence = (parsed.get("semester_source") or "")[:30]
    document.doc_kind = "syllabus"
    modules = _upsert_modules(db, subject, document, parsed)
    outcomes = _replace_outcomes(db, subject, document, parsed)
    topics = _upsert_topics(db, subject, document, parsed, modules)
    db.commit()
    return {
        "document": document_dict(document),
        "subject_id": subject.id,
        "course_code": parsed.get("code", ""),
        "course_title": parsed.get("title", ""),
        "modules": len(modules),
        "topics": topics,
        "course_outcomes": outcomes,
        "warnings": parsed.get("warnings", []),
    }


def rebuild_library(db: Session) -> dict:
    documents = db.query(Document).filter(Document.doc_kind == "syllabus", Document.active == True).all()  # noqa: E712
    results = []
    for document in documents:
        try:
            results.append({"document_id": document.id, "filename": document.filename, **reparse_document(db, document.id)})
        except Exception as exc:
            results.append({"document_id": document.id, "filename": document.filename, "error": str(exc)[:500]})
    return {
        "count": len(results),
        "failed": len([item for item in results if item.get("error")]),
        "results": results,
        "note": "Re-parsing rebuilds chunks and embeddings and refreshes syllabus metadata. Student topic status and mastery are preserved when topic numbers or titles match.",
    }


def unindex_document(db: Session, document_id: int) -> dict:
    document = db.get(Document, document_id)
    if not document:
        raise ValueError("Document not found")
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).delete(synchronize_session=False)
    document.active = False
    document.status = "unindexed"
    document.stage = "Index removed; stored copy preserved"
    document.error = "Index removed by the student. The imported copy and source file were not deleted."
    db.commit()
    return document_dict(document)


def manifest_export(db: Session) -> dict:
    documents = db.query(Document).filter(Document.doc_kind == "syllabus").order_by(Document.created_at).all()
    batches = db.query(SyllabusImportBatch).order_by(SyllabusImportBatch.created_at).all()
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "documents": [
            {
                "id": document.id,
                "filename": document.filename,
                "source_path": document.source_path or "",
                "source_relative_path": document.source_identity or "",
                "sha256": document.sha256 or "",
                "subject_id": document.subject_id,
                "academic_year": document.academic_year or "",
                "semester": document.semester or "",
                "semester_confidence": document.semester_confidence or "",
                "pages": document.page_count,
                "version": document.version or 1,
                "active": bool(document.active),
                "status": document.status,
                "error": document.error or "",
            }
            for document in documents
        ],
        "batches": [batch_dict(batch) for batch in batches],
    }
