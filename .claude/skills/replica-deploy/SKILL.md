---
name: replica-deploy
description: Stage 8 of the Replica pipeline. Package a replica product (API, web, Postgres, n8n hooks) for the user's Coolify VPS with Docker Compose, health checks, backups, monitoring and a staging/production split. Use when the user says go for the deploy stage or asks to deploy the replica.
argument-hint: <product folder>
---

# Replica deploy

Follow the repo's existing pattern in `deploy/` (README with prerequisites, install, what it does, and how to verify). Write `deploy/<product>/`.

## Build

- A Dockerfile per service: multi-stage, non-root, pinned base images, and a `HEALTHCHECK`.
- `docker-compose.yml` for Coolify, with these services:
  - `api`
  - `web`
  - `postgres` (with PostGIS, image `postgis/postgis:16-3.x`), with a named volume
  - `migrate`, a one-shot job
  - Coolify handles TLS and the domain, so no `ports` are exposed except through it.
- Memory limits per service so it all fits on the 16 GB VPS alongside existing workloads. Show the budget table.
- Env: a `.env.example` per environment. Secrets go in Coolify's secret store, never in git.
- Backups: a nightly `pg_dump` to S3-compatible storage, kept 14 days, plus a **tested restore** command.
- Monitoring: uptime checks on `/health`, error tracking (Sentry DSN through env), and a log retention note.
- A staging and a production Coolify app from the same compose file with different env.
- Step-by-step Coolify deploy instructions, plus a paste-ready Claude Code prompt for the server.

## Gate

`docker compose build` and `docker compose up` locally. Health checks go healthy, migrations run, one end-to-end API call succeeds, and a backup-then-restore round trip works. Show the output.
Do **not** deploy to the live VPS or touch DNS without the user's explicit go.
Commit as "Deploy: <product>" and stop for the user's go.
