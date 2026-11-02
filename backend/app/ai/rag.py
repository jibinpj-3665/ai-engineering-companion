import json
import re
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Document, DocumentChunk
from ..services.settings import LOCAL_EMBEDDING_MODEL, get_ai_config
from .providers import (
    AIError,
    EMBED_DIM,
    embed_texts_sync,
    embedding_signature_matches,
    local_embedding,
)

_WORD_RE = re.compile(r"[a-zA-Z0-9]+")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_CITATION_GROUP_RE = re.compile(r"\[([^\]]*\bS\d+\b[^\]]*)\]", re.IGNORECASE)
_CITATION_LABEL_RE = re.compile(r"\bS(\d+)(?:\s*[-\u2013\u2014]\s*S?(\d+))?", re.IGNORECASE)


def split_text(text: str, max_chars: int = 1000, overlap: int = 120) -> List[str]:
    cleaned = re.sub(r"[ \t]+", " ", (text or "").replace("\r", "")).strip()
    if not cleaned:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", cleaned) if p.strip()]
    chunks: List[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            sentences = _SENTENCE_RE.split(paragraph)
            for sentence in sentences:
                if len(current) + len(sentence) + 1 > max_chars and current:
                    chunks.append(current.strip())
                    current = current[-overlap:] if overlap and len(current) > overlap else ""
                current = f"{current} {sentence}".strip()
        else:
            if len(current) + len(paragraph) + 2 > max_chars and current:
                chunks.append(current.strip())
                current = current[-overlap:] if overlap and len(current) > overlap else ""
            current = f"{current}\n\n{paragraph}".strip()
    if current.strip():
        chunks.append(current.strip())
    return [c for c in chunks if len(c) >= 30]


def build_chunk_records(pages: List[dict]) -> List[dict]:
    records: List[dict] = []
    for page in pages:
        page_number = int(page.get("page", 1))
        heading = (page.get("heading") or "").strip()
        for index, piece in enumerate(split_text(page.get("text", ""))):
            content = piece
            if page.get("headings"):
                prefix = " | ".join(page["headings"][:2])
                if prefix and prefix.lower() not in piece.lower()[:120]:
                    content = f"{prefix}\n{piece}"
            records.append({"page": page_number, "heading": heading, "content": content[:2500]})
    return records


def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


def _keywords(text: str) -> set:
    stop = {
        "the", "and", "for", "with", "that", "this", "from", "have", "are", "was", "were",
        "which", "what", "when", "where", "into", "than", "then", "also", "will", "shall",
        "can", "could", "would", "should", "about", "there", "their", "they", "them",
    }
    return {w.lower() for w in _WORD_RE.findall(text or "") if len(w) > 2 and w.lower() not in stop}


def retrieve(db: Session, query: str, subject_id: Optional[int] = None, top_k: int = 6,
             document_id: Optional[int] = None) -> dict:
    query = (query or "").strip()
    if not query:
        return {"sources": [], "context": "", "mode": "local", "note": "Empty query."}

    cfg = get_ai_config(db)
    active_signature = cfg.get("embedding_signature") or LOCAL_EMBEDDING_MODEL
    qvec = None
    remote_qvec = None
    mode = "local"
    notes: List[str] = []
    if active_signature == LOCAL_EMBEDDING_MODEL:
        qvec = local_embedding(query)
    elif cfg.get("configured") and cfg.get("embedding_configured"):
        try:
            vectors, signature = embed_texts_sync(db, [query], task_type="RETRIEVAL_QUERY")
            if vectors and embedding_signature_matches(signature, active_signature):
                remote_qvec = vectors[0]
                mode = signature
            else:
                notes.append("The remote embedding response did not match the saved embedding configuration.")
        except AIError as exc:
            notes.append(f"Remote embedding failed; keyword-only retrieval was used. {exc}")
    else:
        notes.append("Remote embeddings are not configured; keyword-only retrieval was used.")

    qkeywords = _keywords(query)
    rows_query = db.query(DocumentChunk, Document).join(Document, DocumentChunk.document_id == Document.id)
    if subject_id:
        rows_query = rows_query.filter(DocumentChunk.subject_id == subject_id)
    if document_id:
        rows_query = rows_query.filter(DocumentChunk.document_id == document_id)
    rows = rows_query.filter(Document.status == "ready", Document.active == True).limit(6000).all()  # noqa: E712

    scored = []
    stale_chunks = 0
    for chunk, document in rows:
        try:
            vec = json.loads(chunk.embedding or "[]")
        except ValueError:
            vec = []
        signature_matches = embedding_signature_matches(chunk.embed_provider, active_signature)
        if not signature_matches:
            stale_chunks += 1
        if (
            remote_qvec is not None
            and signature_matches
            and len(vec) == len(remote_qvec)
        ):
            cosine = _cosine(remote_qvec, vec)
        elif (
            qvec is not None
            and signature_matches
            and len(vec) == EMBED_DIM
        ):
            cosine = _cosine(qvec, vec)
        else:
            cosine = 0.0
        chunk_keywords = _keywords(chunk.content)
        overlap = len(qkeywords & chunk_keywords) / max(1, len(qkeywords))
        heading_bonus = 0.05 if chunk.heading and chunk.heading.lower() in query.lower() else 0.0
        score = 0.62 * cosine + 0.38 * overlap + heading_bonus
        if score > 0.02:
            scored.append((score, chunk, document))
    scored.sort(key=lambda item: item[0], reverse=True)

    sources = []
    context_parts = []
    for index, (score, chunk, document) in enumerate(scored[:top_k], start=1):
        snippet = chunk.content.strip()
        if len(snippet) > 700:
            snippet = snippet[:700].rsplit(" ", 1)[0] + "..."
        source = {
            "index": index,
            "label": f"S{index}",
            "document_id": document.id,
            "document": document.filename,
            "page": chunk.page,
            "heading": chunk.heading or "",
            "snippet": snippet,
            "score": round(score, 4),
        }
        sources.append(source)
        context_parts.append(
            f"[S{index}] Source: {document.filename}, page {chunk.page}"
            + (f", section: {chunk.heading}" if chunk.heading else "")
            + f"\n{snippet}"
        )
    if stale_chunks:
        notes.append(
            f"{stale_chunks} indexed section(s) use a different embedding model/provider and were not used "
            "for vector similarity. Re-index documents to enable semantic search with the current embeddings."
        )
    if not sources:
        notes.append("No indexed study material matched this query.")
    return {
        "sources": sources,
        "context": "\n\n".join(context_parts),
        "mode": mode,
        "embedding_signature": active_signature,
        "stale_chunks": stale_chunks,
        "note": " ".join(notes),
    }


def _cited_indexes(answer: str) -> set[int]:
    cited: set[int] = set()
    for group in _CITATION_GROUP_RE.findall(answer or ""):
        for start_raw, end_raw in _CITATION_LABEL_RE.findall(group):
            start = int(start_raw)
            end = int(end_raw) if end_raw else start
            if end < start:
                start, end = end, start
            if end - start > 50:
                cited.add(start)
                cited.add(end)
                continue
            cited.update(range(start, end + 1))
    return cited


def annotate_citations(answer: str, sources: List[dict]) -> tuple[List[dict], dict]:
    cited = _cited_indexes(answer)
    valid = {int(source.get("index", 0)) for source in sources}
    known = sorted(cited & valid)
    unknown = sorted(cited - valid)
    annotated = [
        {**source, "cited": int(source.get("index", 0)) in cited}
        for source in sources
    ]
    return annotated, {
        "labels": [f"S{index}" for index in known],
        "unknown_labels": [f"S{index}" for index in unknown],
        "uncited": bool(sources) and not known,
    }


def offline_answer(question: str, retrieval: dict, topic_hint: str = "") -> str:
    sources = retrieval.get("sources", [])
    header = (
        "**Offline study mode** — no AI provider is configured, so this response is built only from "
        "your indexed study material and cannot add outside academic knowledge.\n\n"
    )
    if not sources:
        hint = f" for **{topic_hint}**" if topic_hint else ""
        return header + (
            f"I could not find relevant indexed material{hint}. Upload notes, a textbook chapter, or a syllabus "
            "document, then ask again. You can also configure an OpenAI-compatible provider in Settings for "
            "full tutoring, derivations and generated examples.\n\n"
            "*This is not an answer to the academic question — it is a retrieval notice.*"
        )
    lines = [
        header,
        f"### What your material says about “{question.strip()[:160]}”\n",
    ]
    for source in sources[:4]:
        snippet = source["snippet"].strip()
        lines.append(f"- **{source['document']} — page {source['page']}**" + (f" · {source['heading']}" if source["heading"] else ""))
        lines.append(f"  > {snippet}")
    lines.append(
        "\n### How to use this\n"
        "1. Identify the definitions and equations in the excerpts above.\n"
        "2. Write the derivation or explanation in your own words.\n"
        "3. Use Active Recall in the Teaching workspace to check your understanding.\n\n"
        "*Answer assembled from retrieved excerpts only. No additional academic claims were generated.*"
    )
    return "\n".join(lines)
