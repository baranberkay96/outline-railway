# Deploy and Host Outline with Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/outline-113-team-wiki-with-built-in-logi?referralCode=20H68q)

Outline is a fast, collaborative knowledge base for teams: nested documents, real-time editing, Markdown shortcuts, search, comments and a public sharing option. This template runs Outline 1.13 with a background worker, PostgreSQL 18, Redis, a Railway Bucket for files and a small login service, so you can sign in right after the first deploy.

## About Hosting Outline

Outline does not have its own passwords: users sign in through an identity provider (Slack, Google, Microsoft, OIDC) or by e-mail magic links, which need SMTP. Railway allows outbound SMTP only on the Pro plan, and OAuth apps take setup time, so this template adds Dex, a lightweight OpenID Connect provider with e-mail and password logins. Your admin login is generated at deploy time.

On a fresh database Outline also exposes a "create workspace" endpoint that anyone could use. The template creates the workspace and its first admin in a pre-deploy step, before the public site serves. Attachments, avatars and imports live in a private Railway Bucket, so the web and worker services share them without a volume.

## Common Use Cases

- Team wiki and internal handbook with nested collections
- Engineering docs, runbooks and onboarding guides edited in real time
- Meeting notes and decision logs with comments and mentions
- Public documentation pages shared from a private workspace
- Replacing Notion or Confluence with a self-hosted knowledge base

## Dependencies for Outline Hosting

- Outline 1.13.0 (official image, pinned by digest)
- Dex 2.46 (OpenID Connect login provider)
- PostgreSQL 18 and Redis 8.2
- A Railway Bucket for files

### Deployment Dependencies

- Outline source: https://github.com/outline/outline
- Self-hosting docs: https://docs.getoutline.com/s/hosting
- OIDC configuration: https://docs.getoutline.com/s/hosting/doc/oidc-8CPBm6uC0I
- Dex: https://dexidp.io/docs/
- Railway Buckets: https://docs.railway.com/guides/storage-buckets

### Implementation Details

| Service | What it does | Public |
|---|---|---|
| Outline | Web app, API, real-time collaboration; pre-deploy creates the workspace | yes |
| Outline Worker | Background jobs: imports, exports, notifications, cleanup | no |
| Dex | Login page (e-mail + password) and OIDC provider for Outline | yes |
| Postgres | Documents, users, workspace data | no |
| Redis | Queues, websockets, cache | no |
| Bucket | Attachments, avatars, imports and exports (private) | no |

**First login**

1. Before deploying, set `OUTLINE_ADMIN_EMAIL` on the Outline service to your address (the default is `admin@{your-outline-domain}`).
2. After the deploy, open the Outline URL. You are sent to the Dex login page.
3. Sign in with `OUTLINE_ADMIN_EMAIL` and the generated `OUTLINE_ADMIN_PASSWORD` (Outline service, Variables tab). You land in your workspace as admin.

**More users.** Add `email:password` pairs to `DEX_EXTRA_USERS` on the Dex service (comma-separated, passwords of 12+ characters, no spaces or commas) and redeploy Dex. They join the workspace as members on their first login. You can also connect Google, Slack, Microsoft or another OIDC provider later by setting Outline's own variables.

**Admin password.** Change `OUTLINE_ADMIN_PASSWORD` and redeploy Dex. Values under 12 characters lock that login (the Dex log explains).

**E-mail.** Notification e-mails and e-mail sign-in need SMTP (`SMTP_*`); Railway allows SMTP only on Pro.

**Custom domain.** Add it to the Outline service, set `URL` to `https://{your-domain}`, redeploy Outline, Outline Worker and Dex (Dex reads the allowed redirect from it). The pre-deploy step also updates the Bucket CORS rule.

**Scaling and versions.** Add Outline Worker replicas for heavy import or export loads. Keep one Outline web replica unless you set `REDIS_COLLABORATION_URL`. Images are pinned by digest in `services/outline/Dockerfile` and `services/dex/Dockerfile`. To upgrade, change the tag and digest, back up Postgres and redeploy; migrations run automatically.

**Resources.** Measured idle on Railway: Outline 0.22–0.27 GB, worker 0.2–0.3 GB, Dex under 0.05 GB, Postgres 0.06–0.12 GB, Redis 0.04 GB; about 0.55–0.8 GB in total, roughly $6–8 per month plus Bucket storage. Every service fits the Trial plan's 1 GB; Hobby is recommended for teams.

**License.** Outline is published under the Business Source License 1.1. You may self-host it for your own organisation; you may not offer it to third parties as a commercial "Document Service" (hosted Outline workspaces for other companies). Each release converts to Apache 2.0 four years after its date. This is a community template, not affiliated with General Outline, Inc.

### Why Deploy Outline on Railway?

Railway runs Outline, its worker, PostgreSQL, Redis, file storage and the login service in one project with private networking and HTTPS. You get a working sign-in on the first deploy, no open setup page, and you can add a domain, worker replicas or your company's SSO from the dashboard.
