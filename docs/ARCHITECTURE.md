# Architecture

AI Engineering Companion ships in two forms from one codebase:

1. **Desktop:** Electron host + packaged FastAPI backend + React SPA, all on localhost, with SQLite.
2. **Web:** FastAPI serving the React PWA, backed by PostgreSQL, with account authentication and per-user isolation.

## Runtime layouts

### Desktop

```text
Electron main process (desktop/main.js)
  - single-instance lock and splash window
  - finds a free localhost port, or uses AEC_REMOTE_URL
  - spawns resources/backend/ai-engineering-companion-backend.exe
        - FastAPI + SQLite + uploaded files
  - waits for GET /api/health
  - loads http://127.0.0.1:<free-port> in a sandboxed BrowserWindow
        - serves the built React SPA from the PyInstaller bundle
```

With `AEC_REMOTE_URL`, Electron loads the remote HTTPS app and does not start a local backend. The local-first mode remains the default.

In development, `AEC_DEV_SERVER` points Electron at Vite; the backend stays on port `8765`. Unpackaged Electron probes port `8765`, then falls back to `backend\.venv\Scripts\python.exe backend\run.py`.

Desktop data lives under `%LOCALAPPDATA%\AIEngineeringCompanion` (override `AIEC_DATA_DIR`): SQLite database, uploads, logs, backups, and `secret.key`.

### Web

```text
HTTPS reverse proxy (Caddy/Nginx)
  - FastAPI container on loopback:8080
        - React PWA from frontend/dist
        - /api/* JSON + SSE
        - PostgreSQL via AEC_DATABASE_URL
        - /data volume: uploads, logs, secret.key, per-account backups
```

The Compose stack publishes only `127.0.0.1:8080`; the reverse proxy terminates TLS. `AEC_PUBLIC_URL` anchors reset links and CSRF origin checks.

## Backend

```text
backend/
  run.py                 uvicorn entry point (PyInstaller friendly)
  app/
    main.py              app setup, routers, SPA/PWA fallback, logging
    config.py            paths, providers, accounts, SMTP, env overrides
    database.py          engine, tenancy hooks, migrations, legacy claim
    models.py            SQLAlchemy ORM
    web_middleware.py    session auth, Basic fallback, CSRF, headers
    serializers.py       API dictionary shapes
    security.py          Fernet encryption for per-account secrets
    labs.py              curated experiment definitions
    ai/
      providers.py       official Gemini SDK + OpenAI-compatible chat/stream/embeddings
      rag.py             chunking, retrieval, offline scaffolds
    routers/             endpoints under /api
    services/            auth, settings, documents, backup, email,
                         syllabus_parser, syllabus_library
  tests/                 API/auth/tenancy integration tests
```

### Data model

Every study table has a nullable `user_id` foreign key. Desktop mode uses one local account; web mode isolates accounts at the ORM layer.

| Model | Purpose |
| --- | --- |
| `User`, `UserSession`, `PasswordResetToken` | Accounts, hashed session tokens, reset tokens |
| `AIUsageLog` | Provider, model, operation, size, latency, status, error text |
| `Subject` | Semester subject with colour, code, and status |
| `Document` | Uploaded file, extraction stage/progress, source/hash/version metadata |
| `DocumentChunk` | Page-aware text chunk with embedding |
| `SyllabusImportBatch` | Folder import status, counts and per-file manifest |
| `SyllabusModule` | Module label, sequence, hours, pages and description |
| `SyllabusCourseOutcome` | CO description, Bloom level, page and CO-PO mapping |
| `SyllabusTopic` | Topic, module, marks, priority, mastery, status, page |
| `TeachingSession` | Per-topic ten-phase progress |
| `Conversation`, `Message` | Tutor threads and cited replies |
| `Quiz`, `QuizQuestion` | Generated assessments and questions |
| `QuizAttempt` | Scores, timing, evaluation, mistake analysis |
| `Flashcard` | SM-2 scheduling state |
| `StudySession` | Logged focus/study minutes |
| `Exam` | Exam date, weighting, subject |
| `ScheduleSession` | Generated study plan entries |
| `Preference`, `Secret` | Scoped settings and encrypted provider keys |
| `Notification`, `SavedQuestion`, `LabArtifact` | Supporting records |

Preferences and secrets use account-prefixed primary keys (`u<id>:<key>`) because their logical key is the primary key. Lab slugs are scoped the same way.

### Authentication and tenancy

- Email/password accounts use scrypt hashes (`n=2^14, r=8, p=1`).
- Sessions use random tokens; only SHA-256 hashes are stored. The cookie is HTTP-only, SameSite=Lax, optionally Secure.
- `AuthMiddleware` resolves the session, sets a user `ContextVar`, and protects `/api/*` except status, login, registration, reset, and health.
- ORM `do_orm_execute` adds `user_id == current user` to tenant model selects. `before_flush` stamps new rows. Background tasks and SSE generators establish the same context explicitly.
- Mutating API requests with a mismatched `Origin` are rejected, complementing SameSite cookies.
- Legacy unowned rows are claimed by the first local account or first registered account, and legacy preference keys are migrated to the account prefix.
- Password changes and resets revoke sessions. Login throttling is in memory.

### PostgreSQL and migrations

`AEC_DATABASE_URL` selects the database. SQLite remains the default for desktop; Compose supplies a `postgresql+psycopg://` URL. Startup runs `create_all`, portable `ALTER TABLE`/`CREATE INDEX IF NOT EXISTS` migrations, and a schema version row. PostgreSQL tests run in a separate CI job against PostgreSQL 16.

### Document pipeline

1. Validate extension and file signature, enforce the upload size limit, and save under `uploads/`.
2. Set stage `queued`, then `extracting` with progress.
3. Extract page by page: PyMuPDF (PDF), python-docx (DOCX), python-pptx (PPTX), Pillow + pytesseract (images), direct read (text). OCR availability is reported, not assumed.
4. Detect headings/tables where possible, split into overlapping chunks (~1,000 characters), and embed each chunk locally (deterministic 384-dimension feature hashing) or with the configured remote provider.
5. Replace chunks atomically, then set `ready` and progress 100. Failures store an error and `failed`.
6. Startup recovery re-queues interrupted documents; processing runs in a background thread with an explicit user context.

Retrieval scores cosine similarity plus keyword overlap, filters by account/subject/document, excludes `active = false` documents, and returns page-aware citations. Chunks and embeddings live in the relational `DocumentChunk` table; this repository does not use ChromaDB and has no Chroma data to migrate.

### Syllabus library pipeline

`POST /api/syllabus/library/import` accepts a local folder path. The guard allows loopback clients only unless the resolved path is under `AEC_IMPORT_ROOTS`. The importer walks the folder, rejects unsupported/oversized files, computes SHA-256, and treats only active syllabus documents as duplicates. Changed files at the same source path create a new document version; the previous version becomes inactive, its chunks are removed, and matching topic status/mastery is preserved.

Each accepted file is copied into `uploads/`, processed through the same extraction/indexing pipeline, and parsed deterministically into course metadata, modules, outcomes and numbered lecture-schedule topics. Documents without a course code and syllabus structure are kept as inactive references. Imports record a batch and manifest; reparse/rebuild and unindex never delete the stored copy or the original source file.

The parser preserves source wording and page references instead of repairing document errors. It normalises the storage sequence when module labels are typo'd (for example `Module VI` after `Module III`) and emits a warning while retaining the original label. Inferred semesters are labelled as such.

### AI provider abstraction

`services/settings.py` resolves provider, model, base URL, temperature, key, key source, and environment-only mode. `ai/providers.py` supports OpenAI, Gemini, Groq, custom OpenAI-compatible endpoints, local Ollama/LM Studio, and offline retrieval. Gemini uses the official `google-genai` asynchronous SDK with native streaming, request timeouts, bounded retries, and sanitized error mapping. Prompts instruct the model to use only the supplied `[S#]` labels and avoid invented citations.

Retrieved sources carry stable labels, document/page metadata, headings, scores, and a `cited` flag. The backend checks returned labels against the retrieved set, warns when a model answer has no valid citation, and stores that metadata with the assistant message.

`POST /api/ai/chat/stream` emits SSE events:

```text
event: meta    conversation id, title, generator, sources, user message id
event: delta   token text
event: error   provider error detail (if the remote call fails)
event: done    saved assistant message id, generator, note, sources, citation audit
```

If a configured provider fails, the stream emits an explicit `error` and then a clearly labelled offline retrieval answer. The UI never presents that fallback as a remote model result. The SSE generator owns its database session and user context, so the assistant message is saved after the request-scoped session closes.

Offline mode uses deterministic extraction, heuristics, and citation scaffolds.

### Accounts, backups, and key storage

Per-account backup (`aec-backup-v2`) contains account rows plus referenced uploads. It excludes credentials, sessions, and AI usage logs; remaps foreign keys and IDs; validates references; limits compressed and uncompressed size; and deletes extracted files if a restore fails. Restore replaces only the current account's data.

Provider keys are encrypted with Fernet using `secret.key`. On shared servers, `AEC_ENV_KEYS_ONLY=1` ignores stored account keys and uses server environment keys, so the browser never receives them.

### Teaching and mastery rules

Ten fixed phases: context, intuition, formal definition, derivation, visual explanation, worked example, engineering application, exam strategy, pitfalls, mastery check. Viewing phases records progress but never completes a topic. A mastery quiz at 70% sets the topic to `learned`; 85%+ sets `mastered`. Structured tutor answer evaluation does not change mastery.

### Practice, revision, planning

Seven assessment modes define count, duration, and mark distributions. Questions are generated from retrieval context and syllabus topics, validated by question type, and graded exactly for objective items or by model/keyword rubric for written answers. Flashcards use an SM-2-inspired algorithm. The planner scores topics by priority, marks, mastery gap, and exam proximity, then distributes sessions across the horizon. Analytics uses real study sessions, attempts, mastery, and revision state; readiness is presented as an estimate.

## Frontend

React 18 + TypeScript, Vite, Tailwind CSS, React Router, and `vite-plugin-pwa`. A typed API client centralizes fetch/XHR/SSE handling, credentials, error messages, and the `aec:unauthorized` event. `AppContext` holds auth status, account, settings, subjects, notifications, and AI status; `AuthGate` shows the login/register page when accounts are required.

Key routes:

- `/`, `/subjects`, `/documents`, `/syllabus`, `/syllabus-library`
- `/tutor`, `/learn/:topicId`
- `/practice`, `/revision`, `/planner`, `/analytics`
- `/labs`, `/labs/:slug`, `/visuals`
- `/settings`
- `/reset-password` (public token-confirmation page)

The PWA manifest, icons, and Workbox service worker are generated at build time. Navigation requests fall back to the cached app shell; API calls are `NetworkOnly`; static assets use stale-while-revalidate. The app prompts before activating a new service worker. Mobile navigation is a bottom bar with safe-area padding.

The UI uses CSS variables for theme and accent colours. Tailwind colour tokens are declared as `hsl(var(--token) / <alpha-value>)` so opacity modifiers work.

## Packaging

`electron-builder` packages `desktop/`, `assets/`, and `package.json`, and copies `dist-backend/` to `resources/backend`. The NSIS target installs per user, creates shortcuts, allows a custom directory, and preserves study data on uninstall.

PyInstaller bundles the backend, dependencies, and `frontend/dist`; `sys._MEIPASS` locates static files at runtime.

```powershell
npm run build:frontend   # Vite build + PWA assets
npm run build:backend    # PyInstaller one-file executable
npx electron-builder --win nsis
```

## Testing

- **Backend:** 47 pytest tests with a temporary `AIEC_DATA_DIR`, covering the official Gemini SDK adapter, async streaming, grouped citation persistence, PDF/DOCX/TXT ingestion, syllabus import/duplicate/version/reparse/unindex, import allow-list security, every protected API route, invalid/expired sessions, accounts, tenancy including conversations/downloads, CSRF, backup/restore, chunk-subject migration, SSE ownership, document validation, and study workflows. A CI job runs the same suite against PostgreSQL 16. The opt-in live Gemini tests skip unless a key is configured.
- **Packaged runtime:** a 23-check account-mode HTTP suite runs against the PyInstaller backend from a fresh temporary data directory; the packaged Electron app is smoke-tested against that backend.
- **Frontend:** Vitest tests for SSE parsing, credential/401 behavior, validation messages, and smoke rendering.
- **Type safety:** `tsc --noEmit` in strict mode.
- **Build:** Vite production build verifies the PWA manifest/service worker output.

Real provider calls, OCR, SMTP delivery, Docker execution, and live hosting require external credentials/services and are reported as blocked until verified.
