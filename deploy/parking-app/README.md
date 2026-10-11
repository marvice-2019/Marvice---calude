# Bayline on Coolify (staging + production)

Bayline (`parking-app/`) runs on the existing 16 GB Coolify VPS as **two Coolify apps built from one compose file**: staging and production differ only in their environment variables. Coolify's Traefik handles TLS and domains, so no service publishes a host port.

**Not deployed yet.** Nothing here has touched the live VPS or DNS. The steps below are what happens after the go.

## Prerequisites

- Coolify v4 on the VPS with the GitHub app connected to `marvice-2019/marvice---calude`.
- Two DNS records you control, e.g. `bayline.<domain>` and `staging.bayline.<domain>`, pointing at the VPS (A record). Add them only when we go live.
- An S3-compatible bucket for backups (Cloudflare R2 recommended: no egress fees, 10 GB free). Create **one bucket** with an API token scoped to it (Object Read & Write). Staging and production use different prefixes in it.
- Razorpay: test keys for staging, **live** keys plus a webhook secret for production.
- Sentry: one project per app (`bayline-api`, `bayline-web`) or one shared project. You only need the DSN.
- A production OTP provider. **Blocker:** `OTP_PROVIDER=msg91|twilio` is declared but not implemented yet (`parking-app/api/src/providers.ts`, SPEC open question #5). The API refuses to start in production with `console`, so production can't go live until MSG91 is wired in (about 3 h).

## What's in this folder

| File | Purpose |
|---|---|
| `docker-compose.yml` | The Coolify stack: `postgres` (PostGIS 16-3.5, named volume `pgdata`), a one-shot `migrate` job, `api`, `web`, and `backup`. |
| `docker-compose.local.yml` | **Local gate only.** Loopback ports, a fake S3 (`rclone serve s3`) and an optional CA build secret. Never added to Coolify. |
| `env/staging.example`, `env/production.example` | Every variable each environment needs, with no values. Paste them into Coolify and fill the secrets there. |
| `env/local.example` | Throwaway values for the local gate. These are not secrets. |
| `backup/Dockerfile`, `backup/backup.sh` | Nightly `pg_dump` to S3, 14-day retention, `restore`, and a restore-verify into a scratch database. |
| `../../parking-app/api/Dockerfile`, `../../parking-app/web/Dockerfile` | Multi-stage, non-root (`node` user) images with pinned bases and a `HEALTHCHECK`. |

Boot order: `postgres` healthy → `migrate` exits 0 → `api` healthy (`/health`) → `web` starts. If a migration fails, the API never starts on a half-migrated schema.

## Memory budget (16 GB VPS)

Hard limits come from `deploy.resources.limits` and are set per environment through env.

| Service | Production | Staging | Notes |
|---|---|---|---|
| postgres | 1536 MB | 768 MB | `shared_buffers` 384 MB / 128 MB, `max_connections` 60 |
| api | 512 MB | 384 MB | Fastify; measured 46 MB idle |
| web | 512 MB | 384 MB | Next.js standalone; measured 40 MB idle |
| backup | 256 MB | 256 MB | Measured 6 MB asleep; peaks during `pg_dump` |
| migrate | 256 MB | 256 MB | Runs for seconds on each deploy, then exits |
| **Steady-state ceiling** | **2.8 GB** | **1.8 GB** | migrate excluded |

Both apps together come to **4.6 GB** at their ceilings. The rest of the box is roughly Coolify + Traefik (≈1 GB), n8n (≈1–1.5 GB), the OS and page cache (≈2 GB), leaving **≈7 GB** for other client apps. Real usage sits well under the limits; the limits stop one runaway container from taking the others down. If the box gets tight, stop staging when it isn't in use. That frees 1.8 GB.

## Deploy on Coolify (after the go)

Do staging first, run the checks below on it, then repeat for production.

1. **Project.** Coolify → Projects → New → `Bayline`. Create two environments: `staging` and `production`.
2. **Resource.** In `staging` → New Resource → *Public/Private Repository (GitHub App)* → `marvice-2019/marvice---calude`, branch `main` (or the release branch), Build Pack **Docker Compose**, Base Directory `/`, Docker Compose Location `/deploy/parking-app/docker-compose.yml`.
3. **Environment variables.** Open *Environment Variables* → *Developer view*, paste `env/staging.example`, then fill the values:
   - `POSTGRES_PASSWORD`, `JWT_SECRET`, `INTERNAL_TOKEN`: generate each with `openssl rand -hex 32`. Tick **Is Secret** (and **Is Build Time** off).
   - Razorpay keys and webhook secret, the S3 keys, and `SENTRY_DSN`: tick **Is Secret**.
   - Production gets its own freshly generated values. Never reuse staging secrets.
4. **Domains.** In the services list set the domain on `web` to `https://staging.bayline.<domain>:3001` and on `api` to `https://api.staging.bayline.<domain>:3000` (the `:port` tells Traefik which internal port to use; it is not exposed). Set `WEB_ORIGIN` to the web URL; the API uses it for CORS.
5. **Deploy.** The first build takes about 6–8 minutes. Watch `migrate` log `Applied: 001_init.sql, …, 004_ops.sql` (or `Nothing to apply` on redeploys) and exit 0, then `api` and `web` turn healthy.
6. **If the stack shows "degraded"** because `migrate` has exited: in the compose editor add `exclude_from_hc: true` under `migrate`. This is a Coolify-only key; plain Docker Compose rejects it, so it is not in git.
7. **Razorpay webhook.** Razorpay Dashboard → Webhooks → `https://api.<domain>/v1/webhooks/razorpay`, events `payment.captured`, `payment.failed`, `transfer.processed`, `transfer.failed`; the secret is the same as `RAZORPAY_WEBHOOK_SECRET`.
8. **Production.** Repeat steps 2–7 in the `production` environment with `env/production.example`, the live Razorpay keys, `S3_PREFIX=production` and the real OTP provider. The API will refuse to boot if anything is still set to test.

### Rollback

Coolify → the app → *Deployments* → choose the previous successful deployment → **Redeploy**. Migrations are forward-only, so a rollback that crosses a migration also needs a DB restore (below). Take a manual backup first: `backup.sh backup`.

## Backups

- **Schedule:** daily at `BACKUP_AT_UTC` (default `21:00` UTC = 02:30 IST, the lowest-traffic hour).
- **Format:** `pg_dump -Fc --compress=9`, checked with `pg_restore --list` before upload, then compared for size after upload.
- **Path:** `s3://$S3_BUCKET/$S3_PREFIX/bayline-YYYYMMDDTHHMMSSZ.dump`.
- **Retention:** dumps older than `BACKUP_RETENTION_DAYS` (14) are deleted after each successful run. Also add an R2 lifecycle rule ("delete after 15 days" on the prefix) as a second safeguard if the container ever stops.
- **Health:** the `backup` container goes **unhealthy** if no backup has succeeded for 26 h. Coolify shows it red, and the uptime check below catches it.

Run these in Coolify → the app → `backup` service → *Terminal*:

```sh
backup.sh backup                      # take a backup now
backup.sh list                        # what's in the bucket
backup.sh verify latest               # restore the newest dump into a scratch DB, compare row counts, drop it
backup.sh restore latest "$DATABASE_URL"            # DESTRUCTIVE: restore over the live DB
backup.sh restore bayline-20261011T210000Z.dump "postgres://bayline:...@postgres:5432/bayline_copy"
```

Before restoring over the live DB, stop `api` and `web` in Coolify so nothing writes during the restore, then start them again. `verify latest` is safe to run at any time. Do it monthly; a backup that hasn't been restored isn't a backup.

**RPO 24 h / RTO about 15 min** at today's data size. If an hour of lost bookings becomes unacceptable, the next step is WAL archiving (pgBackRest) at about ₹0 extra cost and 4 h of setup.

## Monitoring

- **Uptime:** add two HTTP monitors (Uptime Kuma on the same Coolify, or BetterStack free tier). Use a 1-minute interval and alert after 2 failures, to WhatsApp or email:
  - `https://api.<domain>/health`: returns `200 {"ok":true}` only when Postgres answers.
  - `https://<domain>/robots.txt`: proves Next.js is serving.
- **Errors:** set `SENTRY_DSN` and both api and web report automatically. Only 5xx errors are sent; validation 4xx errors are not. `sendDefaultPii` is off, so phone numbers and IPs don't leave the box. Sentry's free tier covers 5k errors a month.
- **Logs:** api logs are pino JSON on stdout; Coolify keeps container logs. Cap them in Coolify → Server → Settings → *Docker log rotation*: `max-size 10m`, `max-file 5` per container (about 50 MB each). Keep **30 days** of anything you need for disputes by shipping the logs (later: Loki or Better Stack). Payment and audit trails already live in Postgres (`payments`, `audit_log`), so they don't depend on log retention.
- **Postgres:** slow queries over 500 ms are logged (`log_min_duration_statement=500`).

## Paste-ready Claude Code prompt (for the server)

Run this in a Claude Code session on the VPS **only after the go**:

```text
You are on the Marvice Coolify VPS. Goal: deploy Bayline STAGING from marvice-2019/marvice---calude,
compose file deploy/parking-app/docker-compose.yml, using the Coolify UI/API, not raw docker run.
Rules: never print or commit secret values; never touch DNS; never modify other Coolify apps or n8n;
ask before anything destructive. Steps:
1. Check free RAM/disk (free -h, df -h). Stop if available RAM < 3 GB or disk < 15 GB; report numbers.
2. Confirm the Coolify project "Bayline" / environment "staging" exists; create it if not.
3. Create the Docker Compose resource as described in deploy/parking-app/README.md "Deploy on Coolify" steps 2-5.
   Read variable names from deploy/parking-app/env/staging.example; generate POSTGRES_PASSWORD, JWT_SECRET,
   INTERNAL_TOKEN with `openssl rand -hex 32` and store them as Coolify secrets. Ask me for Razorpay test keys,
   S3 keys and SENTRY_DSN — do not invent them.
4. Deploy. Wait until migrate exited 0 and api/web are healthy. Show the migrate log tail.
5. Verify: GET https://api.staging.bayline.<domain>/health → 200; GET /v1/lots/search?lat=12.9716&lng=77.5946&from=<ISO now+1h>&to=<ISO now+3h>&vehicle=car → JSON with lots.
6. In the backup service terminal run: backup.sh backup && backup.sh verify latest. Show the output.
7. Report: container memory (docker stats --no-stream for bayline-*), URLs, anything that failed. Then stop.
```

## Local gate (what was run before this commit)

```sh
cd deploy/parking-app
export BUILD_CA_FILE=/path/to/proxy-ca.crt   # only behind a TLS-inspecting proxy; otherwise omit
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file env/local.example build
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file env/local.example up -d
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file env/local.example ps
# API on http://127.0.0.1:13000, web on http://127.0.0.1:13001
docker compose ... exec backup rclone mkdir s3:bayline-backups   # the fake S3 starts empty; in R2 you create the bucket once
docker compose ... exec backup backup.sh backup
docker compose ... exec backup backup.sh verify latest
docker compose ... exec backup backup.sh restore latest postgres://bayline:local-gate-only@postgres:5432/bayline
docker compose ... down -v      # throw it all away
```

## Flags

- **Base image age:** `postgis/postgis:16-3.5` is built on Debian 11 (bullseye), which is past its LTS end, and its apt archives have moved. That's why the backup image fetches rclone in a separate stage rather than through apt. Plan a move to a Debian 12 PostGIS tag (or `postgres:16-bookworm` plus the PostGIS package) before launch, and re-run `backup.sh verify latest` after the switch.
- **CA (tax), unchanged from stage 7:** marketplace vs principal treatment of parking supply, TDS s.194-O at 0.1%, GST TCS at 0.5% for GSTIN holders, 18% GST on commission. These are settings (`TDS_BPS`, `TCS_BPS`, `COMMISSION_GST_BPS`), so a CA's answer is an env change, not a code change.
- **Data:** the database holds phone numbers and vehicle plates (personal data under the DPDP Act). Backups in R2 are encrypted at rest by Cloudflare; the bucket token must be scoped to this bucket only. Don't point staging at a copy of production data.
