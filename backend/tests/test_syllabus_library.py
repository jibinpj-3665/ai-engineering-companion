import hashlib
from pathlib import Path

from app.services.syllabus_parser import parse_syllabus_pages

SYLLABUS = """24ECT599
Advanced Signal Processing
Year of Introduction L T P R C 2024 3 0 0 0 4
SEMESTER V
Preamble
UniqueNyquistMarker course on sampling, reconstruction and anti-aliasing filters.
Prerequisite
Linear algebra and signals.
Corequisite
None.
Course Outcomes
CO1
Analyse sampling and reconstruction systems.
Analyze
CO-PO Mapping
CO1
3
2
Assessment Pattern
Syllabus
Module 1: Sampling Systems (10L+2T)
Sampling theorem, reconstruction and anti-aliasing filters.
Course Contents and Lecture Schedule
Module 1: Sampling Systems (10L+2T)
1.1 Sampling theorem and reconstruction
5
1.2 Anti-aliasing filter design
7
CO Assessment Questions
Text Books
1. Signal Processing, Author
Reference Books
1. Reference Handbook
"""

UNSTRUCTURED = """Project notes
This file is a reference note without a course code, module structure or lecture schedule.
It must be preserved as a reference but skipped by the syllabus library.
"""


def _write_folder(root: Path) -> None:
    (root / "01_syllabus.txt").write_text(SYLLABUS, encoding="utf-8")
    (root / "02_copy.txt").write_text(SYLLABUS, encoding="utf-8")
    (root / "03_reference.txt").write_text(UNSTRUCTURED, encoding="utf-8")
    (root / "04_legacy.doc").write_text("legacy binary placeholder", encoding="utf-8")


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_library_import_reparse_unindex_and_preserve_progress(client, tmp_path, monkeypatch):
    _write_folder(tmp_path)
    before = {path.name: _digest(path) for path in tmp_path.iterdir()}
    monkeypatch.setenv("AEC_IMPORT_ROOTS", str(tmp_path))
    status_before = client.get("/api/ai/status").json()

    response = client.post("/api/syllabus/library/import", json={"path": str(tmp_path)})
    assert response.status_code == 201, response.text
    batch = response.json()
    assert batch["total_files"] == 4
    assert batch["imported_files"] == 1
    assert batch["duplicate_files"] == 1
    assert batch["skipped_files"] == 1
    assert batch["unsupported_files"] == 1
    assert batch["failed_files"] == 0
    assert batch["status"] == "completed_with_errors"

    imported = next(item for item in batch["manifest"] if item["status"] == "imported")
    assert imported["course_code"] == "24ECT599"
    assert imported["semester"] == "S5"
    assert imported["modules"] == 1
    assert imported["topics"] == 2
    assert imported["course_outcomes"] == 1
    subject_id = imported["subject_id"]
    document_id = imported["document_id"]

    status_after = client.get("/api/ai/status").json()
    assert status_after["ready_documents"] == status_before["ready_documents"] + 1
    assert status_after["indexed_chunks"] > status_before["indexed_chunks"]

    overview = client.get("/api/syllabus/library").json()
    subject_row = next(item for item in overview["subjects"] if item["id"] == subject_id)
    assert subject_row["code"] == "24ECT599"
    assert subject_row["semester_source"] == "explicit"
    assert subject_row["topic_count"] == 2
    assert subject_row["module_count"] == 1
    assert subject_row["outcome_count"] == 1

    detail = client.get(f"/api/syllabus/library/subjects/{subject_id}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["subject"]["credits"] == 4
    assert body["subject"]["ltp"] == "3-0-0-0-4"
    assert "UniqueNyquistMarker" in body["subject"]["preamble"]
    assert len(body["modules"]) == 1
    assert len(body["topics"]) == 2
    assert len(body["course_outcomes"]) == 1

    search = client.get("/api/syllabus/library/search", params={"q": "24ECT599"}).json()
    assert any(item["kind"] == "subject" and item["subject_id"] == subject_id for item in search["results"])
    topic_search = client.get("/api/syllabus/library/search", params={"q": "anti-aliasing"}).json()
    assert any(item["kind"] == "topic" and item["subject_id"] == subject_id for item in topic_search["results"])

    before_search = client.post("/api/documents/search", json={"query": "UniqueNyquistMarker", "top_k": 5})
    assert before_search.status_code == 200
    assert any(source["document_id"] == document_id for source in before_search.json()["sources"])

    subject_search = client.post(
        "/api/documents/search",
        json={"query": "UniqueNyquistMarker", "subject_id": subject_id, "top_k": 5},
    )
    assert subject_search.status_code == 200
    assert any(source["document_id"] == document_id for source in subject_search.json()["sources"])

    topic_id = body["topics"][0]["id"]
    updated = client.patch(f"/api/syllabus/topics/{topic_id}", json={"status": "mastered"})
    assert updated.status_code == 200

    unindexed = client.post(f"/api/syllabus/library/documents/{document_id}/unindex")
    assert unindexed.status_code == 200, unindexed.text
    assert unindexed.json()["status"] == "unindexed"
    assert unindexed.json()["active"] is False
    after_search = client.post("/api/documents/search", json={"query": "UniqueNyquistMarker", "top_k": 5})
    assert after_search.status_code == 200
    assert all(source["document_id"] != document_id for source in after_search.json()["sources"])
    after_unindex = client.get("/api/syllabus/library").json()
    unindexed_row = next(item for item in after_unindex["subjects"] if item["id"] == subject_id)
    assert unindexed_row["document_count"] == 0
    assert unindexed_row["topic_count"] == 2

    reparsed = client.post(f"/api/syllabus/library/documents/{document_id}/reparse")
    assert reparsed.status_code == 200, reparsed.text
    assert reparsed.json()["modules"] == 1
    assert reparsed.json()["topics"] == 2
    restored = client.get(f"/api/syllabus/library/subjects/{subject_id}").json()
    restored_topic = next(item for item in restored["topics"] if item["id"] == topic_id)
    assert restored_topic["status"] == "mastered"
    after_reparse = client.post("/api/documents/search", json={"query": "UniqueNyquistMarker", "top_k": 5})
    assert any(source["document_id"] == document_id for source in after_reparse.json()["sources"])

    after = {path.name: _digest(path) for path in tmp_path.iterdir()}
    assert before == after


def test_changed_source_creates_new_version_and_invalidates_previous(client, tmp_path, monkeypatch):
    source = tmp_path / "versioned"
    source.mkdir()
    path = source / "syllabus.txt"
    first = SYLLABUS.replace("24ECT599", "24ECT598")
    path.write_text(first, encoding="utf-8")
    monkeypatch.setenv("AEC_IMPORT_ROOTS", str(tmp_path))

    first_batch = client.post("/api/syllabus/library/import", json={"path": str(source)})
    assert first_batch.status_code == 201, first_batch.text
    first_document_id = first_batch.json()["manifest"][0]["document_id"]

    updated = first.replace("24ECT598", "24ECT597").replace(
        "Advanced Signal Processing",
        "Advanced Signal Processing Revised",
    )
    path.write_text(updated, encoding="utf-8")
    second_batch = client.post("/api/syllabus/library/import", json={"path": str(source)})
    assert second_batch.status_code == 201, second_batch.text
    second = second_batch.json()
    assert second["imported_files"] == 1
    assert second["duplicate_files"] == 0
    second_document_id = second["manifest"][0]["document_id"]
    assert second_document_id != first_document_id

    previous = client.get(f"/api/documents/{first_document_id}")
    assert previous.status_code == 200
    assert previous.json()["active"] is False
    assert previous.json()["status"] == "unindexed"
    current = client.get(f"/api/documents/{second_document_id}")
    assert current.status_code == 200
    assert current.json()["active"] is True
    assert current.json()["version"] == 2


def test_import_rejects_remote_or_unlisted_paths(client, tmp_path, monkeypatch):
    monkeypatch.delenv("AEC_IMPORT_ROOTS", raising=False)
    response = client.post("/api/syllabus/library/import", json={"path": str(tmp_path)})
    assert response.status_code == 403
    assert "local desktop app" in response.json()["detail"]

    allowed = tmp_path / "allowed"
    blocked = tmp_path / "blocked"
    allowed.mkdir()
    blocked.mkdir()
    monkeypatch.setenv("AEC_IMPORT_ROOTS", str(allowed))
    response = client.post("/api/syllabus/library/import", json={"path": str(blocked)})
    assert response.status_code == 403
    assert "allow-list" in response.json()["detail"]


def test_parser_semester_and_module_label_normalization():
    text = """24ECT501
Digital Signal Processing
Year of Introduction L T P R C 2024 3 1 0 0 4
Preamble
Course on signals.
Syllabus
Module I: Signals (8L)
Introduction.
Module III: Filters (8L)
Filter design.
Module VI: Applications (8L)
Applications.
SEMESTER V
"""
    parsed = parse_syllabus_pages([{"page": 1, "text": text}])
    assert parsed["code"] == "24ECT501"
    assert parsed["semester"] == "S5"
    assert parsed["semester_source"] == "explicit"
    assert [module["number"] for module in parsed["modules"]] == [1, 2, 3]
    assert [module["label"] for module in parsed["modules"]] == ["Module I", "Module III", "Module VI"]
    assert any("Module VI" in warning and "sequence 3" in warning for warning in parsed["warnings"])


def test_parser_infers_semester_when_not_explicit():
    text = """24ECE523
ARM Architecture
Year of Introduction L T P R C 2024 3 0 0 0 3
Preamble
Course on ARM processors.
Syllabus
Module 1: Architecture (8L)
Architecture.
"""
    parsed = parse_syllabus_pages([{"page": 1, "text": text}])
    assert parsed["semester"] == "S5"
    assert parsed["semester_source"] == "inferred_from_course_code"
