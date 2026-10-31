# User Guide

A practical walkthrough of AI Engineering Companion, from a blank workspace to an exam-ready study system.

## 1. Install and launch

Run `AI-Engineering-Companion-Setup.exe` and choose an install location. The installer creates desktop and Start Menu shortcuts. The app starts its local backend automatically; no separate server or account is needed.

The first launch shows an empty dashboard. Optionally open **Settings** to set your name, theme and accent colour. Everything is stored locally in `%LOCALAPPDATA%\AIEngineeringCompanion`.

## 2. Build your first subject

1. Open **Subjects → Create subject**.
2. Enter a name, code, semester and department, and choose an accent colour.
3. Open the subject.

A typical workflow then has three inputs:

- **Knowledge Base:** upload the material you actually study from.
- **Syllabus:** add the official syllabus document and analyse it.
- **Planner:** add exam dates so priorities become time-aware.

The dashboard's setup cards link to each step. You can skip any of them, but citations and exam weighting depend on them.

## 3. Upload and index notes

Open **Knowledge Base**, choose the subject, and upload PDFs, DOCX, PPTX, TXT/Markdown or scanned images. Processing is local.

- Text documents are split into page-aware chunks and embedded.
- Scanned images use OCR only if Tesseract is installed; otherwise the document is reported as unreadable rather than silently indexed empty.
- Use document search to inspect extraction quality.
- Re-index a document after changing provider or embedding settings.

If a PDF is encrypted or corrupt, the upload is rejected with an error. Remove the source password first or export a clean copy.

## 4. Analyse the syllabus

Open **Syllabus**, upload or paste the syllabus for the current subject, and choose **Analyse syllabus**.

- With an AI provider configured, modules and topics are extracted semantically.
- Offline, a heuristic parser finds numbered units, topic lines and marks.
- Each topic receives a priority and a reason based on marks, module weight and prerequisites.
- The coverage panel compares topics against indexed notes so you know what is missing.

Review the extracted list. Rename, re-weight, add or delete topics before studying; the parser is helpful, not authoritative.

## 5. Learn a topic in ten phases

Open a topic from the dashboard, syllabus map, planner or **Step Teaching**.

The ten phases move from intuition to exam performance:

1. Real-world context
2. Intuition
3. Formal definition
4. Derivation and mathematics
5. Diagram or visual explanation
6. Worked example
7. Engineering application
8. Exam strategy
9. Common mistakes and memory anchors
10. Mastery check

Each generated phase can be regenerated and shows its cited pages. Generating content requires either indexed material or a configured provider; offline without material produces a study scaffold rather than invented facts.

**Important:** opening all ten phases does not complete a topic. Use **Mastery quiz** at the end. Score 70% or more to mark the topic learned, and 85% or more to mark it mastered. You can retake it; the stored score only moves upward, while quiz history keeps every attempt.

## 6. Study with the AI Tutor

Open **AI Tutor**, choose a subject and personality, and ask a question. Quotes and page numbers under an answer are retrieval citations. If no relevant material is found, the tutor should say so rather than fabricate a source.

- Personalities: study buddy, professor, examiner, engineering mentor and beginner-friendly teacher.
- Use the microphone for speech-to-text and the speaker action to read replies aloud; voices depend on Windows.
- Conversations are saved locally.
- With no provider, answers are extractive and labelled as offline. This is useful for finding material, not for full explanations.

## 7. Practise and take mock exams

Open **Practice** and pick a subject, optional topic and mode:

| Mode | Use it for |
| --- | --- |
| Quick quiz | A short mixed check |
| Topic test | Focused revision of one topic |
| Module examination | A full module sweep |
| University model exam | 2, 5 and 10 mark questions in 90 minutes |
| Timed examination | Speed under a 30-minute limit |
| Viva | Rehearsing spoken explanations |
| Mastery check | Unlocking learned/mastered status from a lesson |

After submitting, review per-question scores, explanations and improvement notes. Save difficult questions for later. Objective questions are graded automatically; written answers are model-evaluated or scored by keyword coverage offline.

## 8. Revise with spaced repetition

Open **Revision**. The due queue shows cards scheduled for today.

1. Read the prompt and attempt recall before revealing.
2. Reveal the answer.
3. Grade yourself: again, hard, good or easy.
4. The SM-2-inspired scheduler updates the interval, ease and due date.

Generate new cards from a subject or topic, or let quiz mistakes become cards. Use the card library to inspect, suspend or delete cards. Retention statistics appear in **Analytics**.

## 9. Plan study time

Open **Study Planner**.

- Add exams with dates, subject and weighting.
- Generate a plan from daily minutes and a planning horizon.
- Review the ranked queue: high-weight, low-mastery topics near an exam rise to the top.
- Start a 25, 50 or 90 minute focus timer. Only completed timer time, or time you explicitly choose to log, counts toward study analytics.

Plans adapt when mastery or exam dates change. Regenerate after major updates instead of expecting silent edits.

## 10. Read the honest analytics

Open **Analytics** for:

- Study minutes this week and today, with a seven-day pulse.
- Topic completion and average mastery per subject.
- Quiz attempts and average scores.
- Revision retention and lapse counts.
- Weak topics sorted by priority and mastery.
- An exam-readiness score with a written explanation.

Readiness is a study-planning estimate from mastery, quiz performance and coverage. It is not a prediction of your university result.

## 11. Run virtual labs

Open **Engineering Lab** and choose one of eight experiments. Each includes theory, procedure, circuit or algorithm, runnable code, expected output, result discussion, common errors and viva questions.

- Edit code in the built-in editor.
- Save an artifact to keep your version.
- Download or copy code for external tools such as LTspice, Python or ModelSim.
- Treat all outputs as educational simulations. Verify against lab equipment or course-approved tools before submitting work.

Open **Visual Lab** for interactive demonstrations of sampling and aliasing, RC charging, RLC resonance, diode operating points, logic gates, CMOS transfer characteristics and harmonic/FFT analysis.

## 12. Back up and restore

Open **Settings → Local data**.

- **Backup** creates a zip archive containing the database, uploads and manifest.
- **Restore** replaces current local data after confirmation. Close other app windows first.
- **Re-index** rebuilds chunks and embeddings for stored documents.

Backups are stored under the data directory by default. Copy them somewhere safe before reinstalling Windows. Uninstalling the app does not remove study data.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + K` | Search topics and pages |
| `Ctrl + Enter` | Send a tutor message |
| `Esc` | Close dialogs and palettes |
| `1`–`10` | Jump to a teaching phase |
| Click card | Reveal a flashcard answer |

## Troubleshooting

**The app stays on the splash screen.** Check `%LOCALAPPDATA%\AIEngineeringCompanion\logs\electron.log` and `backend.log`. Antivirus may be blocking the bundled backend. Add the installed app folder to your allow list, then relaunch.

**Health check fails or the port is occupied.** The packaged app chooses a free port automatically. A stale backend process usually exits when the app closes; if not, sign out or end `ai-engineering-companion-backend.exe` in Task Manager.

**Citations are missing.** Confirm documents show as ready in Knowledge Base, re-index them, and ask a question scoped to that subject. Offline quiz generation can work with syllabus text but cannot cite pages it never indexed.

**OCR does not work.** Install Tesseract for Windows and ensure `tesseract.exe` is on `PATH`, then restart the app and re-upload the image.

**AI requests fail.** Open Settings → AI provider, verify the base URL and model, and use **Save & test**. For local models, confirm Ollama or LM Studio is running and the model is downloaded.

**The installer is blocked by SmartScreen.** The build is unsigned. Choose **More info → Run anyway** only if you obtained it from a source you trust, or build it yourself from source.

## Study integrity

Use the app to understand material, practise recall and organise revision. Follow your university's rules on AI assistance for assignments, reports and examinations. Generated explanations and numerical answers can be wrong; verify them against your course material.
