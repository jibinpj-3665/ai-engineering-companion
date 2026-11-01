# Web Deployment

AI Engineering Companion can run as a self-hosted, account-based web app. This guide covers the supported topology: one FastAPI/React container, PostgreSQL, and a persistent data volume behind an HTTPS reverse proxy.

> The desktop app remains local-first and does not need any of this. The web server is intended for a small university, classroom, or personal deployment. It is **not** a horizontally scaled SaaS platform yet.
>
> **v1.3.0 verification status:** the Docker image, Docker Compose stack, PostgreSQL runtime path, and hosted deployment have not been executed in the release environment. Treat this guide as deployment-capable configuration, not a verified production deployment, until the container and PostgreSQL smoke tests pass.

## What the server provides

- React PWA served by the same FastAPI process.
- Email/password accounts, session cookies, scrypt password hashes, login throttling.
- Per-account isolation for subjects, documents, conversations, quizzes, plans, and backups.
- PostgreSQL in the Docker setup (SQLite remains the desktop default).
- Server-side AI provider keys, with optional encrypted per-account keys.
- Installable Android/iPhone PWA and an offline application shell.
- Password-reset email when SMTP is configured.
- Per-account ZIP backup/restore that excludes credentials and other users' data.

## Requirements

- Docker Engine with Docker Compose v2 (or a compatible container platform).
- A domain name and TLS certificate for anything reachable from the internet.
- A reverse proxy such as Caddy, Nginx, or Cloudflare Tunnel.
- 2 GB RAM and at least 5 GB disk for a small deployment; more for large document collections.
- Optional: SMTP credentials, AI provider keys. The Dockerfile installs Tesseract, but OCR has not been verified in this release.

## Quick start

```powershell
Copy-Item .env.example .env
# Edit .env before starting:
#   POSTGRES_PASSWORD  (URL-safe, long, unique)
#   AEC_PUBLIC_URL     (for example https://study.example.com)
#   AEC_OPENAI_API_KEY / AEC_GEMINI_API_KEY / AEC_GROQ_API_KEY (optional)

docker compose up -d --build
docker compose ps
```

The app binds to `127.0.0.1:8080` by default so it is not exposed directly to your network. Put a TLS reverse proxy in front of it.

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

The JSON response includes `"auth_required": true` when accounts are enabled.

### First account

`AEC_ALLOW_REGISTRATION=auto` permits registration only until the first non-local account exists. Create the first account at `/`, then registration closes automatically.

To create additional accounts, temporarily set `AEC_ALLOW_REGISTRATION=1`, register the accounts, then set it back to `0` and restart:

```powershell
docker compose up -d
```

There is currently no admin UI or role system. Keep registration closed on a public server unless you intend to allow open sign-up.

### HTTPS with Caddy

Example `Caddyfile` on the Docker host:

```caddyfile
study.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```

Set:

```dotenv
AEC_PUBLIC_URL=https://study.example.com
AEC_COOKIE_SECURE=auto
```

Caddy obtains and renews TLS certificates automatically. Forwarded headers are used to derive the cookie `Secure` flag and CSRF origin.

### HTTPS with Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name study.example.com;

    ssl_certificate     /etc/letsencrypt/live/study.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/study.example.com/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
```

`proxy_buffering off` matters for streaming tutor responses.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | required | Password for the Compose PostgreSQL service. Use a URL-safe value because it is embedded in the database URL. |
| `AEC_HTTP_PORT` | `8080` | Host port mapped to the container. Bound to loopback by default. |
| `AEC_PUBLIC_URL` | empty | Public origin, including scheme. Used in reset links and CSRF origin checks. |
| `AEC_REQUIRE_AUTH` | `0` | Compose sets `1`. Requires a signed-in account for every API call. Leave `0` only for trusted local desktop use; never expose a server with it disabled. |
| `AEC_ALLOW_REGISTRATION` | `auto` | `auto`, `1`, or `0`. `auto` allows only the first account. |
| `AEC_ENV_KEYS_ONLY` | `0` (Compose sets `1`) | `1` ignores API keys stored in accounts and uses only server environment keys. Recommended for shared servers. |
| `AEC_SESSION_DAYS` | `30` | Session lifetime in days. |
| `AEC_COOKIE_SECURE` | `auto` | `auto` sets `Secure` when the request is HTTPS; `1` forces it. |
| `AEC_CORS_ORIGINS` | dev origins | Comma-separated extra origins, only needed when the UI is served from a different origin. |
| `AEC_OPENAI_API_KEY` | empty | Server-side OpenAI key. |
| `AEC_GEMINI_API_KEY` | empty | Server-side Gemini key. |
| `AEC_GROQ_API_KEY` | empty | Server-side Groq key. |
| `AEC_CUSTOM_API_KEY` | empty | Server-side key for a custom OpenAI-compatible provider. |
| `AEC_SMTP_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_FROM` | empty / `587` | Password-reset email. |
| `AEC_SMTP_TLS` | `1` | STARTTLS for SMTP. |

Additional provider tuning variables such as `AEC_OPENAI_BASE_URL` and `AEC_OPENAI_MODEL` are documented in `.env.example`.

### SMTP and password reset

Configure SMTP and also set `AEC_PUBLIC_URL`; reset links otherwise fall back to `http://localhost:5173`, which is only useful in development. Without SMTP, the reset screen explains that email is unavailable and asks the administrator for help.

### AI keys

For a shared server, prefer server environment keys and `AEC_ENV_KEYS_ONLY=1`. Users then cannot add personal keys, and keys never appear in the browser.

For a single-user private server, `AEC_ENV_KEYS_ONLY=0` allows each account to store an encrypted key. The encryption key lives in the `/data` volume, so back that volume up securely; losing it makes stored provider keys unrecoverable.

Offline retrieval works with no provider. Answers in offline mode are explicitly labelled and limited to your uploaded material.

## Data and backups

Compose creates two named volumes:

- `aec-data` → application uploads, logs, encryption key, and per-account ZIP backups.
- `aec-postgres` → PostgreSQL data.

Per-account backup is available in **Settings → Workspace data**. It exports the signed-in account only, with credentials excluded. Restore replaces that account's data and does not touch other accounts.

Whole-server backup example:

```powershell
docker compose exec -T db pg_dump -U aec -d aec > aec-postgres.sql
docker run --rm -v ai-engineering-companion_aec-data:/data -v ${PWD}:/backup alpine tar czf /backup/aec-data.tar.gz -C /data .
```

Store both the database dump and data archive, plus the `.env` file (contains secrets), in an encrypted location. Test restores periodically.

## Upgrades

1. Create a database and data backup.
2. Pull or rebuild the new image.
3. Restart the stack.

```powershell
docker compose down
docker compose build --pull
docker compose up -d
```

Schema changes run automatically through `create_all` and the built-in migration routine. There is no automatic schema downgrade; restore the backup if you must return to an older version.

## Operational notes and limitations

- Run a **single app replica**. Uploads are stored on the container volume, not S3-compatible object storage, so multiple replicas would not share files.
- Login throttling is in memory and per process; it resets on restart and is not shared between replicas.
- There is no email verification, admin role, audit console, or automated account deletion.
- Vercel is not a suitable host for this FastAPI process with local upload storage. Render/Railway/Fly-style Docker hosts can work if you attach a persistent volume and a managed PostgreSQL database, but those configurations are not shipped here.
- Real AI calls, SMTP delivery, and cloud deployment require credentials and were not verified in the local build environment. The application reports provider errors instead of pretending a remote model answered.
- The PWA caches the interface shell only. Uploaded documents, account data, and AI answers require a connection.

## Security checklist

- Use HTTPS everywhere; never expose port 8080 directly to the internet.
- Set a long random `POSTGRES_PASSWORD`; keep `.env` out of git.
- Keep `AEC_REQUIRE_AUTH=1`.
- Close registration after creating accounts.
- Prefer `AEC_ENV_KEYS_ONLY=1` on shared servers.
- Configure SMTP before advertising password reset.
- Restrict the host firewall to ports 80/443.
- Back up PostgreSQL and the data volume, and protect the backup files.
- Monitor container logs and `/api/health`.

## Troubleshooting

**403 “Cross-site request blocked”**

Set `AEC_PUBLIC_URL` to the exact origin users open, including `https://`. If the UI is on a separate origin, add it to `AEC_CORS_ORIGINS`.

**Sign-in succeeds but the next request is unauthenticated**

Check that the public URL is HTTPS, `AEC_COOKIE_SECURE` is appropriate, and the reverse proxy forwards `Host` and `X-Forwarded-Proto`.

**Password-reset email does not arrive**

Verify SMTP variables, `AEC_PUBLIC_URL`, and provider spam settings. The API deliberately returns the same message whether or not an account exists.

**Uploads fail on large files**

Raise `AEC_MAX_UPLOAD_MB` in `.env` and the reverse proxy body limit. The default application limit is 80 MB.

**Streaming answers arrive all at once**

Disable proxy buffering for the app location and allow long read timeouts.

**Database authentication errors**

`POSTGRES_PASSWORD` is embedded in the connection URL. Use a URL-safe password or edit the Compose database URL and percent-encode the password consistently.

See also [ARCHITECTURE.md](ARCHITECTURE.md), [USER_GUIDE.md](USER_GUIDE.md), and the project [SECURITY.md](../SECURITY.md).
