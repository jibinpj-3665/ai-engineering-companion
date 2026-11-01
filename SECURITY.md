# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.3.x | Yes |
| 1.2.x | Yes |
| 1.1.x | Yes |
| 1.0.x | No |

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories:

<https://github.com/jibinpj-3665/ai-engineering-companion/security/advisories/new>

If advisories are unavailable, open a minimal public issue asking for a private contact channel without disclosing the vulnerability. Include reproduction steps, affected versions, and impact. Do not include API keys, personal notes, or study data.

## Security model

AI Engineering Companion supports a local-first desktop app and a self-hosted, account-based web deployment.

### Desktop

- The FastAPI backend binds to `127.0.0.1` only. Electron starts it on a free port with a fresh process per launch.
- The local account is created automatically. There is no remote sign-in in local mode. This trusted-local mode must not be exposed to a network; set `AEC_REQUIRE_AUTH=1` for any account-based server deployment.
- `AEC_REMOTE_URL` can point the desktop shell at a remote HTTPS deployment. HTTP is accepted only for localhost.
- API keys can be encrypted with Fernet using `secret.key` in the data directory. This protects against casual database inspection; it does not protect against an attacker who can read the Windows profile or the key file.
- Electron uses context isolation, no renderer Node.js integration, restricted navigation, sandboxed renderers, and external links opened in the system browser. The preload bridge exposes only metadata and folder/external-link actions.

### Web

- `AEC_REQUIRE_AUTH=1` (set by Compose) requires an account for every API route except health, status, login, registration, password reset, and static assets.
- Passwords are hashed with scrypt. Session tokens are random and stored only as SHA-256 hashes. Cookies are HTTP-only and SameSite=Lax; `Secure` is set automatically over HTTPS or forced with `AEC_COOKIE_SECURE=1`.
- Login attempts are throttled in memory. Password changes and resets revoke sessions.
- Tenant-scoped ORM queries and writes isolate accounts. Background document processing and SSE generation re-establish the account context explicitly.
- Mutating `/api/*` requests with a mismatched `Origin` are rejected, complementing SameSite cookies.
- Per-account backup archives exclude credentials, sessions, AI usage logs, and other accounts. Archive size and reference checks limit abuse, and failed restores clean up extracted files.
- Security headers include a restrictive Content Security Policy, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, a permissions policy, COOP, and HSTS over HTTPS. API responses use `Cache-Control: no-store`.
- `/api/health` is public for container health checks and exposes only app name, version, runtime mode, and whether auth is required.

### Release verification

The v1.3.0 work tree was checked with 47 passing backend tests and 10 passing frontend tests. Security-focused coverage includes an inventory test that requests every non-public API route without a session and requires HTTP 401, invalid and expired session rejection, CSRF rejection for mismatched and `null` origins, and cross-account isolation for subjects, documents, downloads, search, and conversations. A packaged backend smoke test runs in explicit account mode (`AEC_REQUIRE_AUTH=1`) from a fresh temporary data directory and verifies 23 checks, including authentication, invalid sessions, CSRF, tenant isolation, backup download, and logout.

`pip-audit` reports no known Python vulnerabilities, `pip check` reports no broken requirements, and the root production npm audit reports zero vulnerabilities. The frontend production audit retains four low-severity advisories in the KaTeX/remark/rehype toolchain; resolving them requires a breaking KaTeX 0.19 upgrade. The Windows installer remains unsigned.

### Known limitations

- There is no admin role, email verification, audit console, or SSO.
- Login throttling is per-process and resets on restart; it is not shared across replicas.
- The web deployment is single-replica. Uploads are stored on a local volume, not S3-compatible object storage.
- The PWA offline cache contains the interface shell, not account data or documents.
- In v1.3.0, Docker/PostgreSQL/cloud deployment, SMTP delivery, and OCR were not runtime-verified. Provider and hosting behavior depends on external credentials and infrastructure.

## Secrets and providers

- Shared servers should use `AEC_ENV_KEYS_ONLY=1` with provider keys supplied through environment variables. The browser never receives those keys.
- Per-account keys, when enabled, are encrypted at rest. Anyone who can read both the database and `secret.key` can decrypt them; protect the data volume and backups accordingly.
- When an AI provider is configured, prompts and retrieved study context are sent to that provider. Offline mode performs no network AI calls. Review the provider's data policy before uploading sensitive material.
- Uploaded documents are parsed locally. OCR uses Tesseract; the Dockerfile installs it and it remains optional on desktop. OCR has not been verified in this release.
- No telemetry, crash reporting, or analytics are sent anywhere.

## Data location and removal

Desktop data is stored in `%LOCALAPPDATA%\AIEngineeringCompanion`. Uninstalling the app does not delete this folder. To remove all data, close the app and delete that directory. Backups created by the app are stored in the `backups` subfolder.

On a server, data lives in PostgreSQL and the Docker `aec-data` volume. Removing containers does not remove named volumes; delete them deliberately and destroy server backups according to your retention policy.

## Dependency updates

Dependencies are pinned in `backend/requirements.txt`, root `package-lock.json`, and `frontend/package-lock.json`. Security reports involving a pinned dependency should include the package name, version, and CVE where available. Run `npm audit` and rebuild after updating dependencies.
