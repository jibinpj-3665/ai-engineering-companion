import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from sqlalchemy.orm import Session

from ..ai.providers import embed_texts_sync
from ..ai.rag import build_chunk_records
from ..database import SessionLocal
from ..models import Document, DocumentChunk, Notification, Subject

_HEADING_RE = re.compile(r"^(module|unit|chapter|section|topic)\s+[0-9ivx]+", re.IGNORECASE)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def _ocr_image(path: Path) -> str:
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("PyTesseract/Pillow are not installed.") from exc
    if not ocr_available():
        raise RuntimeError(
            "OCR requires the Tesseract engine. Install Tesseract OCR for Windows and add it to PATH, "
            "or upload a text-based PDF."
        )
    return pytesseract.image_to_string(Image.open(path))


def _extract_pdf(path: Path) -> List[dict]:
    import fitz

    pages: List[dict] = []
    notes: List[str] = []
    with fitz.open(str(path)) as pdf:
        for number, page in enumerate(pdf, start=1):
            text = page.get_text("text") or ""
            headings: List[str] = []
            try:
                blocks = page.get_text("dict").get("blocks", [])
                for block in blocks:
                    for line in block.get("lines", []):
                        snippet = " ".join(span.get("text", "") for span in line.get("spans", [])).strip()
                        if not snippet or len(snippet) > 110:
                            continue
                        sizes = [span.get("size", 0) for span in line.get("spans", [])]
                        bold = any(span.get("flags", 0) & 16 for span in line.get("spans", []))
                        max_size = max(sizes) if sizes else 0
                        if snippet.endswith(":") and len(snippet) < 40:
                            headings.append(snippet.rstrip(":"))
                        elif max_size >= 13.5 and (bold or snippet.isupper()) and len(snippet.split()) <= 12:
                            headings.append(snippet)
                        elif _HEADING_RE.match(snippet):
                            headings.append(snippet)
            except Exception:
                headings = []

            if len(text.strip()) < 25:
                if ocr_available():
                    try:
                        pixmap = page.get_pixmap(dpi=200)
                        image_bytes = pixmap.tobytes("png")
                        import io

                        import pytesseract
                        from PIL import Image

                        text = pytesseract.image_to_string(Image.open(io.BytesIO(image_bytes))) or ""
                        if text.strip():
                            notes.append(f"Page {number} was processed with OCR.")
                    except Exception:
                        notes.append(f"Page {number} appears scanned; OCR failed.")
                else:
                    notes.append(f"Page {number} appears scanned; Tesseract OCR is not installed.")

            try:
                tables = page.find_tables()
                table_rows = []
                for table in tables.tables:
                    for row in table.extract():
                        cells = [str(cell).strip() for cell in row if cell]
                        if cells:
                            table_rows.append(" | ".join(cells))
                if table_rows:
                    text += "\n\n[Tables]\n" + "\n".join(table_rows[:120])
            except Exception:
                pass

            if text.strip():
                pages.append({
                    "page": number,
                    "text": text,
                    "headings": list(dict.fromkeys(headings))[:6],
                    "heading": headings[0] if headings else f"Page {number}",
                })
    if notes:
        pages.insert(0, {"page": 0, "text": "\n".join(notes), "headings": ["Extraction notes"], "heading": "Extraction notes"})
    return pages


def _extract_docx(path: Path) -> List[dict]:
    from docx import Document as DocxDocument

    document = DocxDocument(str(path))
    sections: List[dict] = []
    current_heading = "Document"
    buffer: List[str] = []
    counter = 1

    def flush():
        nonlocal buffer, counter
        text = "\n".join(buffer).strip()
        if text:
            sections.append({
                "page": counter,
                "text": text,
                "headings": [current_heading] if current_heading else [],
                "heading": current_heading,
            })
            counter += 1
        buffer = []

    for paragraph in document.paragraphs:
        content = paragraph.text.strip()
        if not content:
            continue
        style = (paragraph.style.name if paragraph.style else "").lower()
        if style.startswith("heading") or (len(content) < 90 and content.endswith(":") is False and style.startswith("title")):
            flush()
            current_heading = content
        else:
            buffer.append(content)
    flush()
    if document.tables:
        rows = []
        for table in document.tables:
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if cells:
                    rows.append(" | ".join(cells))
        if rows:
            sections.append({
                "page": counter,
                "text": "[Extracted tables]\n" + "\n".join(rows[:200]),
                "headings": ["Tables"],
                "heading": "Tables",
            })
    return sections


def _extract_pptx(path: Path) -> List[dict]:
    from pptx import Presentation

    prs = Presentation(str(path))
    slides: List[dict] = []
    for number, slide in enumerate(prs.slides, start=1):
        texts = []
        title = ""
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text.strip():
                value = shape.text.strip()
                texts.append(value)
                if not title and shape == slide.shapes.title:
                    title = value
        if texts:
            slides.append({
                "page": number,
                "text": "\n".join(texts),
                "headings": [title] if title else [],
                "heading": title or f"Slide {number}",
            })
    return slides


def _extract_txt(path: Path) -> List[dict]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    blocks = [block.strip() for block in re.split(r"\n\s*\n", raw) if block.strip()]
    sections: List[dict] = []
    buffer: List[str] = []
    page = 1
    length = 0
    for block in blocks:
        buffer.append(block)
        length += len(block)
        if length > 3200:
            sections.append({"page": page, "text": "\n\n".join(buffer), "headings": [], "heading": f"Section {page}"})
            buffer = []
            length = 0
            page += 1
    if buffer:
        sections.append({"page": page, "text": "\n\n".join(buffer), "headings": [], "heading": f"Section {page}"})
    return sections


def extract_document(path: Path) -> List[dict]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf(path)
    if suffix == ".docx":
        return _extract_docx(path)
    if suffix == ".pptx":
        return _extract_pptx(path)
    if suffix in {".txt", ".md"}:
        return _extract_txt(path)
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}:
        text = _ocr_image(path)
        if not text.strip():
            raise RuntimeError("No readable text was found in the image.")
        return [{"page": 1, "text": text, "headings": [], "heading": path.name}]
    raise RuntimeError(f"Unsupported document type: {suffix}")


def guess_kind(filename: str) -> str:
    lowered = filename.lower()
    if "syllab" in lowered:
        return "syllabus"
    if any(word in lowered for word in ("question", "qp", "paper", "previous", "past")):
        return "question_paper"
    if any(word in lowered for word in ("lab", "manual", "experiment")):
        return "lab"
    return "notes"


def _update_notification(db: Session, document: Document) -> None:
    db.add(Notification(
        title=f"{document.filename} is ready",
        body=f"{document.page_count} pages/sections indexed for semantic search.",
        kind="success",
    ))


def process_document(db: Session, document_id: int) -> None:
    document = db.get(Document, document_id)
    if not document:
        return
    document.status = "processing"
    document.error = ""
    db.commit()
    try:
        path = Path(document.stored_path)
        if not path.exists():
            raise RuntimeError("Stored file is missing from disk.")
        pages = extract_document(path)
        if not pages:
            raise RuntimeError("No extractable text was found in this document.")
        document.pages_json = json.dumps(pages, ensure_ascii=False)
        document.page_count = len([p for p in pages if p.get("page", 0) > 0])
        db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).delete()
        records = build_chunk_records(pages)
        if not records:
            raise RuntimeError("Text was extracted but no study chunks could be built.")
        vectors: List[List[float]] = []
        provider = "local-hash-v1"
        batch_size = 16
        for start in range(0, len(records), batch_size):
            batch = records[start:start + batch_size]
            batch_vectors, provider = embed_texts_sync(db, [item["content"] for item in batch])
            vectors.extend(batch_vectors)
        for record, vector in zip(records, vectors):
            db.add(DocumentChunk(
                document_id=document.id,
                subject_id=document.subject_id,
                page=record["page"],
                heading=record["heading"],
                content=record["content"],
                embedding=json.dumps([round(v, 6) for v in vector]),
                embed_provider=provider,
            ))
        document.status = "ready"
        document.processed_at = _utcnow()
        _update_notification(db, document)
        db.commit()
    except Exception as exc:
        db.rollback()
        document = db.get(Document, document_id)
        if document:
            document.status = "failed"
            document.error = str(exc)[:1000]
            db.commit()


def process_document_task(document_id: int) -> None:
    db = SessionLocal()
    try:
        process_document(db, document_id)
    finally:
        db.close()


def reindex_subject_documents(db: Session, subject_id: int | None = None) -> int:
    query = db.query(Document).filter(Document.status == "ready")
    if subject_id:
        query = query.filter(Document.subject_id == subject_id)
    documents = query.all()
    for document in documents:
        process_document(db, document.id)
    return len(documents)
