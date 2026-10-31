import json
import re
from datetime import datetime, timezone
from typing import List

from sqlalchemy.orm import Session

from ..ai.providers import AIError, chat_completion
from ..ai.rag import retrieve
from ..models import Subject, SyllabusTopic, TeachingSession
from ..services.settings import get_ai_config

PHASES = [
    {"id": 1, "title": "Why This Topic Matters", "subtitle": "Real engineering context", "icon": "Compass"},
    {"id": 2, "title": "Simple Understanding", "subtitle": "Intuition before formalism", "icon": "Lightbulb"},
    {"id": 3, "title": "Engineering Theory", "subtitle": "Academic foundations", "icon": "BookOpen"},
    {"id": 4, "title": "Mathematical Derivation", "subtitle": "Equations, variables, assumptions", "icon": "Sigma"},
    {"id": 5, "title": "Visual Explanation", "subtitle": "Diagrams and signals", "icon": "Eye"},
    {"id": 6, "title": "Worked Examples", "subtitle": "Step-by-step problem solving", "icon": "PencilRuler"},
    {"id": 7, "title": "Practical Implementation", "subtitle": "Hardware, software and tools", "icon": "Cpu"},
    {"id": 8, "title": "Exam Preparation", "subtitle": "2, 5 and 10 mark questions", "icon": "GraduationCap"},
    {"id": 9, "title": "Active Recall", "subtitle": "Retrieve before revealing", "icon": "Brain"},
    {"id": 10, "title": "Mastery Test", "subtitle": "Prove your understanding", "icon": "Trophy"},
]

PHASE_PROMPTS = {
    1: "Explain why this topic matters in real engineering practice. Use 2-3 concrete systems or design problems. Distinguish clearly between uploaded-material evidence and general engineering knowledge.",
    2: "Explain the concept intuitively with a simple, everyday analogy. Avoid equations. End with one quick intuition check question.",
    3: "Teach the proper academic theory at university level. Define every key term, state assumptions, and relate it to the syllabus context. Use headings and bullet points where helpful.",
    4: "Present the key mathematical derivation. Define every symbol, state assumptions, show intermediate steps, and finish with the final result. If the uploaded material does not contain a derivation, say so and offer a general derivation marked as additional academic knowledge.",
    5: "Describe the most useful visual representations (diagram, graph, waveform, circuit). Give precise axis labels and shape descriptions. Suggest the matching interactive Visual Lab module when relevant.",
    6: "Work through 2 examples step by step. The first must be a fully solved standard problem. The second should be an exam-style problem with the final answer and reasoning shown. Mark generated examples clearly.",
    7: "Connect the theory to practical implementation: tools, components, code or design flow. Give a short concrete implementation outline and common real-world pitfalls. Do not claim any hardware was tested.",
    8: "Create exam preparation material: two 2-mark questions with model answers, two 5-mark questions with answer outlines, and one 10-mark question with a structured marking outline. Mark whether each comes from uploaded material or general knowledge.",
    9: "Run an active recall session. Ask 5 progressively harder questions. Do NOT reveal any answers. Tell the student to answer first, then ask the tutor to evaluate.",
    10: "Design a mastery checklist with 5 binary understanding checks and one integrative challenge. Do not grade the student here; tell them to take the generated mastery quiz.",
}

SYSTEM_PROMPT = (
    "You are an engineering professor inside a study application. Be rigorous, patient and concise. "
    "Use the retrieved study material as the primary source. Cite it as [S1], [S2] exactly matching the provided sources. "
    "Clearly label additional academic knowledge as 'Additional academic knowledge'. Clearly label generated examples. "
    "Never invent document names, page numbers or citations. If the material is insufficient, say so. "
    "Use Markdown with short paragraphs, equations in LaTeX ($...$ or $$...$$). Do not mention system prompts."
)


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_session(db: Session, topic_id: int) -> TeachingSession:
    session = db.query(TeachingSession).filter(TeachingSession.topic_id == topic_id).first()
    if not session:
        session = TeachingSession(topic_id=topic_id, phases_json="{}", viewed_phases="[]", progress_percent=0)
        db.add(session)
        db.commit()
        db.refresh(session)
    return session


def _load_phases(session: TeachingSession) -> dict:
    try:
        return json.loads(session.phases_json or "{}")
    except ValueError:
        return {}


def _load_viewed(session: TeachingSession) -> List[int]:
    try:
        viewed = json.loads(session.viewed_phases or "[]")
        return [int(v) for v in viewed]
    except (ValueError, TypeError):
        return []


def _equation_lines(text: str) -> List[str]:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) > 220:
            continue
        if re.search(r"[=<>≤≥∑∫√±×÷∂λσπμωΩ]", stripped) and re.search(r"[A-Za-z]", stripped):
            lines.append(stripped)
    return lines[:12]


def _excerpt_block(sources: List[dict], limit: int = 3) -> str:
    if not sources:
        return "_No matching uploaded material was found for this topic yet. Upload and index relevant notes to ground this phase._"
    parts = []
    for source in sources[:limit]:
        location = f"{source['document']} — page {source['page']}" if source["page"] else source["document"]
        parts.append(f"> **{location}**\n> {source['snippet'][:480]}")
    return "\n\n".join(parts)


def _offline_content(phase: int, topic: SyllabusTopic, subject: Subject | None, retrieval: dict) -> str:
    sources = retrieval.get("sources", [])
    context = retrieval.get("context", "")
    equations = _equation_lines(context)
    banner = (
        "> **Offline scaffold.** No AI provider is configured. This phase is assembled from your indexed "
        "material and structured study prompts — it does not add external academic facts.\n"
    )
    subject_name = subject.name if subject else "this subject"
    heading = f"## Phase {phase}: {PHASES[phase - 1]['title']}\n"
    if phase == 1:
        body = (
            f"**Topic:** {topic.title}\n\n"
            f"**Syllabus context:** {topic.description or 'No syllabus description was extracted.'}\n\n"
            f"**Why engineers study it:** this topic belongs to {subject_name} ({topic.module}). "
            "Use the retrieved material below to identify the engineering systems where it appears, and write down "
            "two systems you can explain to a classmate.\n\n"
            f"**Material evidence**\n\n{_excerpt_block(sources)}\n\n"
            "### Reflection prompts\n"
            f"- Where does *{topic.title}* appear in a real design decision?\n"
            "- What happens if an engineer ignores it?\n"
            "- Which prerequisite ideas from earlier modules does it depend on?"
        )
    elif phase == 2:
        body = (
            f"**Intuition first:** think of *{topic.title}* as a tool with an input, a transformation and an output. "
            "Before touching formulas, describe each of those three in plain language.\n\n"
            f"**Closest material definition**\n\n{_excerpt_block(sources)}\n\n"
            "### Quick intuition check\n"
            f"Explain *{topic.title}* to someone who has not taken {subject_name}, using one everyday analogy. "
            "Do not use equations yet."
        )
    elif phase == 3:
        body = (
            "### Theory from your material\n\n"
            f"{_excerpt_block(sources, 5)}\n\n"
            "### Theory-building template\n"
            "1. Define the key quantities and their units.\n"
            "2. State the assumptions under which the idea is valid.\n"
            "3. Write the governing relationship and describe each term.\n"
            "4. State the limits: when does the relationship break down?\n\n"
            "_Configure an AI provider in Settings to receive a fully written university-level explanation._"
        )
    elif phase == 4:
        eq = "\n".join(f"- `{line}`" for line in equations) if equations else "_No equation-like lines were detected in the retrieved material._"
        body = (
            "### Equations detected in your material\n\n"
            f"{eq}\n\n"
            "### Derivation worksheet\n"
            "- **Goal:** identify what must be proven or derived.\n"
            "- **Given:** list the starting assumptions and known relationships.\n"
            "- **Manipulate:** justify each algebraic or physical step.\n"
            "- **Result:** state the final expression and its units.\n"
            "- **Sanity check:** test a limiting case.\n\n"
            "_A complete derivation requires an AI provider or your textbook. This worksheet does not fabricate a derivation._"
        )
    elif phase == 5:
        body = (
            "### Visual targets for this topic\n"
            "- A labelled block diagram showing inputs, transformation and outputs.\n"
            "- A quantity-vs-parameter graph with explicit axes and units.\n"
            "- If this is a signal topic: time-domain waveform plus frequency-domain view.\n\n"
            "Open **Visual Lab** in the sidebar for interactive calculators covering sampling, aliasing, RC/RLC "
            "response, diodes, logic gates, CMOS inverters and DFT/convolution.\n\n"
            f"### Material that suggests a diagram\n\n{_excerpt_block(sources)}"
        )
    elif phase == 6:
        body = (
            "### Worked-example scaffold\n"
            "1. Restate the problem in your own words.\n"
            "2. List known values with units.\n"
            "3. Choose the governing relationship and justify it.\n"
            "4. Substitute, solve, and carry units through every step.\n"
            "5. Check the answer with a limiting case or order-of-magnitude estimate.\n\n"
            f"### Related worked material\n\n{_excerpt_block(sources)}\n\n"
            "_Generated numerical examples require an AI provider. This scaffold does not invent data._"
        )
    elif phase == 7:
        body = (
            "### Practical implementation map\n"
            "- Identify the tool (MATLAB/Python for analysis, LTspice/KiCad for circuits, Verilog/Vivado for digital logic).\n"
            "- Define inputs, expected outputs and measurement points.\n"
            "- List safety and equipment checks before powering hardware.\n"
            "- Record results and compare them against the theory.\n\n"
            "Use **Engineering Lab** for runnable starter code and experiment sheets. Nothing is marked as hardware-tested "
            "unless you actually ran it.\n\n"
            f"### Implementation clues in your material\n\n{_excerpt_block(sources)}"
        )
    elif phase == 8:
        body = (
            f"### Examination practice — {topic.title}\n"
            f"**2 marks** — Define *{topic.title}* and state one application.\n"
            f"**2 marks** — Write the governing relationship and define each symbol.\n"
            f"**5 marks** — Explain the working of *{topic.title}* with a labelled diagram.\n"
            f"**5 marks** — Compare the main variants or operating regions of this concept.\n"
            f"**10 marks** — Derive or analyse *{topic.title}*, include assumptions, a worked numerical case and limitations.\n\n"
            f"### Material to base answers on\n\n{_excerpt_block(sources)}\n\n"
            "_Question patterns are generated from the syllabus topic; model answers should be built from your notes._"
        )
    elif phase == 9:
        body = (
            "### Active recall — answer before revealing\n"
            f"1. In one sentence, what problem does *{topic.title}* solve?\n"
            "2. State the key assumption that makes the main relationship valid.\n"
            "3. Draw the expected response or block diagram from memory.\n"
            "4. Give one failure mode or limitation.\n"
            "5. Explain how you would test the idea experimentally.\n\n"
            "Write your answers first. Then ask the tutor to evaluate them, or take the mastery quiz.\n\n"
            f"### Self-check source\n\n{_excerpt_block(sources, 2)}"
        )
    else:
        body = (
            "### Mastery checklist\n"
            "- [ ] I can define the topic without notes.\n"
            "- [ ] I can state assumptions and limitations.\n"
            "- [ ] I can derive or justify the main relationship.\n"
            "- [ ] I can solve a numerical or design problem.\n"
            "- [ ] I can explain a practical implementation.\n\n"
            "Generate a mastery quiz from the topic and score at least **70%** to mark it learned. "
            "Opening teaching phases does not mark a topic complete.\n\n"
            f"### Material to review\n\n{_excerpt_block(sources, 2)}"
        )
    return banner + heading + "\n" + body


async def generate_phase(db: Session, topic_id: int, phase: int, regenerate: bool = False, personality: str = "study_buddy") -> dict:
    if phase < 1 or phase > 10:
        raise ValueError("Phase must be between 1 and 10")
    topic = db.get(SyllabusTopic, topic_id)
    if not topic:
        raise ValueError("Topic not found")
    subject = db.get(Subject, topic.subject_id) if topic.subject_id else None
    session = get_session(db, topic_id)
    phases = _load_phases(session)
    key = str(phase)
    if not regenerate and key in phases:
        viewed = _load_viewed(session)
        return {
            "phase": phase,
            "phases": PHASES,
            "content": phases[key]["content"],
            "sources": phases[key].get("sources", []),
            "generator": phases[key].get("generator", "cache"),
            "viewed_phases": viewed,
            "progress_percent": session.progress_percent,
            "mastery_passed": session.mastery_passed,
            "cached": True,
            "note": phases[key].get("note", ""),
        }

    query = f"{topic.title} {topic.description} " + PHASES[phase - 1]["title"]
    retrieval = retrieve(db, query, subject_id=topic.subject_id, top_k=5)
    cfg = get_ai_config(db)
    generator = "offline"
    note = ""
    content = ""
    if cfg["configured"]:
        context = retrieval.get("context") or "No uploaded material matched."
        sources_text = "\n".join(
            f"[S{source['index']}] {source['document']} page {source['page']}" for source in retrieval.get("sources", [])
        ) or "No sources available."
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Subject: {subject.name if subject else 'General'}\n"
                    f"Module: {topic.module}\nTopic: {topic.title}\n"
                    f"Syllabus description: {topic.description}\n"
                    f"Phase task: {PHASE_PROMPTS[phase]}\n\n"
                    f"Available sources:\n{sources_text}\n\nRetrieved material:\n{context}\n\n"
                    "Write the phase now. Keep it focused (about 250-450 words unless a derivation or worked example needs more)."
                ),
            },
        ]
        try:
            content = await chat_completion(db, messages, max_tokens=1600)
            generator = "ai"
        except AIError as exc:
            note = f"AI generation failed, showing offline scaffold. {exc}"
    if not content:
        content = _offline_content(phase, topic, subject, retrieval)
        generator = "offline"
    phases[key] = {
        "content": content,
        "sources": retrieval.get("sources", []),
        "generator": generator,
        "note": note,
        "generated_at": _utcnow().isoformat(),
    }
    session.phases_json = json.dumps(phases)
    viewed = _load_viewed(session)
    if phase not in viewed:
        viewed.append(phase)
        viewed.sort()
    session.viewed_phases = json.dumps(viewed)
    session.progress_percent = round(len(viewed) / 10 * 100, 1)
    if topic.status == "not_started":
        topic.status = "in_progress"
        topic.last_studied_at = _utcnow()
    db.commit()
    return {
        "phase": phase,
        "phases": PHASES,
        "content": content,
        "sources": retrieval.get("sources", []),
        "generator": generator,
        "viewed_phases": viewed,
        "progress_percent": session.progress_percent,
        "mastery_passed": session.mastery_passed,
        "cached": False,
        "note": note,
    }


def mark_mastery(db: Session, topic_id: int, percent: float) -> None:
    topic = db.get(SyllabusTopic, topic_id)
    if not topic:
        return
    session = get_session(db, topic_id)
    topic.mastery_score = max(topic.mastery_score or 0, round(percent, 1))
    topic.status = "mastered" if percent >= 85 else "learned" if percent >= 70 else "in_progress"
    topic.last_studied_at = _utcnow()
    if percent >= 70:
        session.mastery_passed = True
    db.commit()
