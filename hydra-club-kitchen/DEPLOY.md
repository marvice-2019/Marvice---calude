# Deploying Hydra Club & Kitchen to hydraclubkitchen.com

Target: the Marvice Coolify VPS (Coolify v4, Traefik, Let's Encrypt). Postgres 16 runs as a Coolify database
on the same VPS. DNS stays at Hostinger. Email (Google Workspace) is not touched.

**Why not Hostinger hosting:** the domain currently points to a WordPress site on Hostinger's "Cloud Startup"
shared plan (`u687080461`, plan set to not renew, ends 2027-02-20). That plan has MySQL only; this app needs
Postgres 16 with `btree_gist` (the no-double-booking guarantee lives in the database). So the app runs on the
Coolify VPS and only DNS moves.

## Current DNS (read from Hostinger API, 2026-11-08)

| Type | Name | Value | Action at cutover |
|---|---|---|---|
| ALIAS | `@` | `hydraclubkitchen.com.cdn.hstgr.net` (WordPress) | **Replace** with `A @ <VPS_IP>` |
| CNAME | `www` | `www.hydraclubkitchen.com.cdn.hstgr.net` | **Replace** with `CNAME www hydraclubkitchen.com.` |
| MX | `@` | `1 SMTP.GOOGLE.COM` | Keep (email) |
| TXT | `@` | `google-site-verification=…` | Keep |
| CNAME | `e2cplgwdzb5h` | `gv-…dv.googlehosted.com` | Keep (Google verification) |
| A | `ftp` | `147.79.65.193` | Keep (old hosting FTP) |
| — | `tanvara` | served by Hostinger internally (separate WordPress site) | Keep; check after cutover |

`<VPS_IP>` is the Coolify server's public IP (Coolify → Servers → your server). Use the server's own IP, not
Cloudflare's: `coolify.marvice.tech` is behind Cloudflare, the app domain is not.

## 1. Database (Coolify)

1. Project **Hydra Club & Kitchen**, environment **production**.
2. **+ New → Database → PostgreSQL**, image `postgres:16-alpine`, name `hydra-db`. Do not make it public.
3. Copy the **Postgres URL (internal)**. It becomes `DATABASE_URL`. The Coolify database user owns the
   database, so migrations can `CREATE EXTENSION btree_gist`.
4. **Backups tab:** add S3-compatible storage (Coolify → Storages; Cloudflare R2 free tier is enough: the
   database is ~10 MB today). Schedule `30 21 * * *` (03:00 IST), keep 30 backups.

## 2. Application (Coolify)

**+ New → Application → GitHub App (or public repo)**

| Setting | Value |
|---|---|
| Repository / branch | `marvice-2019/Marvice---calude`, the branch merged for release |
| Base directory | `/hydra-club-kitchen` |
| Build pack | Dockerfile (`Dockerfile`) |
| Port | `3000` |
| Domains | `https://hydraclubkitchen.com,https://www.hydraclubkitchen.com` |
| Redirect | www → non-www (Coolify: "Redirect to non-www") |
| Health check | Uses the image's `HEALTHCHECK` (`GET /api/health`, 200 when Postgres answers) |
| Persistent storage | Volume `hydra-uploads` mounted at `/app/uploads` (venue photos; back it up) |
| Auto deploy | On (push to the release branch redeploys) |

**Environment variables** (mark `NEXT_PUBLIC_SITE_URL` as a *Build Variable*, it is baked into the bundle):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://hydraclubkitchen.com` (build **and** runtime) |
| `DATABASE_URL` | internal URL from step 1 |
| `AUTH_SECRET` | `openssl rand -base64 33` |
| `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` | first deploy only (12+ chars), then delete both and redeploy |
| `UPLOAD_DIR` | `/app/uploads` (already the image default) |
| `N8N_BOOKING_WEBHOOK_URL` / `N8N_WEBHOOK_SECRET` | from `n8n/README.md`; empty = no notifications |
| `TURNSTILE_SECRET_KEY` | optional, only if captcha is switched on in admin |
| `GA4_ID`, `META_PIXEL_ID`, `META_CAPI_TOKEN` | optional; load only after visitor consent |

On every start the container runs migrations, then the idempotent seed (never overwrites admin edits), then the
server. A failed migration stops the new container, so Coolify keeps the old one serving.

**Scheduled task** (application → Scheduled Tasks): `node scripts/retention.mjs`, cron `30 20 * * *`
(02:00 IST). Deletes bookings older than 12 months and day-old rate-limit rows, as the privacy policy promises.

**Importing photos** (once Hydra sends originals): copy them into the uploads volume, then in the app's
terminal: `node scripts/import-photos.mjs /app/uploads/incoming`. Or upload in admin → Photos.

## 3. Rehearse before touching DNS

Deploy first with a temporary domain, e.g. `https://hydra.<vps-ip>.sslip.io` (Coolify can generate one).
Because `NEXT_PUBLIC_SITE_URL` is baked in, set it to that temporary URL for the rehearsal build, and back to
`https://hydraclubkitchen.com` before the cutover build.

Check on the temporary URL:
- `/api/health` → `{"ok":true,"db":"up"}`
- Home, `/book`, `/menu`, `/gallery` load; a test booking gets a `HYD-` reference; it shows in admin → Today.
- Sign in with the seed owner, change the password, then remove `ADMIN_SEED_*`.
- Send one booking through n8n and confirm the WhatsApp/email notification.

## 4. Cutover (about 10 minutes, WordPress stays intact as the fallback)

1. Coolify: set `NEXT_PUBLIC_SITE_URL=https://hydraclubkitchen.com`, domains as in step 2, redeploy.
2. Hostinger hPanel → Domains → hydraclubkitchen.com → DNS (both records already have TTL 300):
   - delete `ALIAS @`, add `A @ <VPS_IP>` TTL 300
   - change `CNAME www` to `hydraclubkitchen.com.` TTL 300
3. Wait for `dig +short hydraclubkitchen.com` to return `<VPS_IP>`; Coolify issues the Let's Encrypt
   certificate on the first request (retry "Restart proxy" if it shows the default cert after 5 minutes).
4. Verify: `curl -s https://hydraclubkitchen.com/api/health`, a test booking, admin sign-in,
   `https://www.hydraclubkitchen.com` redirects to the apex, and email still arrives (MX untouched).
5. Check `https://tanvara.hydraclubkitchen.com` still loads. If it stops resolving, add
   `CNAME tanvara tanvara.hydraclubkitchen.com.cdn.hstgr.net.`
6. Google Search Console: submit `https://hydraclubkitchen.com/sitemap.xml`. Old WordPress URLs return 404;
   add redirects only for pages that had real traffic (check Search Console → Pages first).

**Rollback:** put back `ALIAS @ hydraclubkitchen.com.cdn.hstgr.net` and
`CNAME www www.hydraclubkitchen.com.cdn.hstgr.net`. With TTL 300 the WordPress site is back within ~5 minutes.
Bookings taken in the meantime stay in Postgres.

## 5. Backups and restore test

- **Database:** Coolify scheduled backup (step 1). Restore test once after go-live and then quarterly:
  create a scratch Postgres in Coolify, restore the latest dump
  (`pg_restore -d <scratch-url> --no-owner backup.dump`), run
  `select count(*) from bookings; select count(*) from users;`, then delete the scratch database.
- **Photos:** the `hydra-uploads` volume. Coolify volume backup or a weekly
  `tar czf` of `/app/uploads` copied to the same S3 bucket.
- **Secrets:** `AUTH_SECRET` and the n8n secret live only in Coolify; keep a copy in the agency password manager.

## Running it locally like production

```bash
cp .env.example .env   # fill AUTH_SECRET, POSTGRES_PASSWORD, ADMIN_SEED_*
docker compose up --build
open http://localhost:3000
```

Verified 2026-11-08: the image (454 MB, runs as uid 1001) built and started against an empty Postgres 16,
migrated, seeded, created the owner, served every page, passed its health check, returned 503 with the
database stopped and recovered when it came back, processed a photo with sharp, ran retention, and passed the
content and motion browser suites against the container.
