import io
import zipfile

from tests.conftest import upload_text

NOTES = """
Sampling Theorem

The sampling theorem states that a bandlimited signal must be sampled at a rate greater than twice its highest frequency. The Nyquist rate is defined as two times the maximum signal frequency. If the sampling rate is below the Nyquist rate, aliasing occurs and the original signal cannot be reconstructed.

A filter is a system that modifies the frequency content of a signal. An FIR filter is a finite impulse response filter whose output depends only on current and past input samples. An IIR filter is an infinite impulse response filter that uses feedback from previous outputs.

The discrete Fourier transform is a mathematical transform that maps a finite sequence from the time domain to the frequency domain. The fast Fourier transform is an efficient algorithm for computing the discrete Fourier transform.

Convolution is a mathematical operation that combines two signals to produce a third signal. In linear time-invariant systems, the output is the convolution of the input with the impulse response.

The z transform is a transform that converts a discrete-time signal into a complex frequency-domain representation. The region of convergence is the set of z values for which the transform converges.

Quantization is the process of mapping continuous amplitude values to a finite set of discrete levels. Quantization error is the difference between the original value and the quantized value.

An anti-aliasing filter is an analog low-pass filter placed before the sampler to remove frequencies above the Nyquist limit.
"""

SYLLABUS = """
Digital Signal Processing - ECE301

Module 1: Signals and Systems
1.1 Classification of signals - 5 marks
1.2 Linear time-invariant systems and convolution
1.3 Sampling theorem and aliasing - 10 marks

Module 2: Frequency Analysis
2.1 Discrete Fourier transform
2.2 Fast Fourier transform algorithms
2.3 z transform and region of convergence

Module 3: Digital Filters
3.1 FIR filter design
3.2 IIR filter design
3.3 Realization structures and quantization effects
"""


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_subject_crud(client):
    created = client.post("/api/subjects", json={"name": "Circuit Theory", "code": "EEE201"})
    assert created.status_code == 201
    subject_id = created.json()["id"]
    updated = client.patch(f"/api/subjects/{subject_id}", json={"semester": "S3"})
    assert updated.status_code == 200 and updated.json()["semester"] == "S3"
    listed = client.get("/api/subjects")
    assert any(item["id"] == subject_id for item in listed.json())
    deleted = client.delete(f"/api/subjects/{subject_id}")
    assert deleted.status_code == 200
    assert client.get(f"/api/subjects/{subject_id}").status_code == 404


def test_document_upload_index_search_and_delete(client, subject):
    document = upload_text(client, subject["id"], "unit1-notes.txt", NOTES)
    assert document["status"] == "ready"
    assert document["page_count"] >= 1

    search = client.post("/api/documents/search", json={"query": "Nyquist aliasing sampling", "subject_id": subject["id"], "top_k": 5})
    assert search.status_code == 200
    sources = search.json()["sources"]
    assert sources
    assert any("notes" in source["document"] for source in sources)
    assert all(source["page"] >= 0 for source in sources)

    pages = client.get(f"/api/documents/{document['id']}/pages")
    assert pages.status_code == 200
    assert pages.json()["pages"]

    deleted = client.delete(f"/api/documents/{document['id']}")
    assert deleted.status_code == 200
    assert client.get(f"/api/documents/{document['id']}").status_code == 404


def test_syllabus_parse_and_priority(client, subject):
    document = upload_text(client, subject["id"], "syllabus.txt", SYLLABUS, doc_kind="syllabus")
    parsed = client.post("/api/syllabus/parse", json={"subject_id": subject["id"], "document_id": document["id"], "use_ai": False})
    assert parsed.status_code == 200, parsed.text
    data = parsed.json()
    assert data["count"] >= 5
    topics = data["topics"]
    assert all(topic["priority_reason"] for topic in topics)
    assert any(topic["priority"] == "high" for topic in topics)
    aliasing = [topic for topic in topics if "sampling" in topic["title"].lower() or "aliasing" in topic["title"].lower()]
    assert aliasing

    coverage = client.get(f"/api/syllabus/coverage/{subject['id']}")
    assert coverage.status_code == 200
    assert coverage.json()["total_topics"] == len(topics)

    updated = client.patch(f"/api/syllabus/topics/{topics[0]['id']}", json={"status": "in_progress"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "in_progress"


def test_teaching_phase_does_not_autocomplete(client, subject):
    document = upload_text(client, subject["id"], "notes2.txt", NOTES)
    client.post("/api/syllabus/parse", json={"subject_id": subject["id"], "document_id": document["id"], "use_ai": False})
    topics = client.get("/api/syllabus/topics", params={"subject_id": subject["id"]}).json()
    topic = topics[0]

    first = client.post(f"/api/teaching/{topic['id']}/phase", json={"phase": 1})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["content"]
    assert body["generator"] == "offline"
    assert "Offline scaffold" in body["content"] or "AI provider is not configured" in body["content"]

    second = client.post(f"/api/teaching/{topic['id']}/phase", json={"phase": 2})
    assert second.status_code == 200
    progress = client.get(f"/api/teaching/{topic['id']}/progress").json()
    assert progress["progress_percent"] > 0
    assert progress["topic"]["status"] != "mastered"


def test_quiz_generation_submission_and_mastery(client, subject):
    document = upload_text(client, subject["id"], "notes3.txt", NOTES)
    client.post("/api/syllabus/parse", json={"subject_id": subject["id"], "document_id": document["id"], "use_ai": False})
    topics = client.get("/api/syllabus/topics", params={"subject_id": subject["id"]}).json()
    topic = topics[0]

    generated = client.post("/api/quizzes/generate", json={"subject_id": subject["id"], "topic_id": topic["id"], "mode": "quick", "count": 5})
    assert generated.status_code == 201, generated.text
    quiz = generated.json()
    assert quiz["questions"]
    assert all("correct_answer" not in question for question in quiz["questions"])

    answers = {str(question["id"]): "" for question in quiz["questions"]}
    submitted = client.post(f"/api/quizzes/{quiz['id']}/submit", json={"answers": answers, "duration_seconds": 90})
    assert submitted.status_code == 200, submitted.text
    attempt = submitted.json()
    assert attempt["feedback"]
    assert attempt["max_score"] > 0
    assert attempt["percent"] == 0

    attempts = client.get("/api/quizzes/attempts", params={"topic_id": topic["id"]})
    assert attempts.status_code == 200 and attempts.json()

    saved = client.post("/api/quizzes/saved", json={"subject_id": subject["id"], "prompt": quiz["questions"][0]["prompt"], "answer": "reference", "qtype": "short"})
    assert saved.status_code == 201
    assert client.get("/api/quizzes/saved").json()


def test_flashcards_and_revision_schedule(client, subject):
    document = upload_text(client, subject["id"], "notes4.txt", NOTES)
    generated = client.post("/api/revision/generate", json={"subject_id": subject["id"], "limit": 6})
    assert generated.status_code == 201, generated.text
    cards = generated.json()
    assert cards
    first = cards[0]
    reviewed = client.post(f"/api/revision/{first['id']}/review", json={"grade": 5})
    assert reviewed.status_code == 200
    updated = reviewed.json()
    assert updated["repetitions"] >= 1
    assert updated["interval_days"] >= 1
    stats = client.get("/api/revision/stats")
    assert stats.status_code == 200
    assert stats.json()["total"] >= 1
    assert document["id"]


def test_planner_exams_and_analytics(client, subject):
    document = upload_text(client, subject["id"], "notes5.txt", NOTES)
    client.post("/api/syllabus/parse", json={"subject_id": subject["id"], "document_id": document["id"], "use_ai": False})
    exam = client.post("/api/exams", json={"subject_id": subject["id"], "title": "Model Exam", "exam_date": "2027-06-01"})
    assert exam.status_code == 201
    plan = client.post("/api/planner/generate", json={"daily_minutes": 100, "horizon_days": 7})
    assert plan.status_code == 200, plan.text
    sessions = plan.json()["sessions"]
    assert sessions
    first = sessions[0]
    completed = client.patch(f"/api/planner/sessions/{first['id']}", json={"status": "completed"})
    assert completed.status_code == 200
    log = client.post("/api/study-sessions", json={"minutes": 25, "subject_id": subject["id"], "kind": "focus"})
    assert log.status_code == 201

    dashboard = client.get("/api/dashboard")
    assert dashboard.status_code == 200
    data = dashboard.json()
    assert data["has_data"] is True
    assert data["stats"]["streak_days"] >= 1

    analytics = client.get("/api/analytics")
    assert analytics.status_code == 200
    assert analytics.json()["total_topics"] > 0


def test_settings_ai_status_and_backup(client):
    status = client.get("/api/ai/status")
    assert status.status_code == 200
    assert status.json()["provider"] == "offline"

    updated = client.put("/api/settings", json={"student_name": "Jibin", "ai_provider": "offline", "daily_goal_minutes": "90"})
    assert updated.status_code == 200
    assert updated.json()["student_name"] == "Jibin"
    assert updated.json()["ai_configured"] is False

    backup = client.post("/api/backup")
    assert backup.status_code == 200
    assert backup.json()["filename"].endswith(".zip")
    download = client.get("/api/backup/download")
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        assert "aec.db" in archive.namelist()

    notification = client.get("/api/notifications")
    assert notification.status_code == 200


def test_labs_and_visual_library(client):
    labs = client.get("/api/labs")
    assert labs.status_code == 200
    assert len(labs.json()) >= 6
    lab = client.get("/api/labs/rc-step-response")
    assert lab.status_code == 200
    assert "disclaimer" in lab.json()
    saved = client.put("/api/labs/rc-step-response/artifact", json={"code": "print('hello')", "language": "python"})
    assert saved.status_code == 200


def test_persistence_across_client_restart(client, subject):
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as fresh:
        subjects = fresh.get("/api/subjects").json()
        assert any(item["id"] == subject["id"] for item in subjects)
        health = fresh.get("/api/health")
        assert health.status_code == 200
