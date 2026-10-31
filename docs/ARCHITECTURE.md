# Architecture

AI Engineering Companion is a local-first Windows desktop application. It combines an Electron host, a FastAPI backend and a React single-page frontend, all communicating over localhost.

## Runtime layout

```text
Electron main process (desktop/main.js)
├── single-instance lock and splash window
├── finds a free localhost port
├── spawns resources/backend/ai-engineering-companion-backend.exe
│     └── FastAPI + SQLite + uploaded files
├── waits for GET /api/health
└── loads http://127.0.0.1:<free-port> in a sandboxed BrowserWindow
      └── serves the built React SPA from the PyInstaller bundle
```

In development, `AEC_DEV_SERVER` points Electron at the Vite server; the backend stays on port `8765`. When Electron runs unpackaged without a dev server, it first probes port `8765`, then falls back to `backend\.venv\Scripts\python.exe backend\run.py`.

The backend binds to `127.0.0.1` only. Database, uploads, logs, backups and the encryption key live under `%LOCALAPPDATA%\AIEngineeringCompanion` (override with `AIEC_DATA_DIR`).

## Backend

```text
backend/
├── run.py                 uvicorn entry point (PyInstaller friendly)
├── app/
│   ├── main.py            app factory, routers, SPA fallback, logging
│   ├── config.py          paths, ports, defaults, env overrides
│   ├── database.py        SQLite engine, WAL, session factory, init
│   ├── models.py          SQLAlchemy ORM
│   ├── serializers.py     API dictionary shapes
│   ├── security.py        Fernet encryption for secrets
│   ├── labs.py            eight curated experiment definitions
│   ├── ai/
│   │   ├── providers.py   OpenAI-compatible chat + embeddings
│   │   └── rag.py         chunking, retrieval, citations
│   ├── routers/           JSON endpoints under /api
│   └── services/          domain logic
└── tests/                 isolated API integration tests
```

### Data model

| Model | Purpose |
| --- | --- |
| `Subject` | Semester subject with colour, code and status |
| `Document` | Uploaded file, extraction state and metadata |
| `DocumentChunk` | Page-aware text chunk with embedding |
| `SyllabusTopic` | Topic, module, marks, priority, mastery and status |
| `TeachingSession` | Per-topic ten-phase progress |
| `Conversation`, `Message` | Tutor threads and cited replies |
| `Quiz`, `QuizQuestion` | Generated assessments and questions |
| `QuizAttempt` | Scores, timing, evaluation and mistake analysis |
| `Flashcard` | SM-2 scheduling state |
| `StudySession` | Logged focus/study minutes |
| `Exam` | Exam date, weighting and subject |
| `ScheduleSession` | Generated study plan entries |
| `Preference`, `Secret` | Settings and encrypted API keys |
| `Notification`, `SavedQuestion`, `LabArtifact` | Supporting records |

### Document pipeline

1. Save upload under `uploads/` with a generated name.
2. Extract text page by page: PyMuPDF for PDFs, python-docx for DOCX, python-pptx for PPTX, Pillow plus pytesseract for images, direct read for text formats.
3. Detect headings and tables where the format permits.
4. Split text into overlapping chunks (~1,000 characters), prefixing section headings.
5. Embed each chunk locally with a deterministic 384-dimension feature-hash vector (or a configured remote embedding provider).
6. Store chunks and mark the document ready. Retrieval scores cosine similarity plus keyword overlap, filters by subject/document and returns page-aware citations.

No network call occurs during offline ingestion.

### AI provider abstraction

`services/settings.py` resolves the configured provider, model, base URL, temperature and key. `ai/providers.py` supports OpenAI, OpenAI-compatible endpoints and local Ollama/LM Studio servers. All prompts instruct the model to use retrieved material and to avoid invented citations. When no provider is configured, features fall back to deterministic extraction, heuristics and clearly labelled scaffolds.

API keys are encrypted with Fernet; the key file is created in the data directory on first use.

### Teaching and mastery rules

Ten fixed phases: context, intuition, formal definition, derivation, visual explanation, worked example, engineering application, exam strategy, pitfalls, and mastery check. Viewing phases records progress but never completes a topic. Passing a mastery quiz at 70% sets the topic to `learned`; 85%+ sets it to `mastered`. `mark_mastery` only raises the stored score.

### Practice generation and grading

Seven modes define count, duration and mark distributions: quick, topic, module, model exam, timed, viva and mastery. Questions are drawn from retrieval context and syllabus topics, then validated against allowed question types. Objective questions are graded exactly; written answers are evaluated by the configured model or by a keyword-coverage rubric in offline mode. Every attempt stores per-question scores and feedback.

### Revision scheduling

Flashcards use an SM-2-inspired algorithm: grades map to quality, ease factor, interval and repetition changes, with lapses resetting the interval. The due queue selects cards at or before the current time; review logs feed retention statistics.

### Planning and analytics

Planner scores topics by syllabus priority, marks, mastery gap and exam proximity, then distributes sessions across the requested horizon and daily minutes. Analytics aggregates real study sessions, quiz attempts, topic mastery and revision state. The readiness estimate is weighted by subject topic counts and explicitly presented as an estimate, not a prediction.

## Frontend

React 18 + TypeScript, Vite, Tailwind CSS and React Router. Pages are lazy-rendered through `App.tsx`; API calls go through one typed client. Global state covers subjects, settings, notifications and toasts. Charts use Recharts, mathematics uses KaTeX through react-markdown, and the lab editor uses CodeMirror.

Key route groups:

- `/` dashboard and onboarding
- `/subjects`, `/documents`, `/syllabus`
- `/tutor`, `/learn/:topicId`
- `/practice`, `/revision`, `/planner`, `/analytics`
- `/labs`, `/labs/:labId`, `/visuals`
- `/settings`

The UI uses CSS variables for theme and accent colours. Tailwind colour tokens are declared as `hsl(var(--token) / <alpha-value>)` so opacity modifiers work correctly.

## Desktop and packaging

`electron-builder` packages only `desktop/`, `assets/` and `package.json`, and copies `dist-backend/` to `resources/backend`. The NSIS target installs per user, creates desktop and Start Menu shortcuts, allows a custom directory and does not delete study data on uninstall.

The PyInstaller one-file build bundles the backend, its Python dependencies and `frontend/dist` as `frontend/dist` inside the executable, detected at runtime through `sys._MEIPASS`.

Build order:

```powershell
npm run build:frontend   # Vite production build
npm run build:backend    # PyInstaller one-file executable
npx electron-builder --win nsis
```

## Testing

- **Backend:** pytest API tests with a temporary `AIEC_DATA_DIR`, covering subjects, uploads, syllabus parsing, teaching, quizzes, revision, planner, analytics, labs and settings.
- **Frontend:** Vitest + Testing Library smoke tests for rendering, routing and theme/provider state.
- **Type safety:** `tsc --noEmit` in strict mode.
