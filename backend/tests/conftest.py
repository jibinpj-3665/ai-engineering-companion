import os
import tempfile
from pathlib import Path

os.environ["AIEC_DATA_DIR"] = tempfile.mkdtemp(prefix="aec-test-")
os.environ["AEC_STATIC_DIR"] = str(Path(tempfile.mkdtemp(prefix="aec-static-")) / "dist")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import init_db


@pytest.fixture(scope="session")
def client():
    init_db()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def subject(client):
    response = client.post("/api/subjects", json={
        "name": "Digital Signal Processing",
        "code": "ECE301",
        "semester": "S5",
        "department": "Electronics",
        "description": "Signals, sampling, transforms and filters.",
    })
    assert response.status_code == 201, response.text
    return response.json()


def upload_text(client, subject_id, filename, text, doc_kind="notes"):
    files = {"file": (filename, text.encode("utf-8"), "text/plain")}
    response = client.post("/api/documents/upload", files=files, data={"subject_id": str(subject_id), "doc_kind": doc_kind})
    assert response.status_code == 201, response.text
    document = response.json()
    detail = client.get(f"/api/documents/{document['id']}").json()
    assert detail["status"] == "ready", detail
    return detail
