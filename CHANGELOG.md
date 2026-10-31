# Changelog

All notable changes to AI Engineering Companion are documented here.

## [1.0.0] - 2026-10-31

First complete desktop release.

### Added
- Local-first engineering study workspace for Windows, packaged with Electron and NSIS.
- Subject workspace with colours, semesters, departments and completion tracking.
- Document ingestion for PDF, DOCX, PPTX, TXT, Markdown and images, with page-aware extraction, chunking, local embeddings and optional OCR.
- AI-assisted and heuristic syllabus analysis with module extraction, weighted priorities, reason explanations and notes-coverage mapping.
- Ten-phase step teaching workflow with citations, regeneration and progress tracking.
- Mastery-gated topic completion: 70% marks a topic learned, 85% marks it mastered.
- Retrieval-augmented AI Tutor with five teaching personalities, conversation history, citations, speech input/output and offline fallback.
- Seven assessment modes with nine question types, per-question evaluation, mistake analysis and saved questions.
- SM-2-inspired spaced revision, due queue, card library and flashcard generation from notes and quiz mistakes.
- Exam-aware study planner, ranked topic queue, daily missions and a focus timer that logs study time.
- Learning analytics: weekly study pulse, subject completion, quiz averages, retention, streaks, weak topics and an explainable exam-readiness score.
- Eight guided virtual labs with theory, algorithms, runnable code, simulated results, troubleshooting and viva questions.
- Seven interactive visual experiments covering sampling, RC, RLC, diode, logic, CMOS and FFT concepts.
- Settings for profile, theme, accent, AI provider, backup/restore/reindex and keyboard shortcuts.
- Open datasets are not bundled; all study data remains local.
- Automated tests: 11 backend API integration tests and 5 frontend smoke tests.

### Security
- API keys encrypted at rest with Fernet using a device-local key.
- Electron context isolation, no Node.js integration in the renderer, restricted navigation and external URL handling.
- Backend binds to localhost only. No telemetry or analytics collection.
