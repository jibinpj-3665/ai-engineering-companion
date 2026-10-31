import json
import re
from typing import List, Optional

from sqlalchemy.orm import Session

from ..ai.providers import AIError, chat_completion
from ..models import Document, DocumentChunk, SyllabusTopic
from ..services.settings import get_ai_config

_MODULE_RE = re.compile(r"^\s*(module|unit|part)\s*[-–—:]?\s*([0-9]{1,2}|[ivx]{1,4}|[a-h])\b[\s:.\-–—]*(.*)$", re.IGNORECASE)
_NUMBERED_RE = re.compile(r"^\s*(?:\d+(?:\.\d+)*|[ivx]+\.|[a-z]\))\s+(.{3,180})$", re.IGNORECASE)
_BULLET_RE = re.compile(r"^\s*[-•*]\s+(.{3,180})$")
_MARKS_RE = re.compile(r"(\d{1,3})\s*(?:marks?|mks?)\b", re.IGNORECASE)
_EMPHASIS = {
    "derive": 8, "derivation": 8, "analyze": 7, "analyse": 7, "design": 8, "implement": 7,
    "solve": 6, "prove": 7, "compare": 5, "explain": 4, "evaluate": 6, "calculate": 5,
    "realize": 5, "characteristic": 4, "working": 4, "application": 4,
}
_PRACTICAL = {"lab", "experiment", "practical", "simulation", "design", "implementation", "using", "tool", "matlab"}
_FOUNDATIONAL = {"introduction", "overview", "basics", "fundamentals", "history"}
_IMPORTANT = {"theorem", "transform", "analysis", "circuit", "filter", "modulation", "converter", "processor", "algorithm", "equation"}


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip(" :;.-–—")


def _topic_from_line(line: str) -> Optional[str]:
    numbered = _NUMBERED_RE.match(line)
    if numbered:
        return _clean(numbered.group(1))
    bullet = _BULLET_RE.match(line)
    if bullet:
        return _clean(bullet.group(1))
    if line.strip().isupper() and 4 <= len(line.strip()) <= 90:
        return _clean(line.title())
    return None


def _heuristic_parse(text: str) -> List[dict]:
    topics: List[dict] = []
    current_module = "General"
    module_number = 0
    seen = set()

    def add(title: str, module: str, description: str = "") -> None:
        cleaned = _clean(title)
        if len(cleaned) < 3 or len(cleaned) > 200:
            return
        marks_match = _MARKS_RE.search(cleaned) or _MARKS_RE.search(description)
        cleaned = _clean(_MARKS_RE.sub("", cleaned))
        if len(cleaned) < 3:
            return
        key = (module.lower(), re.sub(r"[^a-z0-9]", "", cleaned.lower()))
        if key in seen:
            return
        seen.add(key)
        topics.append({
            "module": module,
            "unit": "",
            "title": cleaned,
            "description": description.strip()[:800],
            "learning_outcome": "",
            "marks": int(marks_match.group(1)) if marks_match else 0,
        })

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or len(line) > 500:
            continue
        module_match = _MODULE_RE.match(line)
        if module_match:
            module_number += 1
            label = _clean(module_match.group(3))
            current_module = f"Module {module_number}" + (f": {label}" if label else "")
            if label:
                parts = [p for p in re.split(r"[,;]", label) if len(p.strip()) > 4]
                if len(parts) > 1:
                    for part in parts:
                        add(part, current_module)
            continue
        topic = _topic_from_line(line)
        if topic:
            if "," in topic and len(topic) > 90:
                for part in re.split(r"[,;]", topic):
                    add(part, current_module)
            else:
                add(topic, current_module)
            continue
        if not line.endswith(".") and 8 <= len(line) <= 140 and (line[0].isupper() or line[0].isdigit()):
            add(line, current_module)

    if not topics:
        sentences = re.split(r"(?<=[.!?])\s+", _clean(text))
        for sentence in sentences[:120]:
            if 20 <= len(sentence) <= 200:
                add(sentence.rstrip("."), "General")

    return topics[:250]


async def _ai_parse(db: Session, text: str) -> List[dict]:
    cfg = get_ai_config(db)
    if not cfg["configured"]:
        return []
    prompt = (
        "Extract the syllabus structure from the text below. Return ONLY JSON of the form "
        '{"topics":[{"module":"Module 1","unit":"","title":"...","description":"...","learning_outcome":"...","marks":0}]}. '
        "Keep topic titles short. Do not invent topics that are not present. Maximum 150 topics. "
        "marks is an integer, use 0 when unknown.\n\nTEXT:\n" + text[:14000]
    )
    try:
        raw = await chat_completion(db, [{"role": "user", "content": prompt}], temperature=0.1, max_tokens=2800, json_mode=True)
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return []
        data = json.loads(raw[start:end + 1])
        output = []
        for item in data.get("topics", [])[:200]:
            title = _clean(str(item.get("title", "")))
            if len(title) < 3:
                continue
            try:
                marks = int(item.get("marks") or 0)
            except (TypeError, ValueError):
                marks = 0
            output.append({
                "module": _clean(str(item.get("module") or "General"))[:110],
                "unit": _clean(str(item.get("unit") or ""))[:110],
                "title": title[:250],
                "description": str(item.get("description") or "")[:900],
                "learning_outcome": str(item.get("learning_outcome") or "")[:600],
                "marks": max(0, min(marks, 100)),
            })
        return output
    except (AIError, ValueError, TypeError):
        return []


def _question_paper_frequency(db: Session, subject_id: int, title: str) -> tuple[float, int]:
    terms = [w.lower() for w in re.findall(r"[a-zA-Z]{4,}", title)][:6]
    if not terms:
        return 0.0, 0
    chunks = (
        db.query(DocumentChunk)
        .join(Document, DocumentChunk.document_id == Document.id)
        .filter(Document.subject_id == subject_id)
        .filter(Document.status == "ready")
        .filter((Document.doc_kind == "question_paper") | (Document.filename.ilike("%question%")) | (Document.filename.ilike("%paper%")))
        .all()
    )
    hits = 0
    for chunk in chunks:
        lowered = chunk.content.lower()
        if sum(1 for term in terms if term in lowered) >= max(1, len(terms) // 2):
            hits += 1
    return min(1.0, hits / 6.0), hits


def _priority(db: Session, subject_id: int, topic: dict, index: int, total: int) -> tuple[str, float, str, float]:
    score = 38.0
    reasons = []
    title = topic["title"]
    lowered = (title + " " + topic.get("description", "")).lower()
    module_number_match = re.search(r"\d+", topic.get("module", ""))
    module_number = int(module_number_match.group()) if module_number_match else 1

    emphasis = [verb for verb in _EMPHASIS if verb in lowered]
    if emphasis:
        score += min(14, 4 * len(emphasis))
        reasons.append("uses assessment verbs (" + ", ".join(sorted(emphasis)[:3]) + ")")

    marks = int(topic.get("marks") or 0)
    if marks:
        bonus = min(26, marks * 1.6)
        score += bonus
        reasons.append(f"carries {marks} marks in the syllabus")

    frequency, hits = _question_paper_frequency(db, subject_id, title)
    if frequency:
        score += frequency * 18
        reasons.append(f"appears in {hits} indexed question-paper passage(s)")

    if any(word in lowered for word in _IMPORTANT):
        score += 7
        reasons.append("contains core engineering terminology")
    if any(word in lowered for word in _PRACTICAL):
        score += 6
        reasons.append("has practical/design relevance")
    if any(word in lowered for word in _FOUNDATIONAL):
        score -= 6
        reasons.append("is foundational and usually assessed indirectly")
    if module_number <= 2:
        score += 4
        reasons.append("sits in the earlier modules that build prerequisites")
    if total and index >= int(total * 0.8):
        score += 2
        reasons.append("late-syllabus topic often linked to higher-weight modules")

    score = max(8.0, min(96.0, score))
    if score >= 65:
        priority = "high"
    elif score >= 42:
        priority = "medium"
    else:
        priority = "low"
    if not reasons:
        reasons.append("no strong emphasis signals detected in the uploaded syllabus")
    reason = (
        "Priority signals: " + "; ".join(reasons) + ". "
        "This is a study-priority estimate from your uploaded documents, not a prediction of examination content."
    )
    return priority, round(score, 1), reason, round(frequency, 3)


async def parse_syllabus(db: Session, subject_id: int, document_id: int, use_ai: bool = True) -> List[SyllabusTopic]:
    document = db.get(Document, document_id)
    if not document:
        raise ValueError("Document not found")
    try:
        pages = json.loads(document.pages_json or "[]")
    except ValueError:
        pages = []
    text = "\n".join(page.get("text", "") for page in pages)
    if not text.strip():
        raise ValueError("This document has no extracted text. Reprocess it first.")

    topics = await _ai_parse(db, text) if use_ai else []
    generator = "ai" if topics else "heuristic"
    if not topics:
        topics = _heuristic_parse(text)
    if not topics:
        raise ValueError("No syllabus topics could be detected in this document.")

    existing = db.query(SyllabusTopic).filter(SyllabusTopic.subject_id == subject_id).all()
    existing_map = {t.title.lower(): t for t in existing}
    kept_ids = set()
    result: List[SyllabusTopic] = []
    for index, item in enumerate(topics):
        priority, score, reason, frequency = _priority(db, subject_id, item, index, len(topics))
        title = item["title"][:300]
        record = existing_map.get(title.lower())
        if record:
            record.module = item["module"][:120]
            record.unit = item.get("unit", "")[:120]
            record.description = item.get("description", "")[:900]
            record.learning_outcome = item.get("learning_outcome", "")[:600]
            record.marks = item.get("marks", 0)
        else:
            record = SyllabusTopic(
                subject_id=subject_id,
                title=title,
                module=item["module"][:120],
                unit=item.get("unit", "")[:120],
                description=item.get("description", "")[:900],
                learning_outcome=item.get("learning_outcome", "")[:600],
                marks=item.get("marks", 0),
            )
            db.add(record)
        record.priority = priority
        record.priority_score = score
        record.priority_reason = reason
        record.exam_frequency = frequency
        record.source_document_id = document_id
        db.flush()
        kept_ids.add(record.id)
        result.append(record)

    for record in existing:
        if record.id not in kept_ids and record.status == "not_started" and (record.mastery_score or 0) == 0:
            db.delete(record)
    document.doc_kind = "syllabus"
    db.commit()
    for record in result:
        db.refresh(record)
    return result


def coverage(db: Session, subject_id: int) -> dict:
    topics = db.query(SyllabusTopic).filter(SyllabusTopic.subject_id == subject_id).all()
    chunks = (
        db.query(DocumentChunk, Document)
        .join(Document, DocumentChunk.document_id == Document.id)
        .filter(DocumentChunk.subject_id == subject_id, Document.status == "ready")
        .all()
    )
    mapped = []
    missing = []
    for topic in topics:
        terms = [w.lower() for w in re.findall(r"[a-zA-Z]{4,}", topic.title)][:6]
        matches = []
        if terms:
            for chunk, document in chunks:
                lowered = chunk.content.lower()
                hits = sum(1 for term in terms if term in lowered)
                if hits >= max(1, (len(terms) + 1) // 2):
                    matches.append({
                        "document": document.filename,
                        "page": chunk.page,
                        "snippet": chunk.content[:260],
                        "score": round(hits / max(1, len(terms)), 2),
                    })
            matches.sort(key=lambda item: item["score"], reverse=True)
        entry = {"topic_id": topic.id, "title": topic.title, "module": topic.module, "matches": matches[:4]}
        if matches:
            mapped.append(entry)
        else:
            missing.append(entry)
    return {
        "total_topics": len(topics),
        "covered": len(mapped),
        "missing_count": len(missing),
        "mapped": mapped,
        "missing": missing,
        "note": "Coverage is a keyword-based estimate. Always verify that your notes truly cover a topic.",
    }
