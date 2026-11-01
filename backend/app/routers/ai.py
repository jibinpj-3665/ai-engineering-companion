import asyncio
import json
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..ai.providers import (
    AIError,
    chat_completion,
    list_models,
    stream_chat_completion,
    test_connection,
)
from ..ai.rag import annotate_citations, offline_answer, retrieve
from ..config import ENV_AI_KEYS
from ..database import SessionLocal, current_user_id, get_db, reset_current_user, set_current_user
from ..models import (
    AIUsageLog,
    Conversation,
    Document,
    DocumentChunk,
    Message,
    Subject,
    SyllabusTopic,
    utcnow,
)
from ..serializers import iso
from ..services.settings import get_ai_config, normalize_provider

router = APIRouter(prefix="/ai", tags=["ai"])

PERSONALITIES = {
    "study_buddy": "You are a friendly engineering study buddy. Be encouraging, clear and concise. Ask one short understanding-check question at the end.",
    "professor": "You are a rigorous university engineering professor. Define terms precisely, state assumptions, and maintain a formal but supportive tone.",
    "examiner": "You are a strict but fair examiner. Challenge weak reasoning, give hints before answers, and point out what would lose marks.",
    "mentor": "You are a senior engineering mentor with industry experience. Connect theory to practice, design trade-offs and career skills.",
    "beginner_teacher": "You are a beginner-friendly teacher. Use everyday analogies, short sentences and avoid unexplained jargon.",
}

MODES = {
    "chat": "Answer the student's engineering question directly and clearly.",
    "explain": (
        "Teach this topic in a structured engineering lesson: definition, physical intuition, governing equations "
        "and assumptions, a step-by-step derivation or worked example, common mistakes, and one check-for-understanding question."
    ),
    "socratic": (
        "Do not give the complete answer immediately. Ask one focused guiding question, wait for the student, and give "
        "a small hint only if needed. Build toward the answer through questions."
    ),
    "derive": (
        "Derive the result from first principles. List assumptions, define every symbol with units, show each algebraic "
        "step, and state when the result is valid."
    ),
    "example": (
        "Create one fully solved, realistic numerical engineering example. State givens with units, show every step, "
        "check units and reasonableness, then give one similar practice problem without its answer."
    ),
    "simplify": (
        "Explain the idea in beginner-friendly language with one everyday analogy, then re-state the precise technical "
        "version and note where the analogy breaks down."
    ),
    "quiz": (
        "Quiz the student with exactly one question. Do not reveal the answer or solution. Wait for the student's response."
    ),
    "debug": (
        "Act as a debugging coach. Identify the likely error, explain the diagnostic reasoning, give one hint at a time, "
        "and ask the student to predict the result before revealing a fix."
    ),
    "evaluate": (
        "Evaluate the student's answer like a careful examiner. Separate what is correct, what is incomplete, and what is "
        "wrong. Do not award mastery; mastery is only recorded by a graded quiz attempt."
    ),
}

SYSTEM_PROMPT = (
    "You are the AI engineering tutor inside AI Engineering Companion. You help undergraduates learn electronics, "
    "computer science, mathematics and engineering design. Ground claims in the retrieved study material and cite it "
    "as [S1], [S2]. Clearly separate (1) uploaded study material, (2) additional academic knowledge, and (3) "
    "AI-generated examples. Use only the source labels supplied in the prompt and cite each grounded claim with its "
    "exact label, such as [S1]. Never renumber sources, invent citations, pages, document names, exam frequencies or "
    "guarantees. If the retrieved material is insufficient, say so explicitly. Write Markdown and LaTeX equations. Be "
    "precise with units, assumptions and sign conventions. Prefer a short teaching cycle over long lectures: explain, "
    "demonstrate, then ask. Never claim the student has mastered something; mastery is recorded only by graded quiz attempts."
)

PROVIDER_PRESETS = [
    {
        "id": "openai",
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "requires_key": True,
        "note": "GPT models through the OpenAI API.",
    },
    {
        "id": "gemini",
        "label": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "model": "gemini-3.5-flash",
        "requires_key": True,
        "note": "Gemini models through the Google AI Studio API.",
    },
    {
        "id": "groq",
        "label": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
        "requires_key": True,
        "note": "Fast OpenAI-compatible inference from Groq.",
    },
    {
        "id": "local",
        "label": "Ollama / local server",
        "base_url": "http://127.0.0.1:11434/v1",
        "model": "llama3.1",
        "requires_key": False,
        "note": "OpenAI-compatible local server such as Ollama. No cloud key required.",
    },
    {
        "id": "custom",
        "label": "Custom OpenAI-compatible",
        "base_url": "",
        "model": "",
        "requires_key": False,
        "note": "Any OpenAI-compatible chat endpoint, including self-hosted gateways.",
    },
    {
        "id": "offline",
        "label": "Offline retrieval only",
        "base_url": "",
        "model": "",
        "requires_key": False,
        "note": "No AI generation. Answers quote indexed material and are explicitly labelled.",
    },
]


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=6000)
    conversation_id: Optional[int] = None
    subject_id: Optional[int] = None
    topic_id: Optional[int] = None
    personality: str = "study_buddy"
    mode: str = "chat"


class ConversationCreate(BaseModel):
    subject_id: Optional[int] = None
    title: str = "New conversation"
    personality: str = "study_buddy"


class EvaluateRequest(BaseModel):
    question: str = Field(min_length=3, max_length=3000)
    answer: str = Field(min_length=1, max_length=6000)
    subject_id: Optional[int] = None
    topic_id: Optional[int] = None


def _validate_mode(mode: str) -> str:
    return mode if mode in MODES else "chat"


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _prepare_chat(db: Session, payload: ChatRequest) -> dict:
    conversation = db.get(Conversation, payload.conversation_id) if payload.conversation_id else None
    if conversation is None:
        title = payload.message.strip()[:60] + ("..." if len(payload.message.strip()) > 60 else "")
        conversation = Conversation(
            subject_id=payload.subject_id,
            title=title or "New conversation",
            personality=payload.personality,
        )
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

    if not db.query(Message).filter(Message.conversation_id == conversation.id).first():
        conversation.title = payload.message.strip()[:60] or conversation.title
    conversation.updated_at = utcnow()
    if payload.personality in PERSONALITIES:
        conversation.personality = payload.personality

    topic = db.get(SyllabusTopic, payload.topic_id) if payload.topic_id else None
    subject_id = payload.subject_id or conversation.subject_id or (topic.subject_id if topic else None)
    subject = db.get(Subject, subject_id) if subject_id else None
    query = f"{topic.title} {payload.message}" if topic else payload.message
    retrieval = retrieve(db, query, subject_id=subject.id if subject else None, top_k=6)

    history = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc())
        .limit(10)
        .all()
    )
    history.reverse()

    mode = _validate_mode(payload.mode)
    user_message = Message(
        conversation_id=conversation.id,
        role="user",
        content=payload.message,
        sources_json="[]",
        mode=mode,
    )
    db.add(user_message)
    db.commit()
    db.refresh(user_message)

    weak_topics = []
    if subject:
        weak_topics = (
            db.query(SyllabusTopic)
            .filter(
                SyllabusTopic.subject_id == subject.id,
                SyllabusTopic.status != "mastered",
                SyllabusTopic.mastery_score < 65,
            )
            .order_by(SyllabusTopic.priority_score.desc())
            .limit(5)
            .all()
        )

    cfg = get_ai_config(db)
    source_list = "\n".join(
        f"[S{source['index']}] {source['document']}, page {source['page']}"
        + (f", section {source['heading']}" if source["heading"] else "")
        for source in retrieval.get("sources", [])
    ) or "No indexed sources matched."
    weak_list = "\n".join(
        f"- {item.title} ({item.status}, mastery {round(item.mastery_score or 0)}%)" for item in weak_topics
    ) or "No weak-topic data recorded."

    system = (
        SYSTEM_PROMPT
        + " "
        + PERSONALITIES.get(conversation.personality, PERSONALITIES["study_buddy"])
        + "\n\nTeaching mode: "
        + MODES[mode]
    )
    messages = [{"role": "system", "content": system}]
    for item in history[-8:]:
        if item.role in {"user", "assistant"}:
            messages.append({"role": item.role, "content": item.content[:2000]})
    messages.append(
        {
            "role": "user",
            "content": (
                f"Student message: {payload.message}\n\n"
                f"Subject: {subject.name if subject else 'General'}\n"
                f"Topic: {topic.title if topic else 'General'}\n"
                f"Requested teaching mode: {mode}\n\n"
                f"Weak topics in this subject:\n{weak_list}\n\n"
                f"Available sources:\n{source_list}\n\n"
                f"Retrieved material:\n{retrieval.get('context') or 'No matching uploaded material was retrieved.'}\n\n"
                "Follow the requested teaching mode. Cite retrieved material with its source labels. "
                "If the uploaded material does not answer the question, say so before adding clearly labelled general knowledge."
            ),
        }
    )
    hint = topic.title if topic else (subject.name if subject else "")
    return {
        "conversation": conversation,
        "topic": topic,
        "subject": subject,
        "retrieval": retrieval,
        "cfg": cfg,
        "messages": messages,
        "mode": mode,
        "user_message": user_message,
        "hint": hint,
    }


@router.get("/status")
def ai_status(db: Session = Depends(get_db)):
    cfg = get_ai_config(db)
    return {
        "provider": cfg["provider"],
        "configured": cfg["configured"],
        "model": cfg["model"],
        "base_url": cfg["base_url"],
        "key_source": cfg["key_source"],
        "env_key_set": cfg["env_key_set"],
        "embedding_provider": cfg["embedding_provider"],
        "indexed_chunks": db.query(DocumentChunk)
        .join(Document, Document.id == DocumentChunk.document_id)
        .filter(Document.active.is_(True), Document.status == "ready")
        .count(),
        "ready_documents": db.query(Document)
        .filter(Document.status == "ready", Document.active.is_(True))
        .count(),
        "message": "AI provider configured." if cfg["configured"] else "Offline mode: answers use only your indexed material.",
    }


@router.get("/providers")
def providers(db: Session = Depends(get_db)):
    cfg = get_ai_config(db)
    return {
        "providers": [
            {
                **preset,
                "env_key_set": bool(ENV_AI_KEYS.get(preset["id"])),
                "selected": preset["id"] == cfg["provider"],
            }
            for preset in PROVIDER_PRESETS
        ],
        "current": cfg["provider"],
        "key_source": cfg["key_source"],
    }


@router.post("/models")
async def models(db: Session = Depends(get_db)):
    try:
        return await list_models(db)
    except AIError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/test")
async def test(db: Session = Depends(get_db)):
    return await test_connection(db)


@router.get("/usage")
def usage(limit: int = 30, db: Session = Depends(get_db)):
    limit = max(1, min(limit, 200))
    logs = db.query(AIUsageLog).order_by(AIUsageLog.created_at.desc()).limit(limit).all()
    total = db.query(AIUsageLog).count()
    errors = db.query(AIUsageLog).filter(AIUsageLog.status == "error").count()
    return {
        "summary": {"requests": total, "errors": errors},
        "logs": [
            {
                "id": row.id,
                "provider": row.provider,
                "model": row.model,
                "operation": row.operation,
                "status": row.status,
                "input_chars": row.input_chars,
                "output_chars": row.output_chars,
                "latency_ms": row.latency_ms,
                "error": row.error,
                "created_at": iso(row.created_at),
            }
            for row in logs
        ],
    }


@router.get("/conversations")
def list_conversations(subject_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Conversation)
    if subject_id:
        query = query.filter(Conversation.subject_id == subject_id)
    conversations = query.order_by(Conversation.updated_at.desc()).all()
    output = []
    for conversation in conversations:
        last = (
            db.query(Message)
            .filter(Message.conversation_id == conversation.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        output.append({
            "id": conversation.id,
            "subject_id": conversation.subject_id,
            "title": conversation.title,
            "personality": conversation.personality,
            "updated_at": iso(conversation.updated_at),
            "preview": (last.content[:120] if last else ""),
            "message_count": db.query(Message).filter(Message.conversation_id == conversation.id).count(),
        })
    return output


@router.post("/conversations", status_code=201)
def create_conversation(payload: ConversationCreate, db: Session = Depends(get_db)):
    conversation = Conversation(subject_id=payload.subject_id, title=payload.title, personality=payload.personality)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return {"id": conversation.id, "subject_id": conversation.subject_id, "title": conversation.title, "personality": conversation.personality}


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = db.query(Message).filter(Message.conversation_id == conversation_id).order_by(Message.created_at).all()
    return {
        "id": conversation.id,
        "subject_id": conversation.subject_id,
        "title": conversation.title,
        "personality": conversation.personality,
        "messages": [
            {
                "id": message.id,
                "role": message.role,
                "content": message.content,
                "sources": json.loads(message.sources_json or "[]"),
                "mode": message.mode,
                "created_at": iso(message.created_at),
            }
            for message in messages
        ],
    }


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(conversation)
    db.commit()
    return {"ok": True}


@router.post("/chat")
async def chat(payload: ChatRequest, db: Session = Depends(get_db)):
    prepared = _prepare_chat(db, payload)
    conversation = prepared["conversation"]
    retrieval = prepared["retrieval"]
    cfg = prepared["cfg"]
    generator = "offline"
    note = ""
    error_detail = ""
    if cfg["configured"]:
        try:
            answer = await chat_completion(db, prepared["messages"], operation="tutor_chat")
            generator = "ai"
        except AIError as exc:
            error_detail = str(exc)
            answer = offline_answer(payload.message, retrieval, prepared["hint"])
            note = f"AI provider failed; this is an explicitly labelled offline retrieval answer. {exc}"
    else:
        answer = offline_answer(payload.message, retrieval, prepared["hint"])
        note = "Offline mode: configure an AI provider for full tutoring."

    sources, citation_info = annotate_citations(answer, retrieval.get("sources", []))
    if generator == "ai" and citation_info["uncited"]:
        note = (note + " " if note else "") + "The answer did not contain [S#] citations; verify it against the retrieved sources."
    assistant_message = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=answer,
        sources_json=json.dumps(sources),
        mode=prepared["mode"],
    )
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)
    db.refresh(conversation)

    return {
        "conversation_id": conversation.id,
        "conversation_title": conversation.title,
        "generator": generator,
        "note": note,
        "error": error_detail,
        "sources": sources,
        "citations": citation_info,
        "message": {
            "id": assistant_message.id,
            "role": "assistant",
            "content": answer,
            "created_at": iso(assistant_message.created_at),
        },
    }


@router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, db: Session = Depends(get_db)):
    prepared = _prepare_chat(db, payload)
    conversation_id = prepared["conversation"].id
    conversation_title = prepared["conversation"].title
    retrieval = prepared["retrieval"]
    cfg = prepared["cfg"]
    mode = prepared["mode"]
    sources = retrieval.get("sources", [])
    user_message_id = prepared["user_message"].id
    hint = prepared["hint"]
    messages = prepared["messages"]
    user_id = current_user_id.get()

    async def _generate_events():
        generator_name = "ai" if cfg["configured"] else "offline"
        note = "" if cfg["configured"] else "Offline mode: configure an AI provider for full tutoring."
        title = conversation_title
        yield _sse(
            "meta",
            {
                "conversation_id": conversation_id,
                "conversation_title": title,
                "generator": generator_name,
                "sources": sources,
                "user_message_id": user_message_id,
                "mode": mode,
            },
        )
        answer_parts = []
        stream_db = SessionLocal()
        try:
            if cfg["configured"]:
                try:
                    async for token in stream_chat_completion(
                        stream_db, messages, operation="tutor_stream"
                    ):
                        if token:
                            answer_parts.append(token)
                            yield _sse("delta", {"text": token})
                    if not answer_parts:
                        raise AIError("The AI provider returned an empty response.")
                except AIError as exc:
                    note = f"AI provider failed; this is an explicitly labelled offline retrieval answer. {exc}"
                    generator_name = "offline"
                    yield _sse("error", {"detail": str(exc), "generator": "offline"})
                    fallback = offline_answer(payload.message, retrieval, hint)
                    for start in range(0, len(fallback), 180):
                        piece = fallback[start:start + 180]
                        answer_parts.append(piece)
                        yield _sse("delta", {"text": piece})
                        await asyncio.sleep(0.01)
            else:
                fallback = offline_answer(payload.message, retrieval, hint)
                for start in range(0, len(fallback), 180):
                    piece = fallback[start:start + 180]
                    answer_parts.append(piece)
                    yield _sse("delta", {"text": piece})
                    await asyncio.sleep(0.01)

            answer = "".join(answer_parts)
            answer_sources, citation_info = annotate_citations(answer, sources)
            if generator_name == "ai" and citation_info["uncited"]:
                warning = "The answer did not contain [S#] citations; verify it against the retrieved sources."
                note = (note + " " if note else "") + warning
            try:
                assistant_message = Message(
                    conversation_id=conversation_id,
                    user_id=user_id,
                    role="assistant",
                    content=answer,
                    sources_json=json.dumps(answer_sources),
                    mode=mode,
                )
                stream_db.add(assistant_message)
                stream_db.commit()
                stream_db.refresh(assistant_message)
                conversation = stream_db.get(Conversation, conversation_id)
                if conversation is not None:
                    title = conversation.title
            except Exception as exc:  # noqa: BLE001
                stream_db.rollback()
                yield _sse("error", {"detail": f"The answer could not be saved: {exc}"})
                yield _sse(
                    "done",
                    {
                        "message_id": 0,
                        "conversation_id": conversation_id,
                        "conversation_title": title,
                        "generator": generator_name,
                        "note": note,
                        "sources": answer_sources,
                        "citations": citation_info,
                    },
                )
                return
        finally:
            stream_db.close()
        yield _sse(
            "done",
            {
                "message_id": assistant_message.id,
                "conversation_id": conversation_id,
                "conversation_title": title,
                "generator": generator_name,
                "note": note,
                "sources": answer_sources,
                "citations": citation_info,
            },
        )

    async def generate():
        token = set_current_user(user_id) if user_id is not None else None
        try:
            async for event in _generate_events():
                yield event
        finally:
            if token is not None:
                reset_current_user(token)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _parse_evaluation(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start:end + 1]
    data = json.loads(text)
    score = max(0, min(100, int(float(data.get("score", 0)))))
    return {
        "score": score,
        "verdict": str(data.get("verdict", ""))[:800],
        "strengths": [str(item)[:500] for item in (data.get("strengths") or [])][:8],
        "gaps": [str(item)[:500] for item in (data.get("gaps") or [])][:8],
        "corrected_answer": str(data.get("corrected_answer", ""))[:5000],
        "next_step": str(data.get("next_step", ""))[:1000],
    }


@router.post("/evaluate")
async def evaluate(payload: EvaluateRequest, db: Session = Depends(get_db)):
    retrieval = retrieve(db, payload.question, subject_id=payload.subject_id, top_k=5)
    cfg = get_ai_config(db)
    if cfg["configured"]:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Evaluate the student's answer using the uploaded sources. Return strict JSON with keys: "
                    "score (0-100), verdict, strengths (array), gaps (array), corrected_answer, next_step. "
                    "Do not award mastery and do not invent sources.\n\n"
                    f"Question:\n{payload.question}\n\nStudent answer:\n{payload.answer}\n\n"
                    f"Sources:\n{retrieval.get('context') or 'No matching uploaded material.'}"
                ),
            },
        ]
        try:
            raw = await chat_completion(db, messages, max_tokens=1200, temperature=0.2, json_mode=True,
                                        operation="answer_evaluation")
            result = _parse_evaluation(raw)
            result.update({"generator": "ai", "sources": retrieval.get("sources", []), "mastery_recorded": False})
            return result
        except (AIError, ValueError, TypeError) as exc:
            return {
                "generator": "offline",
                "score": 0,
                "verdict": f"AI evaluation failed: {exc}",
                "strengths": [],
                "gaps": [],
                "corrected_answer": offline_answer(payload.question, retrieval),
                "next_step": "Use a graded quiz attempt to record mastery.",
                "sources": retrieval.get("sources", []),
                "mastery_recorded": False,
                "note": "Offline fallback only; this is not a mastery grade.",
            }
    return {
        "generator": "offline",
        "score": 0,
        "verdict": "No AI provider is configured. The app cannot semantically grade a free-text answer offline.",
        "strengths": [],
        "gaps": [],
        "corrected_answer": offline_answer(payload.question, retrieval),
        "next_step": "Configure an AI provider, or generate a graded quiz attempt to record mastery.",
        "sources": retrieval.get("sources", []),
        "mastery_recorded": False,
        "note": "This is not a mastery grade.",
    }
