# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories:

<https://github.com/jibinpj-3665/ai-engineering-companion/security/advisories/new>

If advisories are unavailable, open a minimal public issue asking for a private contact channel without disclosing the vulnerability. Please include reproduction steps, affected versions and impact. Do not include API keys, personal notes or study data.

## Security model

AI Engineering Companion is a single-user desktop application, not a multi-tenant service.

- The FastAPI backend binds to `127.0.0.1` only. Electron starts it on a free port with a fresh process per launch.
- There is no authentication layer between the desktop UI and the local API. Do not expose the port to a network or run the app on a shared Windows account where other users can reach your session.
- API keys are encrypted with Fernet using a key stored in the local data directory. This protects against casual inspection of the database; it does not protect against an attacker who can read your Windows profile.
- When an AI provider is configured, prompts and retrieved study context are sent to that provider. Offline mode performs no network AI calls. Review your provider's data policy before uploading sensitive material.
- Uploaded documents are parsed locally. Optional OCR requires a separately installed Tesseract binary.
- Electron runs with `contextIsolation`, no renderer Node.js integration, restricted navigation and external links opened in the system browser. The preload bridge exposes only app metadata and folder/external-link actions.
- No telemetry, crash reporting or analytics are sent anywhere.

## Data location and removal

Study data is stored in `%LOCALAPPDATA%\AIEngineeringCompanion`. Uninstalling the app does not delete this folder. To remove all data, close the app and delete that directory. Backups created by the app are stored in the `backups` subfolder.

## Dependency updates

Dependencies are pinned in `backend/requirements.txt`, root `package-lock.json` and `frontend/package-lock.json`. Security reports involving a pinned dependency should include the package name, version and CVE where available.
