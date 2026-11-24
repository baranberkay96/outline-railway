# Outline 1.13 Team Wiki with Built-in Login (Postgres, Redis, S3): composer spec

## Listing

| Field | Value |
|---|---|
| Name | **Outline 1.13 Team Wiki with Built-in Login (Postgres, Redis, S3)** |
| Description | Team knowledge base with e-mail login, job worker, Postgres and Bucket. (71 chars) |
| Category | Other |
| Icon | `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/outline.svg` |
| Repo | `baranberkay96/outline-railway`: `/services/outline` (Outline, Outline Worker), `/services/dex` (Dex) |

## Base market templates (checked 2026-11-24)

| Code | Active | Notes |
|---|---|---|
| `LNLiaz` | 106 | `outlinewiki/outline` untagged, local storage on a volume, Redis `?family=6`; no auth provider configured, so nobody can sign in until OAuth/SMTP is added; installation endpoint open |
| `outline` | 50 | Same, hard-coded `SECRET_KEY`/`UTILS_SECRET` shared by every deploy, Bitnami Redis |
| `outline-notion-alternative` | 7 | Same, broken `FILE_STORAGE_LOCAL_ROOT_DIR` (Windows path) |

## Services

| Service | Source | Port | Healthcheck | Volume |
|---|---|---|---|---|
| Outline | repo `/services/outline` (`FROM outlinewiki/outline:1.13.0@sha256:4583bb24…`), `SERVICES=web,websockets,collaboration`, pre-deploy `node /opt/outline/railway/predeploy.mjs` (1500 s) | 3000 public | `/_health` (600 s) | — |
| Outline Worker | same repo root, `SERVICES=worker` | 3000 private | `/_health` (900 s) | — |
| Dex | repo `/services/dex` (`FROM dexidp/dex:v2.46.1-alpine@sha256:65b72ca0…` + htpasswd + start script) | 5556 public | `/.well-known/openid-configuration` | — (memory storage) |
| Postgres | `postgres-ssl:18.6` | 5432 private | — | `/var/lib/postgresql/data` |
| Redis | `redis:8.2.11` | 6379 private | — | `/data` |
| Bucket | Railway Bucket | — | — | — |

## Design

1. **Login without OAuth or SMTP.** Outline has no passwords; e-mail magic links need SMTP (Pro only on Railway). Dex is bundled as an OIDC provider with static e-mail/password users: the admin from `OUTLINE_ADMIN_EMAIL`/`OUTLINE_ADMIN_PASSWORD` plus optional `DEX_EXTRA_USERS`. Outline talks to Dex's token/userinfo endpoints over the private network; only the login page is public. With one provider Outline redirects straight to Dex.
2. **No open installation endpoint (8.37).** Outline 1.x mounts `installation.create` (no auth) while no team exists. The pre-deploy step boots Outline on port 3999 inside the pre-deploy container, calls `installation.create` with the admin values and stops it, so the first public deployment already has the workspace. Later deploys see `teams > 0` in Postgres and skip it. The first OIDC login attaches the Dex provider to that team (`teamProvisioner`, self-hosted branch) and matches the admin by e-mail.
3. **Files in a Railway Bucket** (`FILE_STORAGE=s3`, virtual-hosted URLs, `AWS_S3_UPLOAD_METHOD=put`): web and worker share them without a volume. Browsers upload with presigned PUTs, so the pre-deploy sets a Bucket CORS rule for the Outline origin (best effort, logged).
4. **Separate worker** (`SERVICES=worker`) as in upstream's scaling guide; `WEB_CONCURRENCY=1` (Outline otherwise forks one process per host CPU).
5. **Deploy-form values (8.29):** an invalid admin e-mail falls back to `admin@{outline-host}` in both Dex and the pre-deploy; a password under 12 characters locks that Dex login with a random password (logged); a bad client secret is replaced (sign-in then fails with a clear log line instead of a crash).

## Improvements over market templates

- A working first sign-in, no takeover window, generated secrets, pinned digests.
- Worker service, Bucket storage instead of one volume, private Postgres/Redis.
- Healthchecks on web, worker and login service.

## Resources

See the round-13 report for measured values (filled after the deploy test).

## Verification checklist

- [ ] All services SUCCESS; `/_health` 200; pre-deploy log `workspace 'Outline' created`.
- [ ] Stranger `installation.create` refused.
- [ ] Dex login with the admin variables lands in Outline as admin; wrong password stays on Dex.
- [ ] Document create + search; attachment PUT to the Bucket and read back; collection export completed by the worker.

## Open questions

- Avatars use public-read object URLs in Outline; with a private Bucket they may not display (documents and attachments use signed URLs).
