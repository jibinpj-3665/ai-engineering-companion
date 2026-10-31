import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..ai.providers import AIError, chat_completion, test_connection
from ..ai.rag import offline_answer, retrieve
from ..database import get_db
from ..models import Conversation, Document, DocumentChunk, Message, Subject, SyllabusTopic, utcnow
from ..serializers import iso
from ..services.settings import get_ai_config

router = APIRouter(prefix="/ai", tags=["ai"])

PERSONALITIES = {
    "study_buddy": "You are a friendly engineering study buddy. Be encouraging, clear and concise. Ask one short understanding-check question at the end.",
    "professor": "You are a rigorous university engineering professor. Define terms precisely, state assumptions, and maintain a formal but supportive tone.",
    "examiner": "You are a strict but fair examiner. Challenge weak reasoning, give hints before answers, and point out what would lose marks.",
    "mentor": "You are a senior engineering mentor with industry experience. Connect theory to practice, design trade-offs and career skills.",
    "beginner_teacher": "You are a beginner-friendly teacher. Use everyday analogies, short sentences and avoid unexplained jargon.",
}

SYSTEM_PROMPT = (
    "You are the AI tutor inside AI Engineering Companion, a local-first engineering study app. "
    "Ground answers in the retrieved study material and cite sources as [S1], [S2]. "
    "Separate three kinds of content with clear labels: (1) Uploaded study material, (2) Additional academic knowledge, "
    "(3) AI-generated examples. Never invent citations, page numbers, document names or exam guarantees. "
    "If retrieved material is insufficient, say exactly that. Use Markdown; write equations in LaTeX. "
    "Prefer patience and questions over long lectures. Keep answers focused."
)


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


@router.get("/status")
def ai_status(db: Session = Depends(get_db)):
    cfg = get_ai_config(db)
    return {
        "provider": cfg["provider"],
        "configured": cfg["configured"],
        "model": cfg["model"],
        "embedding_provider": cfg["embedding_provider"],
        "indexed_chunks": db.query(DocumentChunk).count(),
        "ready_documents": db.query(Document).filter(Document.status == "ready").count(),
        "message": "AI provider configured." if cfg["configured"] else "Offline mode: answers use only your indexed material.",
    }


@router.post("/test")
async def test(db: Session = Depends(get_db)):
    return await test_connection(db)


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

    if not conversation.messages:
        conversation.title = payload.message.strip()[:60] or conversation.title
    conversation.updated_at = utcnow()
    if payload.personality in PERSONALITIES:
        conversation.personality = payload.personality

    topic = db.get(SyllabusTopic, payload.topic_id) if payload.topic_id else None
    subject = db.get(Subject, payload.subject_id or conversation.subject_id) if (payload.subject_id or conversation.subject_id) else None
    query = payload.message
    if topic:
        query = f"{topic.title} {payload.message}"
    retrieval = retrieve(db, query, subject_id=subject.id if subject else None, top_k=6)

    history = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc())
        .limit(10)
        .all()
    )
    history.reverse()

    user_message = Message(
        conversation_id=conversation.id,
        role="user",
        content=payload.message,
        sources_json="[]",
        mode=payload.mode,
    )
    db.add(user_message)
    db.commit()

    cfg = get_ai_config(db)
    generator = "offline"
    note = ""
    answer = ""
    if cfg["configured"]:
        system = SYSTEM_PROMPT + " " + PERSONALITIES.get(conversation.personality, PERSONALITIES["study_buddy"])
        context = retrieval.get("context") or "No matching uploaded material was retrieved."
        source_list = "\n".join(
            f"[S{source['index']}] {source['document']}, page {source['page']}"
            + (f", section {source['heading']}" if source["heading"] else "")
            for source in retrieval.get("sources", [])
        ) or "No sources."
        messages = [{"role": "system", "content": system}]
        for item in history[-8:]:
            messages.append({"role": item.role, "content": item.content[:2000]})
        messages.append({
            "role": "user",
            "content": (
                f"Student question: {payload.message}\n\n"
                f"Subject: {subject.name if subject else 'General'}\n"
                f"Topic: {topic.title if topic else 'General'}\n"
                f"Personality: {conversation.personality}\n"
                f"Mode: {payload.mode}\n\n"
                f"Available sources:\n{source_list}\n\nRetrieved material:\n{context}\n\n"
                "Answer using the source labels. If the uploaded material does not answer the question, say so and then "
                "clearly label any additional academic knowledge."
            ),
        })
        try:
            answer = await chat_completion(db, messages, max_tokens=1600)
            generator = "ai"
        except AIError as exc:
            answer = offline_answer(payload.message, retrieval, topic.title if topic else (subject.name if subject else ""))
            note = f"AI request failed; showing offline retrieval answer. {exc}"
    else:
        answer = offline_answer(payload.message, retrieval, topic.title if topic else (subject.name if subject else ""))
        note = "Offline mode: configure an AI provider for full tutoring."

    assistant_message = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=answer,
        sources_json=json.dumps(retrieval.get("sources", [])),
        mode=payload.mode,
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
        "sources": retrieval.get("sources", []),
        "message": {
            "id": assistant_message.id,
            "role": "assistant",
            "content": answer,
            "created_at": iso(assistant_message.created_at),
        },
    }
