import io
import json
import re
import uuid
import zipfile
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import SESSION_COOKIE
from app.database import SessionLocal
from app.main import app
from app.models import UserSession, utcnow
from app.web_middleware import PUBLIC_API_PATHS


def register(client: TestClient, name: str, email: str, password: str = "correct-horse-battery"):
    response = client.post("/api/auth/register", json={"name": name, "email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["user"]


def login(client: TestClient, email: str, password: str = "correct-horse-battery"):
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["user"]


@pytest.fixture
def account_mode(monkeypatch):
    monkeypatch.setenv("AEC_REQUIRE_AUTH", "1")
    monkeypatch.setenv("AEC_ALLOW_REGISTRATION", "1")


def test_account_mode_requires_sign_in(account_mode):
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["auth_required"] is True
        status = client.get("/api/auth/status")
        assert status.status_code == 200
        assert status.json()["auth_required"] is True
        assert status.json()["user"] is None
        assert client.get("/api/subjects").status_code == 401
        assert client.get("/api/auth/me").status_code == 401

        email = f"first-{uuid.uuid4().hex[:8]}@example.com"
        user = register(client, "First Student", email)
        assert user["email"] == email
        assert client.get("/api/auth/me").json()["id"] == user["id"]
        created = client.post("/api/subjects", json={"name": "Signals", "code": "ECE201"})
        assert created.status_code == 201
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/subjects").status_code == 401

        assert login(client, email)["id"] == user["id"]


def _protected_api_operations():
    schema = app.openapi()["paths"]
    for path, operations in schema.items():
        if not path.startswith("/api/") or path in PUBLIC_API_PATHS:
            continue
        concrete_path = re.sub(r"\{[^}]+\}", "1", path)
        for method in operations:
            if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                yield method.upper(), concrete_path


def test_every_protected_api_route_rejects_unauthenticated_requests(account_mode):
    operations = list(_protected_api_operations())
    assert len(operations) > 50
    with TestClient(app) as client:
        for method, path in operations:
            kwargs = {"json": {}} if method in {"POST", "PUT", "PATCH"} else {}
            response = client.request(method, path, **kwargs)
            assert response.status_code == 401, f"{method} {path} returned {response.status_code}: {response.text}"
            assert response.json()["detail"] == "Authentication required. Sign in to continue."


def test_invalid_and_expired_sessions_are_rejected(account_mode):
    email = f"session-{uuid.uuid4().hex[:8]}@example.com"
    with TestClient(app) as client:
        user = register(client, "Session Tester", email)

        client.cookies.set(SESSION_COOKIE, "not-a-valid-session")
        assert client.get("/api/auth/me").status_code == 401
        assert client.get("/api/subjects").status_code == 401

        client.cookies.clear()
        login(client, email)
        with SessionLocal() as db:
            session = (
                db.query(UserSession)
                .filter(UserSession.user_id == user["id"])
                .order_by(UserSession.id.desc())
                .first()
            )
            assert session is not None
            session.expires_at = utcnow() - timedelta(seconds=1)
            db.commit()

        assert client.get("/api/auth/me").status_code == 401
        assert client.get("/api/subjects").status_code == 401


def test_tenant_isolation_between_accounts(account_mode):
    email_a = f"a-{uuid.uuid4().hex[:8]}@example.com"
    email_b = f"b-{uuid.uuid4().hex[:8]}@example.com"

    with TestClient(app) as client_a:
        register(client_a, "Student A", email_a)
        subject = client_a.post("/api/subjects", json={"name": "Private Signals", "code": "ECE-A"}).json()
        document = client_a.post(
            "/api/documents/upload",
            files={"file": ("private-notes.txt", b"student A private sampling notes", "text/plain")},
            data={"subject_id": str(subject["id"]), "doc_kind": "notes"},
        )
        assert document.status_code == 201, document.text
        document_id = document.json()["id"]
        conversation = client_a.post(
            "/api/ai/conversations",
            json={"subject_id": subject["id"], "title": "Private conversation"},
        )
        assert conversation.status_code == 201, conversation.text
        conversation_id = conversation.json()["id"]
        note = client_a.post("/api/notifications/read-all")
        assert note.status_code == 200

        with TestClient(app) as client_b:
            register(client_b, "Student B", email_b)
            subjects = client_b.get("/api/subjects").json()
            assert all(item["id"] != subject["id"] for item in subjects)
            assert client_b.get(f"/api/subjects/{subject['id']}").status_code == 404
            assert client_b.get(f"/api/documents/{document_id}").status_code == 404
            assert client_b.get(f"/api/documents/{document_id}/download").status_code == 404
            assert client_b.get(f"/api/ai/conversations/{conversation_id}").status_code == 404
            assert client_b.delete(f"/api/ai/conversations/{conversation_id}").status_code == 404
            assert all(item["id"] != conversation_id for item in client_b.get("/api/ai/conversations").json())
            search = client_b.post("/api/documents/search", json={"query": "sampling notes", "top_k": 5})
            assert search.status_code == 200
            assert search.json()["sources"] == []

        with TestClient(app) as client_a_again:
            login(client_a_again, email_a)
            assert client_a_again.get(f"/api/subjects/{subject['id']}").status_code == 200
            assert client_a_again.get(f"/api/documents/{document_id}").status_code == 200
            assert client_a_again.get(f"/api/ai/conversations/{conversation_id}").status_code == 200


def test_cross_site_mutation_is_blocked(account_mode):
    with TestClient(app) as client:
        register(client, "Origin Tester", f"origin-{uuid.uuid4().hex[:8]}@example.com")
        blocked = client.post(
            "/api/subjects",
            json={"name": "Forged", "code": "XSS"},
            headers={"Origin": "https://evil.example"},
        )
        assert blocked.status_code == 403
        null_origin = client.post(
            "/api/subjects",
            json={"name": "Null Origin", "code": "NULL"},
            headers={"Origin": "null"},
        )
        assert null_origin.status_code == 403
        allowed = client.post(
            "/api/subjects",
            json={"name": "Legitimate", "code": "OK"},
            headers={"Origin": "http://testserver"},
        )
        assert allowed.status_code == 201
        assert all(item["code"] != "XSS" for item in client.get("/api/subjects").json())
        assert all(item["code"] != "NULL" for item in client.get("/api/subjects").json())


def test_per_user_backup_excludes_other_accounts(account_mode):
    email_a = f"backup-a-{uuid.uuid4().hex[:8]}@example.com"
    email_b = f"backup-b-{uuid.uuid4().hex[:8]}@example.com"

    with TestClient(app) as client_a:
        register(client_a, "Backup A", email_a)
        subject = client_a.post("/api/subjects", json={"name": "Only A", "code": "A101"}).json()
        backup = client_a.get("/api/backup/download")
        assert backup.status_code == 200
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            data = json.loads(archive.read("data.json"))
            assert manifest["user"]["email"] == email_a
            assert any(row["id"] == subject["id"] for row in data["subjects"])
            assert manifest["credentials_excluded"] is True

        with TestClient(app) as client_b:
            register(client_b, "Backup B", email_b)
            other = client_b.get("/api/backup/download")
            assert other.status_code == 200
            with zipfile.ZipFile(io.BytesIO(other.content)) as archive:
                manifest_b = json.loads(archive.read("manifest.json"))
                data_b = json.loads(archive.read("data.json"))
                assert manifest_b["user"]["email"] == email_b
                assert all(row["id"] != subject["id"] for row in data_b["subjects"])


def test_backup_restore_round_trip(account_mode):
    email = f"restore-{uuid.uuid4().hex[:8]}@example.com"
    with TestClient(app) as client:
        register(client, "Restore Student", email)
        subject = client.post("/api/subjects", json={"name": "Restored Signals", "code": "RST101"}).json()
        document = client.post(
            "/api/documents/upload",
            files={"file": ("restore-notes.txt", b"Nyquist rate and aliasing notes", "text/plain")},
            data={"subject_id": str(subject["id"]), "doc_kind": "notes"},
        )
        assert document.status_code == 201, document.text
        document_id = document.json()["id"]
        chat = client.post(
            "/api/ai/chat",
            json={"message": "Explain sampling from my notes.", "subject_id": subject["id"]},
        )
        assert chat.status_code == 200, chat.text
        conversation_id = chat.json()["conversation_id"]

        backup = client.get("/api/backup/download")
        assert backup.status_code == 200
        assert client.delete(f"/api/subjects/{subject['id']}").status_code == 200
        assert client.get(f"/api/subjects/{subject['id']}").status_code == 404

        restored = client.post(
            "/api/backup/restore",
            files={"file": ("backup.zip", backup.content, "application/zip")},
        )
        assert restored.status_code == 200, restored.text
        assert restored.json()["counts"]["subjects"] >= 1
        assert client.get(f"/api/subjects/{subject['id']}").status_code == 200
        assert client.get(f"/api/documents/{document_id}").status_code == 200
        conversation = client.get(f"/api/ai/conversations/{conversation_id}")
        assert conversation.status_code == 200
        assert any(item["role"] == "assistant" for item in conversation.json()["messages"])


def test_offline_chat_streams_sse_events(client, subject):
    response = client.post(
        "/api/ai/chat/stream",
        json={"message": "Explain the sampling theorem from my notes.", "subject_id": subject["id"], "mode": "explain"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert "event: meta" in body
    assert "event: delta" in body
    assert "event: done" in body
    assert "offline" in body
    done = json.loads(body.split("event: done", 1)[1].split("data:", 1)[1].strip().splitlines()[0])
    assert done["message_id"] > 0
    detail = client.get(f"/api/ai/conversations/{done['conversation_id']}")
    assert detail.status_code == 200
    assert any(item["id"] == done["message_id"] and item["role"] == "assistant" for item in detail.json()["messages"])


def test_document_capabilities_and_invalid_signature(client):
    capabilities = client.get("/api/documents/capabilities")
    assert capabilities.status_code == 200
    payload = capabilities.json()
    assert payload["max_upload_mb"] >= 1
    assert ".pdf" in payload["allowed_extensions"]

    bad = client.post(
        "/api/documents/upload",
        files={"file": ("fake.pdf", b"this is not a pdf at all", "application/pdf")},
    )
    assert bad.status_code == 400


def test_security_headers_include_csp(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    csp = response.headers["content-security-policy"]
    assert "default-src 'self'" in csp
    assert "object-src 'none'" in csp
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
