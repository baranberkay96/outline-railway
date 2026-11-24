# Notice

This repository is a Railway template package for Outline. It contains configuration and small scripts written for this template (MIT-licensed); it does not contain Outline or Dex source code.

| Component | License | Used as |
|---|---|---|
| Outline 1.13.0 | Business Source License 1.1 (Additional Use Grant below; Change Date 2030-11-15, Change License Apache 2.0) | Official image `outlinewiki/outline:1.13.0@sha256:4583bb24…`, extended with our pre-deploy script |
| Dex 2.46.1 | Apache License 2.0 | Official image `dexidp/dex:v2.46.1-alpine@sha256:65b72ca0…`, plus `apache2-utils` (htpasswd) and our start script |
| PostgreSQL 18 | PostgreSQL License | `ghcr.io/railwayapp-templates/postgres-ssl:18.6` (Railway) |
| Redis 8.2 | RSALv2 / SSPLv1 / AGPLv3 | `redis:8.2.11` (official image, unmodified) |

## Outline license caveat (summary, not legal advice)

Outline is source-available, not open source. Its Additional Use Grant allows any use except a "Document Service": a commercial offering that lets third parties (other than your employees and contractors) create teams and documents they control. Running this template for your own organisation is within that grant; selling hosted Outline workspaces to other companies is not. Each version becomes Apache-2.0 licensed four years after release. Full text: https://github.com/outline/outline/blob/main/LICENSE

## Our own code

- `services/outline/railway/predeploy.mjs`: waits for Postgres/Redis, sets the Bucket CORS rule (the SigV4 request is adapted from this project's AFFiNE template), and calls Outline's own `installation.create` API on a private port to create the first workspace and admin.
- `services/dex/railway-dex.sh`: writes the Dex configuration (one OAuth client, static e-mail/password users with bcrypt hashes).

## Upstream files checked (tag v1.13.0 / v2.46.1)

- Outline: `.env.sample`, `Dockerfile`, `server/env.ts`, `server/index.ts`, `server/main.ts`, `server/utils/startup.ts`, `server/scripts/checkMigrations.ts`, `server/routes/api/installation/*`, `server/commands/teamProvisioner.ts`, `server/middlewares/csrf.ts`, `server/storage/files/S3Storage.ts`, `plugins/oidc/server/*`, `plugins/email/server/index.ts`, `LICENSE`
- Dex: `Dockerfile`, `config.yaml.dist`, `cmd/dex/config.go`, `pkg/featureflags/set.go`

Outline is a trademark of General Outline, Inc. This community template is not affiliated with or endorsed by General Outline, Inc. or the Dex project.
