# Contributing

Thanks for helping improve AI Engineering Companion. This project is a local-first study tool, so changes should preserve privacy, offline usability and honest learning behaviour.

## Development setup

Requirements: Windows 10/11, Node.js 22+, Python 3.11.

```powershell
npm install
npm --prefix frontend install

py -3.11 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Run the full desktop app in development:

```powershell
npm run desktop:dev
```

Run the API alone at `http://127.0.0.1:8765`:

```powershell
npm run dev:backend
```

Run the Vite frontend alone at `http://localhost:5173`:

```powershell
npm run dev:frontend
```

## Quality gates

Every change should pass:

```powershell
npm run typecheck
npm run test:backend
npm run test:frontend
npm run build:frontend
```

Backend tests use temporary data directories and must not touch `%LOCALAPPDATA%`. Frontend tests use Vitest and Testing Library.

## Guidelines

- Keep the offline path functional. Any AI-powered feature needs a deterministic, clearly labelled fallback.
- Never fabricate citations. Retrieval results must reference real uploaded pages.
- Do not mark topics complete based on viewing content alone; mastery requires a passed assessment.
- Keep secrets out of source. API keys belong in the encrypted settings store, never in commits or logs.
- Follow the existing Windows-first packaging flow: React build → PyInstaller backend → electron-builder.
- Match the existing code style: TypeScript strict, functional React components, small typed API helpers, Tailwind tokens instead of raw colours.
- Update tests and documentation with behaviour changes.
- Use descriptive commit messages, for example `feat(revision): add lapses to card summary`.

## Reporting bugs

Open a GitHub issue with:

1. What you expected and what happened.
2. Steps to reproduce.
3. App version and Windows version.
4. Relevant lines from `%LOCALAPPDATA%\AIEngineeringCompanion\logs\electron.log` or `backend.log`, with personal content removed.

Please do not attach private study material, API keys or personal data to issues.

## Security issues

Do not open a public issue for vulnerabilities. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the MIT License.
