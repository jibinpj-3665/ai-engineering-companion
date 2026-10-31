import json
import re
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from ..ai.providers import AIError, chat_completion
from ..ai.rag import retrieve
from ..models import (
    Document,
    DocumentChunk,
    Flashcard,
    Quiz,
    QuizAttempt,
    QuizQuestion,
    Subject,
    SyllabusTopic,
    utcnow,
)
from ..services.settings import get_ai_config
from ..services.teaching import mark_mastery

_WORD_RE = re.compile(r"[a-zA-Z0-9]+")
_DEF_RE = re.compile(
    r"^([A-Z][A-Za-z0-9 /&(\-]{2,55}?)\s+(?:is|are|refers to|is defined as|means|denotes)\s+(.{25,260})$"
)

MODE_CONFIG = {
    "quick": {"count": 10, "minutes": 10, "marks": [1, 2]},
    "topic": {"count": 12, "minutes": 20, "marks": [2, 5]},
    "module": {"count": 20, "minutes": 45, "marks": [2, 5, 10]},
    "model_exam": {"count": 11, "minutes": 90, "marks": [2, 5, 10]},
    "timed": {"count": 10, "minutes": 30, "marks": [1, 2, 5]},
    "viva": {"count": 10, "minutes": 15, "marks": [2]},
    "mastery": {"count": 10, "minutes": 20, "marks": [2, 5]},
}


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (text or "").lower()).strip()


def _keywords(text: str) -> set:
    stop = {"the", "and", "for", "with", "that", "this", "from", "have", "are", "was", "were", "which", "when", "where", "into", "than", "then", "also", "will", "shall", "can", "could", "would", "should", "about", "there", "their", "they", "them", "using", "used", "each", "such", "more", "most", "some", "only", "other"}
    return {w.lower() for w in _WORD_RE.findall(text or "") if len(w) > 3 and w.lower() not in stop}


def _source(chunk: Optional[DocumentChunk], document: Optional[Document]) -> dict:
    if not chunk or not document:
        return {}
    return {
        "document": document.filename,
        "document_id": document.id,
        "page": chunk.page,
        "heading": chunk.heading,
        "snippet": chunk.content[:320],
    }


def _corpus(db: Session, subject_id: int, topic: Optional[SyllabusTopic], limit: int = 60):
    query = (
        db.query(DocumentChunk, Document)
        .join(Document, DocumentChunk.document_id == Document.id)
        .filter(Document.subject_id == subject_id, Document.status == "ready")
    )
    rows = query.limit(2500).all()
    if topic and rows:
        terms = _keywords(topic.title + " " + (topic.description or ""))
        if terms:
            scored = []
            for chunk, document in rows:
                lowered = chunk.content.lower() + " " + (chunk.heading or "").lower()
                hits = sum(1 for term in terms if term in lowered)
                if hits:
                    scored.append((hits, chunk, document))
            scored.sort(key=lambda item: item[0], reverse=True)
            rows = [(chunk, document) for _, chunk, document in scored] or rows
    return rows[:limit]


def _sentences(rows) -> List[dict]:
    output = []
    for chunk, document in rows:
        text = re.sub(r"\n+", " ", chunk.content)
        for sentence in re.split(r"(?<=[.!?])\s+", text):
            sentence = _clean(sentence)
            if 45 <= len(sentence) <= 320:
                output.append({"sentence": sentence, "chunk": chunk, "document": document})
    return output


def _heuristic_questions(db: Session, subject_id: int, topic: Optional[SyllabusTopic], target: int, mode: str, start_position: int = 0) -> List[dict]:
    rows = _corpus(db, subject_id, topic)
    sentences = _sentences(rows)
    definitions = []
    for item in sentences:
        match = _DEF_RE.match(item["sentence"])
        if match:
            term = _clean(match.group(1))
            definition = _clean(match.group(2)).rstrip(".")
            if 3 <= len(term.split()) <= 9 and len(definition) > 20:
                definitions.append({**item, "term": term, "definition": definition})
    unique_defs = []
    seen_terms = set()
    for item in definitions:
        if item["term"].lower() in seen_terms:
            continue
        seen_terms.add(item["term"].lower())
        unique_defs.append(item)
    headings = []
    seen_headings = set()
    for chunk, document in rows:
        heading = _clean(chunk.heading)
        if heading and len(heading) > 3 and heading.lower() not in seen_headings and not heading.lower().startswith("page "):
            seen_headings.add(heading.lower())
            headings.append({"heading": heading, "chunk": chunk, "document": document})

    questions: List[dict] = []
    marks_cycle = MODE_CONFIG.get(mode, MODE_CONFIG["quick"])["marks"]
    counter = 0

    def add(qtype, prompt, options, answer, explanation, marks, chunk, document):
        questions.append({
            "qtype": qtype,
            "prompt": prompt,
            "options": options,
            "answer": answer,
            "explanation": explanation,
            "marks": marks,
            "source": _source(chunk, document),
        })

    if topic:
        description = _clean(topic.description)
        add(
            "short",
            f"Explain the syllabus topic “{topic.title}” in your own words, including its purpose and one engineering application.",
            [],
            description or f"{topic.title}. " + (sentences[0]["sentence"] if sentences else ""),
            f"Expected discussion points: {topic.title}. Check the syllabus description and your notes for the official scope.",
            5,
            None,
            None,
        )

    for definition in unique_defs:
        if len(questions) >= target * 2 + 4:
            break
        marks = marks_cycle[counter % len(marks_cycle)]
        counter += 1
        others = [item for item in unique_defs if item["term"].lower() != definition["term"].lower()]
        if len(others) >= 2:
            options = [definition["definition"]] + [item["definition"] for item in others[:3]]
            add(
                "mcq",
                f"According to your study material, which statement best defines “{definition['term']}”?",
                options,
                definition["definition"],
                f"Source supports: {definition['sentence']}",
                1 if marks < 2 else 2,
                definition["chunk"],
                definition["document"],
            )
            options_terms = [definition["term"]] + [item["term"] for item in others[:3]]
            add(
                "mcq",
                f"Which term is described as: “{definition['definition'][:180]}”?",
                options_terms,
                definition["term"],
                f"The definition appears in {definition['document'].filename}, page {definition['chunk'].page}.",
                1 if marks < 2 else 2,
                definition["chunk"],
                definition["document"],
            )
            false_def = others[0]
            add(
                "true_false",
                f"True or false: “{definition['term']}” is defined in the material as: {false_def['definition'][:200]}",
                ["True", "False"],
                "False",
                f"The material defines {definition['term']} as: {definition['definition'][:220]}",
                1,
                false_def["chunk"],
                false_def["document"],
            )
        add(
            "fill_blank",
            f"Complete the statement: {definition['sentence'].replace(definition['term'], '________', 1)[:260]}",
            [],
            definition["term"],
            f"The missing term is “{definition['term']}”. Source: {definition['document'].filename}, page {definition['chunk'].page}.",
            1,
            definition["chunk"],
            definition["document"],
        )
        if len(questions) < target + 2:
            add(
                "viva",
                f"Viva question: Define “{definition['term']}” and state why it matters in engineering.",
                [],
                definition["definition"],
                f"Model answer from material: {definition['sentence']}",
                2,
                definition["chunk"],
                definition["document"],
            )

    for item in headings:
        if len(questions) >= target * 3:
            break
        marks = 5 if mode in {"module", "model_exam"} else 2
        add(
            "short",
            f"Explain the key ideas covered under “{item['heading']}”.",
            [],
            item["chunk"].content[:900],
            f"Build your answer from {item['document'].filename}, page {item['chunk'].page}.",
            marks,
            item["chunk"],
            item["document"],
        )
        if mode in {"module", "model_exam", "topic", "mastery"}:
            add(
                "long",
                f"Discuss “{item['heading']}” in detail. Include definitions, a labelled explanation, and one engineering application.",
                [],
                item["chunk"].content[:1400],
                f"Model scope from {item['document'].filename}, page {item['chunk'].page}. Structure: definition → working → application → limitation.",
                10 if mode in {"module", "model_exam"} else 5,
                item["chunk"],
                item["document"],
            )

    if topic:
        for qtype, prompt, marks in (
            ("short", f"State two assumptions or conditions under which “{topic.title}” is analysed.", 2),
            ("long", f"Derive or justify the central relationship of “{topic.title}” step by step, stating assumptions.", 10 if mode in {"model_exam", "module"} else 5),
            ("numerical", f"Create and solve a numerical problem based on “{topic.title}”. Show given data, formula, substitution and units.", 5),
            ("programming", f"Write a short program (Python/MATLAB/C) that demonstrates “{topic.title}”. Explain each block.", 5),
        ):
            if len(questions) < target + 3:
                add(
                    qtype,
                    prompt,
                    [],
                    (topic.description or f"Refer to the syllabus and notes for {topic.title}."),
                    "This open question is graded by comparing your answer with the topic scope. Include definitions, equations, assumptions and units.",
                    marks,
                    None,
                    None,
                )

    if not questions:
        subject = db.get(Subject, subject_id)
        add(
            "short",
            f"Describe the most important concept you have studied in {subject.name if subject else 'this subject'} and explain its engineering relevance.",
            [],
            "",
            "Add and index study material to receive a source-grounded model answer.",
            5,
            None,
            None,
        )

    return questions


async def _ai_questions(db: Session, subject: Subject, topic: Optional[SyllabusTopic], retrieval_context: str, target: int, mode: str) -> List[dict]:
    cfg = get_ai_config(db)
    if not cfg["configured"]:
        return []
    prompt = (
        "Generate exam questions from the supplied engineering study material. Return ONLY JSON: "
        '{"questions":[{"qtype":"mcq|true_false|fill_blank|short|long|derivation|numerical|programming|viva",'
        '"prompt":"...","options":["..."],"answer":"...","explanation":"...","marks":2}]}\n'
        f"Mode: {mode}. Produce {target} questions. MCQ/true_false must have 2-5 options and an answer that exactly matches one option. "
        "Open questions must include a model answer grounded in the material. Do not invent citations, page numbers or facts. "
        "Marks must reflect the mode (quick 1-2, module/model exam 2/5/10).\n\n"
        f"Subject: {subject.name}\nTopic: {topic.title if topic else 'mixed'}\n"
        f"Material:\n{retrieval_context[:9000]}"
    )
    try:
        raw = await chat_completion(db, [{"role": "user", "content": prompt}], temperature=0.3, max_tokens=3200, json_mode=True)
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            return []
        data = json.loads(raw[start:end + 1])
        questions = []
        allowed = {"mcq", "true_false", "fill_blank", "short", "long", "derivation", "numerical", "programming", "viva"}
        for item in data.get("questions", [])[:target]:
            qtype = str(item.get("qtype", "short")).lower()
            if qtype not in allowed:
                qtype = "short"
            prompt_text = _clean(str(item.get("prompt", "")))
            answer = _clean(str(item.get("answer", "")))
            options = item.get("options") or []
            if not isinstance(options, list):
                options = []
            options = [_clean(str(option)) for option in options if str(option).strip()]
            if qtype in {"mcq", "true_false"} and len(options) < 2:
                qtype = "short"
            if not prompt_text or not answer:
                continue
            try:
                marks = int(item.get("marks") or 2)
            except (TypeError, ValueError):
                marks = 2
            questions.append({
                "qtype": qtype,
                "prompt": prompt_text[:2000],
                "options": options[:5],
                "answer": answer[:2500],
                "explanation": _clean(str(item.get("explanation", "")))[:1200],
                "marks": max(1, min(marks, 20)),
                "source": {},
            })
        return questions
    except (AIError, ValueError, TypeError):
        return []


async def generate_quiz(db: Session, subject_id: int, topic_id: Optional[int], mode: str = "quick", count: Optional[int] = None, difficulty: str = "mixed", title: str = "") -> Quiz:
    subject = db.get(Subject, subject_id)
    if not subject:
        raise ValueError("Subject not found")
    topic = db.get(SyllabusTopic, topic_id) if topic_id else None
    config = MODE_CONFIG.get(mode, MODE_CONFIG["quick"])
    target = count or config["count"]
    target = max(1, min(target, 50))
    retrieval = retrieve(db, (topic.title if topic else subject.name), subject_id=subject_id, top_k=8)
    context = retrieval.get("context", "")
    ai_questions = await _ai_questions(db, subject, topic, context, target, mode)
    questions = ai_questions
    if len(questions) < target:
        questions = questions + _heuristic_questions(db, subject_id, topic, target - len(questions), mode)
    questions = questions[:target]
    if not questions:
        raise ValueError("No questions could be generated. Upload and index study material first.")

    quiz_title = title or (f"Mastery Test — {topic.title}" if mode == "mastery" and topic else f"{mode.replace('_', ' ').title()} — {topic.title if topic else subject.name}")
    quiz = Quiz(
        subject_id=subject_id,
        topic_id=topic_id,
        title=quiz_title[:300],
        mode=mode,
        difficulty=difficulty,
        generator="ai+material" if ai_questions else "material",
        duration_minutes=config["minutes"],
    )
    db.add(quiz)
    db.flush()
    for position, item in enumerate(questions):
        db.add(QuizQuestion(
            quiz_id=quiz.id,
            qtype=item["qtype"],
            prompt=item["prompt"],
            options_json=json.dumps(item.get("options", [])),
            correct_answer=item.get("answer", ""),
            explanation=item.get("explanation", ""),
            marks=item.get("marks", 2),
            source_json=json.dumps(item.get("source", {})),
            position=position,
        ))
    db.commit()
    db.refresh(quiz)
    return quiz


def _grade_open(answer: str, model: str, marks: int) -> tuple[float, str]:
    answer_norm = _normalize(answer)
    if not answer_norm:
        return 0.0, "No answer was provided."
    model_keywords = _keywords(model)
    answer_keywords = _keywords(answer)
    if not model_keywords:
        return (marks * 0.6 if len(answer_norm) > 40 else 0.0), "No keyword model is available; scored on response substance."
    overlap = len(model_keywords & answer_keywords) / len(model_keywords)
    coverage = min(1.0, overlap * 1.6)
    length_factor = min(1.0, len(answer_norm.split()) / 12)
    ratio = coverage * length_factor
    if ratio >= 0.65:
        note = "Strong coverage of the expected ideas."
    elif ratio >= 0.3:
        note = "Partial coverage; include more of the key terms and reasoning."
    else:
        note = "Most expected concepts are missing. Review the source and try again."
    return round(marks * ratio, 2), note


async def _ai_grade(db: Session, items: List[dict]) -> dict:
    cfg = get_ai_config(db)
    if not cfg["configured"]:
        return {}
    payload = [
        {
            "id": item["id"],
            "type": item["qtype"],
            "question": item["prompt"],
            "model_answer": item["answer"][:1200],
            "marks": item["marks"],
            "student_answer": item["student"],
        }
        for item in items if item["qtype"] in {"short", "long", "derivation", "numerical", "programming", "viva"}
    ]
    if not payload:
        return {}
    prompt = (
        "Grade these engineering exam answers. Return ONLY JSON: "
        '{"grades":[{"id":1,"score":3.5,"feedback":"...","improvement":"..."}]}. '
        "Score must be between 0 and the question marks. Be fair, use the model answer and student answer. "
        "Do not invent facts. JSON:\n" + json.dumps(payload)[:9000]
    )
    try:
        raw = await chat_completion(db, [{"role": "user", "content": prompt}], temperature=0.1, max_tokens=1800, json_mode=True)
        start = raw.find("{")
        end = raw.rfind("}")
        data = json.loads(raw[start:end + 1])
        return {int(item["id"]): item for item in data.get("grades", []) if isinstance(item, dict)}
    except (AIError, ValueError, TypeError):
        return {}


async def evaluate_attempt(db: Session, quiz: Quiz, answers: dict, duration_seconds: int = 0) -> QuizAttempt:
    questions = db.query(QuizQuestion).filter(QuizQuestion.quiz_id == quiz.id).order_by(QuizQuestion.position).all()
    if not questions:
        raise ValueError("Quiz has no questions")
    open_items = []
    for question in questions:
        student = str(answers.get(str(question.id), answers.get(question.id, "")) or "")
        open_items.append({
            "id": question.id,
            "qtype": question.qtype,
            "prompt": question.prompt,
            "answer": question.correct_answer,
            "marks": question.marks,
            "student": student,
        })
    ai_grades = await _ai_grade(db, open_items)
    feedback = []
    total = 0.0
    max_total = 0.0
    correct_count = 0
    for item, question in zip(open_items, questions):
        max_total += question.marks
        student = item["student"]
        qtype = question.qtype
        if qtype in {"mcq", "true_false"}:
            normalized_student = _normalize(student)
            normalized_answer = _normalize(question.correct_answer)
            granted = question.marks if normalized_student and normalized_student == normalized_answer else 0.0
            note = "Correct." if granted else f"Incorrect. Correct answer: {question.correct_answer}"
        elif qtype == "fill_blank":
            normalized_student = _normalize(student)
            normalized_answer = _normalize(question.correct_answer)
            granted = question.marks if normalized_student and normalized_answer and normalized_student == normalized_answer else 0.0
            note = "Correct." if granted else f"Expected: {question.correct_answer}"
            improvement = ""
        else:
            teacher_grade = ai_grades.get(question.id)
            improvement = ""
            if teacher_grade is not None:
                try:
                    granted = max(0.0, min(float(teacher_grade.get("score", 0)), question.marks))
                except (TypeError, ValueError):
                    granted = 0.0
                note = str(teacher_grade.get("feedback", ""))[:600]
                improvement = str(teacher_grade.get("improvement", ""))[:400]
            else:
                granted, note = _grade_open(student, question.correct_answer, question.marks)
                improvement = note
            if not student.strip():
                granted = 0.0
                note = "No answer was provided."
        if granted >= question.marks * 0.8:
            correct_count += 1
        total += granted
        try:
            options = json.loads(question.options_json or "[]")
        except ValueError:
            options = []
        try:
            source = json.loads(question.source_json or "{}")
        except ValueError:
            source = {}
        feedback.append({
            "question_id": question.id,
            "qtype": qtype,
            "prompt": question.prompt,
            "student_answer": student,
            "correct_answer": question.correct_answer,
            "explanation": question.explanation,
            "options": options,
            "source": source,
            "score": round(granted, 2),
            "marks": question.marks,
            "correct": granted >= question.marks * 0.8,
            "note": note,
            "improvement": improvement if qtype not in {"mcq", "true_false", "fill_blank"} else (
                "Review this source and retry the question." if granted < question.marks * 0.8 else ""
            ),
        })

    percent = round((total / max_total) * 100, 1) if max_total else 0.0
    attempt = QuizAttempt(
        quiz_id=quiz.id,
        subject_id=quiz.subject_id,
        topic_id=quiz.topic_id,
        answers_json=json.dumps({str(k): v for k, v in answers.items()}),
        score=round(total, 2),
        max_score=round(max_total, 2),
        percent=percent,
        feedback_json=json.dumps(feedback),
        duration_seconds=max(0, int(duration_seconds)),
        started_at=utcnow(),
        completed_at=utcnow(),
    )
    db.add(attempt)
    if quiz.topic_id:
        mark_mastery(db, quiz.topic_id, percent)
    for entry in feedback:
        if entry["correct"] or not entry["correct_answer"] or entry["qtype"] in {"numerical", "programming"}:
            continue
        if len(entry["correct_answer"]) < 20:
            continue
        existing = db.query(Flashcard).filter(
            Flashcard.subject_id == quiz.subject_id,
            Flashcard.topic_id == quiz.topic_id,
            Flashcard.front == entry["prompt"][:900],
        ).first()
        if not existing:
            db.add(Flashcard(
                subject_id=quiz.subject_id,
                topic_id=quiz.topic_id,
                front=entry["prompt"][:900],
                back=entry["correct_answer"][:1500],
                source_json=json.dumps(entry.get("source", {})),
                due_date=utcnow(),
            ))
    db.commit()
    db.refresh(attempt)
    return attempt
