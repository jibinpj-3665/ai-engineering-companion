import io

import fitz
from docx import Document as DocxDocument

from tests.conftest import upload_text


def _upload(client, subject_id, filename, payload, content_type):
    response = client.post(
        "/api/documents/upload",
        files={"file": (filename, payload, content_type)},
        data={"subject_id": str(subject_id), "doc_kind": "syllabus"},
    )
    assert response.status_code == 201, response.text
    detail = client.get(f"/api/documents/{response.json()['id']}").json()
    assert detail["status"] == "ready", detail
    return detail


def test_pdf_page_metadata_is_preserved(client, subject):
    pdf = fitz.open()
    first = pdf.new_page()
    first.insert_text((72, 72), "Module 1: Signals and Systems")
    second = pdf.new_page()
    second.insert_text((72, 72), "Module 2: The sampling theorem requires a rate above twice the maximum frequency. Aliasing occurs below the Nyquist rate.")
    payload = pdf.tobytes()
    pdf.close()

    document = _upload(client, subject["id"], "sahrdaya-style-syllabus.pdf", payload, "application/pdf")
    assert document["page_count"] == 2

    search = client.post(
        "/api/documents/search",
        json={"query": "Nyquist aliasing sampling theorem", "subject_id": subject["id"], "top_k": 3},
    )
    assert search.status_code == 200, search.text
    sources = search.json()["sources"]
    assert sources
    match = next(source for source in sources if "syllabus.pdf" in source["document"])
    assert match["page"] == 2
    assert match["label"].startswith("S")
    assert "Module 2" in match["snippet"]


def test_docx_sections_are_indexed_and_searchable(client, subject):
    docx = DocxDocument()
    docx.add_heading("Module 3: Digital Filters", level=1)
    docx.add_paragraph("An FIR filter has a finite impulse response and no feedback. It can be designed with a linear phase response.")
    buffer = io.BytesIO()
    docx.save(buffer)

    document = _upload(
        client,
        subject["id"],
        "sahrdaya-style-module.docx",
        buffer.getvalue(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    assert document["page_count"] >= 1

    search = client.post(
        "/api/documents/search",
        json={"query": "FIR linear phase finite impulse response", "subject_id": subject["id"], "top_k": 3},
    )
    assert search.status_code == 200, search.text
    sources = search.json()["sources"]
    assert any("module.docx" in source["document"] for source in sources)
    assert all(source["page"] >= 0 for source in sources)


def test_txt_upload_remains_searchable(client, subject):
    document = upload_text(
        client,
        subject["id"],
        "sahrdaya-style-notes.txt",
        "The z transform converts a discrete-time signal into the complex frequency domain. The region of convergence must be stated.",
        doc_kind="syllabus",
    )
    search = client.post(
        "/api/documents/search",
        json={"query": "z transform region of convergence", "subject_id": subject["id"], "top_k": 3},
    )
    assert search.status_code == 200, search.text
    assert any("notes.txt" in source["document"] for source in search.json()["sources"])
    assert document["status"] == "ready"
