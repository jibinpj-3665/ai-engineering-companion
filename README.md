# AI Engineering Companion

**Learn Engineering. Think Deeper. Build the Future.**

A local-first Windows desktop study workspace for engineering students. Upload your notes, map your syllabus, learn through a ten-phase teaching workflow, practise with source-grounded quizzes, revise with spaced repetition, and prepare for university exams — with your data staying on your device.

![Dashboard](docs/dashboard.png)

---

## Why this exists

Most study apps are chat windows with a login screen. This one is built around how engineering is actually examined: syllabus coverage, derivations, numericals, diagrams, viva questions, lab work and repeatable practice. The app is transparent about what it knows:

- **No invented citations.** Answers cite indexed document pages when material is available.
- **No fake completion.** Topics are only marked learned or mastered after passing a mastery quiz.
- **No silent AI dependency.** Offline mode works without an API key and labels its output as material-grounded scaffolding.
- **No cloud account.** Notes, chats, quizzes and progress live in a local SQLite database.

## Features

### Knowledge workspace
- Subjects with semester, department and colour coding.
- PDF, DOCX, PPTX, TXT, Markdown and image uploads (PNG, JPG, TIFF, WebP).
- Page-aware extraction with heading and table detection, plus optional OCR for scanned notes when Tesseract is installed.
- Chunked, local embeddings and full-text retrieval across your material.
- Document preview, search with page citations, reprocessing and deletion.
- Backup and restore as a single `.zip` archive.

### Syllabus intelligence
- AI-assisted or heuristic syllabus parsing.
- Module, marks and description extraction.
- Priority scoring with a visible reason for every topic (exam weight, marks, prerequisites, mastery gap).
- Coverage mapping: which syllabus topics are supported by your uploaded material and which are missing.
- Manual topic add/edit and status tracking.

### Ten-phase step teaching
1. Real-world context
2. Intuition and simplification
3. Formal definition
4. Derivation and mathematics
5. Diagram / visual explanation
6. Worked example
7. Engineering application and design trade-offs
8. Exam strategy
9. Common mistakes and memory anchors
10. Mastery check

Each phase is generated from your indexed material, can be regenerated, and reports its citations. Opening phases tracks progress; **only** a mastery quiz at 70%+ marks a topic learned, and 85%+ marks it mastered.

### AI Tutor
- Five personalities: study buddy, professor, strict examiner, engineering mentor, beginner-friendly teacher.
- Retrieval-augmented answers with cited sources.
- Conversation history and subject-scoped tutoring.
- Speech-to-text and text-to-speech using the browser/Windows voices.
- Works offline with local retrieval and clearly labelled scaffolds.
- Optional OpenAI, OpenAI-compatible or local Ollama/LM Studio providers.
- API keys encrypted at rest with a device-local key.

### Practice and mock exams
- Seven assessment modes: quick quiz, topic test, module exam, university model exam, timed exam, viva and mastery check.
- Question types: MCQ, true/false, fill-in-the-blank, short answer, long answer, derivation, numerical, programming and viva.
- 2/5/10-mark model exam distribution with a 90-minute window.
- AI or keyword-based evaluation with explanations, improvement notes, mistake analysis and saved questions.
- Attempt history with per-question feedback.

### Spaced revision
- SM-2-inspired scheduling with ease, interval, repetitions and lapses.
- Due queue, reveal-and-grade workflow and a full card library.
- Flashcard generation from notes and quiz mistakes.

### Planning and analytics
- Exam calendar with countdowns and weightings.
- Exam-aware study plan generation by daily minutes and horizon.
- Ranked topic queue based on weight, mastery gap and exam proximity.
- Focus timer (25/50/90 minutes) that logs real study time.
- Weekly study-time chart, subject completion, quiz averages, retention, streaks and an explainable exam-readiness score.

### Virtual labs
Eight complete experiments with theory, schematics, algorithms, runnable code, expected output, result discussion, troubleshooting and viva questions:

- RC step response (Analog Electronics)
- Sampling and aliasing (DSP)
- FIR low-pass filter design (DSP)
- Verilog modulo-10 counter (Digital Design / VLSI)
- Arduino PWM LED (Embedded Systems)
- CMOS inverter (VLSI)
- FFT spectrum analysis (Signals & Systems)
- Series RLC resonance (Circuit Theory)

Labs include a CodeMirror editor, saved artifacts, copy/download and optional LTspice guidance. All are clearly labelled educational simulations, not hardware-verified results.

### Interactive visual lab
- Sampling and aliasing with live sample points and Nyquist warnings.
- RC charging curve with time-constant markers.
- Series RLC resonance with Q and bandwidth calculations.
- Diode DC operating point solved against the Shockley equation.
- Logic gate truth-table simulator.
- CMOS inverter transfer curve (idealised).
- Harmonic synthesis and a 512-point DFT spectrum.

### Desktop experience
- Electron shell with splash screen, native window, single-instance lock and secure IPC preload.
- Local backend spawned automatically on a free port.
- Dark/light theme and five accent colours.
- Command palette (`Ctrl+K`), notifications and keyboard shortcuts.
- Installer for per-user installation with desktop and Start Menu shortcuts.

## Quick start

### Option A — Install the built app

Run `release\AI-Engineering-Companion-Setup.exe` and follow the installer. The app is unsigned, so Windows SmartScreen may ask you to confirm the publisher. The build is reproducible from source.

### Option B — Run from source (development)

Requirements: Windows 10/11, Node.js 22+, Python 3.11.

```powershell
# 1. Install JavaScript dependencies
npm install
npm --prefix frontend install

# 2. Create the Python environment
py -3.11 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# 3. Run backend + frontend + Electron in watch mode
npm run desktop:dev
```

Backend only: `npm run dev:backend` (http://127.0.0.1:8765).  
Frontend only: `npm run dev:frontend` (http://localhost:5173).

### Option C — Build the installer

```powershell
npm run dist
```

This builds the React app, bundles the FastAPI backend into a single executable with PyInstaller, and packages both with electron-builder. Output: `release\AI-Engineering-Companion-Setup.exe`.

## AI provider configuration

Offline mode is the default and needs no account or key. To enable a language model, open **Settings → AI provider**.

| Provider | Base URL | Notes |
| --- | --- | --- |
| Offline | — | Local retrieval + structured scaffolds. No network calls. |
| OpenAI | `https://api.openai.com/v1` | Enter your API key and model (e.g. `gpt-4o-mini`). |
| OpenAI-compatible | Provider-specific | OpenRouter, Azure-compatible gateways, etc. |
| Local | `http://127.0.0.1:11434/v1` | Ollama / LM Studio. No API key required. |

Optional remote embeddings can be enabled separately. Keys are encrypted with Fernet using a key stored in your local data directory and are only sent to the provider you configure. Use **Save & test** to verify connectivity.

## Privacy and data

- Study data: `%LOCALAPPDATA%\AIEngineeringCompanion`
- Database: `aec.db` (SQLite, WAL mode)
- Uploads: `uploads\`
- Logs: `logs\`
- Backups: `backups\`
- Windows uninstall does **not** delete this folder.

Override locations with `AIEC_DATA_DIR`, `AEC_PORT`, `AEC_STATIC_DIR` or `AEC_MAX_UPLOAD_MB`. No telemetry or analytics are sent anywhere. When an AI provider is configured, only the prompt and retrieved context needed to answer are sent to that provider.

## Testing

```powershell
npm test                 # backend pytest + frontend vitest
npm run test:backend     # API integration tests (11)
npm run test:frontend    # UI smoke tests (5)
npm run typecheck        # TypeScript strict check
```

Backend tests isolate data in a temporary directory and cover health, subjects, documents, syllabus parsing, teaching, quizzes, revision, planning, analytics, labs and settings.

## Architecture

```
Electron main process
  └── spawns packaged FastAPI backend on a free localhost port
        ├── SQLite + uploads (local data directory)
        ├── /api/* JSON API
        └── serves the built React SPA

React + TypeScript + Vite + Tailwind
  ├── pages: dashboard, subjects, knowledge base, syllabus,
  │          tutor, step teaching, practice, revision, planner,
  │          analytics, labs, visual lab, settings
  └── thin API client with typed contracts
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)  
User workflows: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)

## Tech stack

- **Frontend:** React 18, TypeScript, Vite 6, Tailwind CSS, Framer Motion, Recharts, KaTeX, react-markdown, CodeMirror.
- **Backend:** FastAPI, SQLAlchemy 2, SQLite, Pydantic 2, PyMuPDF, python-docx, python-pptx, Pillow, pytesseract, cryptography.
- **AI:** OpenAI-compatible provider abstraction with local feature-hashing embeddings and retrieval fallback.
- **Desktop:** Electron 33, electron-builder, NSIS.
- **Testing:** pytest, Vitest, Testing Library.

## Project layout

```
backend/            FastAPI app, services, routers, tests
frontend/           React application and Vitest tests
desktop/            Electron main process and preload
assets/             Icon and splash screen
scripts/            Backend build, icon generation, screenshots
docs/               Architecture, user guide, screenshot
release/            Built installer and unpacked app
```

## Limitations

- This is a study aid, not a replacement for lectures, textbooks, laboratory supervision or your university's academic-integrity rules.
- AI-generated content can be wrong. Verify derivations, numerical results and citations against your source material.
- Virtual labs and visual simulations are educational models, not hardware measurements or sign-off SPICE decks.
- OCR requires a separate Tesseract installation.
- The installer is unsigned; code signing requires your own certificate.

## License

MIT © 2026 jibinpj-3665. See [LICENSE](LICENSE).
