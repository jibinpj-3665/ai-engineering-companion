# Changelog

All notable changes to AI Engineering Companion are documented here.

## [1.3.0] - 2026-11-02

### Added
- Syllabus Library with recursive folder import, SHA-256 duplicate detection, source-path preservation, versioned re-imports, unindex/re-parse/rebuild, manifest export, subject/module/CO/topic browsing, and page-linked source access.
- Structured syllabus parser for course code/title, academic year, semester, LTPC/credits, preamble, prerequisites, corequisites, books, CO/Bloom levels, CO-PO mappings, modules, topic numbers, credits, and page references.
- Deterministic VLSI/S5 corpus import: 5 syllabus PDFs, 5 subjects, 20 modules, 103 topics, and 5 indexed documents. The unrelated one-page `print.pdf` is retained as a reference and skipped from the library.
- Semester-wise progress in Dashboard and Analytics, alongside per-subject and per-topic mastery.
- Native Electron folder picker plus loopback-only backend folder import, with an optional `AEC_IMPORT_ROOTS` allow-list for self-hosted deployments.
- Library API, search, manifest, import-batch history, subject detail, reparse, unindex, and rebuild endpoints.
- Parser/library/security tests and frontend library UI.
- Public-release documentation: current desktop/mobile screenshots, v1.3.0 release notes, checksums, and a publication checklist.

### Changed
- Re-importing a changed source file marks the previous document inactive, removes its chunks, and creates a new version. Topic status/mastery is preserved when topic number or title matches.
- RAG and syllabus question-paper lookups exclude unindexed or superseded documents.
- Unindexing preserves the stored copy and source file; it removes the document from retrieval and marks it `unindexed`.
- AI chat and streaming now honor the configured maximum output tokens instead of a hardcoded 1600; the default is 4096, clamped to 128-8192.
- AI status counts only active, ready documents and their chunks. The inactive reference `print.pdf` is no longer counted as a ready study document.
- Citation auditing accepts grouped and ranged source labels such as `[S1, S2]` and `[S3-S4]`.
- Backend dependencies were refreshed to FastAPI 0.162.0, Starlette 1.10.0, python-multipart 0.0.33, Pillow 13.0.0, cryptography 50.0.2, pytest 9.2.0, and setuptools 84.1.0. Frontend pins were upgraded to React Router 7.18.5 and KaTeX 0.16.47.
- Backend, desktop, and frontend versions advanced to `1.3.0`.
- Documentation identifies text extraction limits and source typos rather than silently rewriting the syllabus. VLSI module VI is stored as sequence 4 with its original label preserved; the source topic beginning `iffusion` is retained as printed.

### Security
- Folder import is rejected for non-loopback clients unless the source is under `AEC_IMPORT_ROOTS`.
- Source folders are read-only to the application; originals are copied into managed upload storage and are not renamed, moved, or deleted.
- Startup migration backfills `DocumentChunk.subject_id` from the owning document, preventing subject-scoped retrieval from missing existing chunks.
- Post-login redirects accept only same-app internal paths, rejecting absolute, protocol-relative, backslash, and control-character targets.
- Account-mode tests now enumerate every protected API route, reject invalid and expired sessions, enforce CSRF origin checks including `Origin: null`, and verify cross-account subject, document, download, search, and conversation isolation.
- Python dependency audit reports no known vulnerabilities; root production npm audit reports zero. The remaining frontend advisories are four low-severity KaTeX-toolchain findings that require a breaking major upgrade.

### Testing
- Backend suite: 47 passing tests, 3 optional live Gemini variants skipped without a configured key.
- Frontend suite: 10 passing tests.
- TypeScript strict typecheck and production PWA build verified; the PWA emits a service worker and manifest, with a non-blocking large-chunk warning.
- Fresh account-mode HTTP run passed 23 checks covering health, headers, unauthenticated denial, invalid sessions, registration, tenant isolation, CSRF, upload, search, offline chat, persistence, settings, progress, dashboard, backup, SPA/PWA, and logout.
- The packaged backend passed the same 23-check account-mode smoke test from a fresh temporary data directory.
- Migration test seeded 119 chunks with null subject IDs, ran startup migration on a copy of the real database, and restored all 119 subject IDs at schema version 6.
- Backup/restore round-trip test verified a subject, document, and conversation survive export, deletion, and restore.
- Actual Sahrdaya ECE S5 corpus imported and checked for counts, page references, search, relational RAG retrieval, semester analytics, and source immutability.
- Live Gemini calls succeeded in separate connection, engineering-answer, numerical-answer, and streaming runs before the free-tier daily quota was exhausted. A final all-green live rerun remains blocked until quota reset.
- Windows v1.3.0 backend and NSIS installer rebuilt. The packaged backend and unpacked Electron app were smoke-tested; the installer itself was not run on a clean machine. Final sizes, SHA-256 hashes, verification evidence, and publication caveats are recorded in the [v1.3.0 release notes](docs/releases/v1.3.0.md). Both binaries are unsigned.

## [1.2.0] - 2026-11-01

### Added
- Official Google Gen AI SDK (`google-genai` 2.34.0) for Gemini chat, native async streaming, model discovery, and embeddings.
- Stable `[S#]` source labels with citation auditing, cited-passage highlighting, document/page/section metadata, and explicit warnings when a model answer has no valid citation.
- Actionable Gemini error mapping for invalid keys, permission failures, missing models, quota/rate limits, timeouts, and temporary 5xx responses. Errors are sanitized so API keys are never logged or returned.
- Mocked SDK integration tests for non-streaming, streaming, quota failures, and cited source persistence.
- Optional live Gemini test that skips unless `AEC_GEMINI_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY` is configured.
- PDF, DOCX, and TXT ingestion tests covering page and section metadata.

### Changed
- Backend, desktop, and frontend versions advanced to `1.2.0`.
- Pydantic upgraded to `2.14.2` for official SDK compatibility.
- Gemini requests now honor timeout, base URL, API version, JSON mode, system instruction, and bounded retry settings through the SDK.
- Remote Gemini embeddings now use retrieval-document/retrieval-query task types.
- Documentation clarifies that the repository uses relational `DocumentChunk` retrieval, not ChromaDB, and does not ship a Chroma index.

### Testing
- Backend suite: 36 passing tests, 1 optional live Gemini test skipped because no API key is configured.
- Frontend suite: 8 passing tests.
- TypeScript strict typecheck verified.
- Live Gemini responses require a locally configured key and were not verified in this environment.

## [1.1.0] - 2026-11-01

### Added
- Account mode with email/password registration, sign-in, profile updates, password changes, session cookies, login throttling, and optional SMTP password reset.
- Per-account isolation for every study table, background document processing, AI usage logs, and backup/restore.
- PostgreSQL support through `AEC_DATABASE_URL`, `psycopg`, and a dedicated PostgreSQL CI job.
- Multi-user web deployment with PostgreSQL, persistent volumes, loopback-only publishing, and required accounts.
- Real provider presets for OpenAI, Google Gemini, Groq, Ollama/local servers, custom OpenAI-compatible endpoints, and offline retrieval.
- Streaming tutor responses over SSE with stop control, teaching modes, explicit provider errors, and labelled offline fallback.
- Structured answer evaluation that does not silently change topic mastery.
- Model discovery, connection testing, per-account usage metadata, and server-side environment key mode.
- Installable PWA with manifest, generated icons, service worker, offline shell, update prompt, and install prompt.
- Mobile bottom navigation and safe-area-aware layout.
- Staged document upload/extraction/indexing progress, crash recovery, PDF signature validation, capability reporting, and original-file download.
- CSRF origin enforcement for mutating API requests.
- Remote desktop mode through `AEC_REMOTE_URL`.
- PostgreSQL integration tests for accounts, tenancy, CSRF, backups, streaming, and document validation.

### Changed
- Backend version and desktop version advanced to `1.1.0`.
- Document processing and AI streaming now establish user context in background work.
- AI streaming saves assistant messages inside its own database session and reports save failures.
- Backup format v2 exports only the signed-in account, excludes credentials and other users, remaps IDs, validates references, and cleans up failed restores.
- Settings, sidebar, and top bar now use the signed-in account identity.
- Web deployment defaults to required accounts and server-managed AI keys instead of Basic authentication.

### Security
- Scrypt password hashing, HTTP-only SameSite session cookies, optional forced `Secure` cookies, and session revocation on password change/reset.
- Per-account scoping is enforced at the ORM query layer and re-established in background tasks.
- Backup archives are constrained by compressed and uncompressed size limits and cannot write outside the uploads directory.
- Same-origin checks block cross-site mutations, complementing SameSite cookies.
- Security headers include a restrictive Content Security Policy, HSTS over HTTPS, frame denial, MIME sniffing protection, and restricted permissions.
- Electron main renderers are sandboxed and navigation is restricted by exact origin, blocking origin-prefix/userinfo bypasses.
- Updated Electron 45.2.1, Vite 6.4.5, Vitest 4.1.12, React Router 6.30.6, and PostCSS 8.5.32; `npm audit` reports no high or critical findings in app or frontend dependency trees.

### Testing
- Backend suite: 20 passing tests.
- Frontend suite: 8 passing tests.
- TypeScript strict typecheck and production PWA build verified.

## [1.0.0] - 2026-10-31

First complete desktop release.

### Added
- Local-first engineering study workspace for Windows, packaged with Electron and NSIS.
- Subject workspace with colours, semesters, departments, and completion tracking.
- Document ingestion for PDF, DOCX, PPTX, TXT, Markdown, and images, with page-aware extraction, chunking, local embeddings, and optional OCR.
- AI-assisted and heuristic syllabus analysis with module extraction, weighted priorities, reason explanations, and notes-coverage mapping.
- Ten-phase step teaching workflow with citations, regeneration, and progress tracking.
- Mastery-gated topic completion: 70% marks a topic learned, 85% marks it mastered.
- Retrieval-augmented AI Tutor with five teaching personalities, conversation history, citations, speech input/output, and offline fallback.
- Seven assessment modes with nine question types, per-question evaluation, mistake analysis, and saved questions.
- SM-2-inspired spaced revision, due queue, card library, and flashcard generation from notes and quiz mistakes.
- Exam-aware study planner, ranked topic queue, daily missions, and a focus timer that logs study time.
- Learning analytics: weekly study pulse, subject completion, quiz averages, retention, streaks, weak topics, and an explainable exam-readiness score.
- Eight guided virtual labs with theory, algorithms, runnable code, simulated results, troubleshooting, and viva questions.
- Seven interactive visual experiments covering sampling, RC, RLC, diode, logic, CMOS, and FFT concepts.
- Settings for profile, theme, accent, AI provider, backup/restore/reindex, and keyboard shortcuts.
- Automated tests: 11 backend API integration tests and 5 frontend smoke tests.

### Security
- API keys encrypted at rest with Fernet using a device-local key.
- Electron context isolation, no Node.js integration in the renderer, restricted navigation, and external URL handling.
- Backend binds to localhost only. No telemetry or analytics collection.
