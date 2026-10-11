# Deploy: Hourhand at https://hourhand.cloud

Host: your Coolify server (single 16GB VPS). Claude prepared the repo; you do the Coolify, DNS and account steps, and nothing goes live until you say go.

## Verdict

The repo is ready to deploy as a **public beta**. Five must-have features are still missing (below), and Google limits sign-in to 100 test users until its verification is approved (2–6 weeks), so launch quietly to your first coaches rather than with ads.

## 1. Preflight (2026-10-11)

| Check | Result |
| --- | --- |
| Unit and Postgres tests | **335 of 335 pass** (`TEST_DATABASE_URL` set, Postgres 16) |
| Production build with no env vars (as Docker builds it) | **passes** |
| Container start command, production mode, fresh database | migrations 0001–0007 applied; `/api/health` 200, `/icon.svg` 200, `/opengraph-image` 200, `/sign-in` 200; job runner started. Second start: "Nothing to apply" |
| Missing required env var | server refuses to start with a named error (e.g. `RESEND_API_KEY is not set`), so the healthcheck fails and Coolify keeps the previous version live |
| Brand sweep (`sweep.py hourhand --config replica/brand.json`) | **Clean** |
| Parity (`parity.py replica/features.csv`) | **70.1 / 100, must-haves 17 of 22** (was 42.0 because the list hadn't been updated since B2; every row changed was checked against the code) |
| Privacy policy and terms | `/privacy` and `/terms`, working drafts under Indian law: **have a lawyer review before public launch** |
| Public home page | `/` shows the landing page to visitors (needed for Google verification); signed-in hosts go to the dashboard |
| Cookie banner | not needed: only the sign-in session cookie, no analytics or ad cookies |
| Account deletion | Dashboard → Settings → Delete your account; recoverable 30 days, then purged hourly |
| Favicon, title, share image | yours (`src/app/icon.svg`, `src/app/opengraph-image.tsx`) |
| Real Docker build | **not run here** (no Docker daemon in this sandbox); the first Coolify build is the real test. The steps it runs were each run above |

**Still missing (must-haves):** Outlook calendar and Microsoft sign-in (B6, next), text/WhatsApp reminders (B9), add-guests on the booking form, an add-to-calendar button on the confirmation page (the confirmation email already carries the calendar file).

**Not yet tried against the real services:** Resend sending, Google Calendar freeBusy and push, Razorpay Checkout in a browser. The first live booking is that test.

## 2. Production services (you)

| Service | Step |
| --- | --- |
| Postgres | Coolify → New resource → PostgreSQL 16, separate from anything dev. Turn on scheduled backups (daily, to S3-compatible storage such as Cloudflare R2 or Backblaze B2) and do one restore test a month. Copy its **internal** connection URL for `DATABASE_URL` |
| Resend | Add domain `hourhand.cloud`, add the SPF, DKIM and DMARC records it shows (section 4), wait for "Verified" |
| Google Cloud | Redirect URIs, authorised domain and scopes from `replica/backend.md` → "Production addresses for hourhand.cloud". Then submit verification: home page `https://hourhand.cloud`, privacy `https://hourhand.cloud/privacy`, terms `https://hourhand.cloud/terms` |
| Microsoft Entra | Section 6 |
| Razorpay | Test mode first: webhook `https://hourhand.cloud/api/webhooks/razorpay` (events `subscription.*`), 4 test Plans, one test payment end to end. Then live keys (the live pair shared in chat on 2026-10-11 must be **regenerated** first) |

## 3. Coolify application

1. **New resource → Application → GitHub** (Coolify's GitHub App), repo `marvice-2019/marvice---calude`, branch `main`.
2. **Build pack:** Dockerfile. **Base directory:** `/hourhand`. **Port:** 3000.
3. **Domains:** `https://hourhand.cloud,https://www.hourhand.cloud`, and turn on the redirect to non-www (apex is the canonical address). Coolify issues the certificates.
4. **Healthcheck:** the Dockerfile has one (`/api/health`, which also checks the database). If you set it in Coolify's UI instead, use path `/api/health`, port 3000.
5. **Environment variables** (section 5). Mark all of them "runtime only"; the build needs none.
6. **Deploy.** In the logs you should see `Applied 0001_init … 0007_calendar_push`, then `✓ Ready`, then `[jobs] runner started (Resend, Google Calendar on, booking payments on)`.
7. Turn on **auto deploy** so every merge to `main` ships. Migrations run on each deploy before the server starts; a failing one stops the deploy and the old version stays up.

One container runs the website and the background jobs (emails, calendar sync, payment checks). Run exactly **one** replica; a second one would need `HOURHAND_WORKER=0`. Expect about 300–500 MB of RAM.

## 4. DNS records for hourhand.cloud

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | your Coolify server's public IPv4 |
| A | `www` | the same IP (Coolify redirects it to the apex) |
| TXT / CNAME / MX | as Resend shows | SPF and DKIM for sending as `booking@hourhand.cloud` (copy them exactly from Resend → Domains) |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:yuvarajgs@marvice.in` (tighten to `p=quarantine` after two weeks of clean reports) |

If you want mail sent **to** booking@hourhand.cloud to arrive somewhere, add a mailbox (Zoho or Google Workspace) and its MX records. Sending doesn't need it.

## 5. Environment variables (Coolify → app → Environment)

Generate the two random values on your own machine with `openssl rand -hex 32` (once each). **Keep `TOKEN_ENCRYPTION_KEY` in your password manager and never change it:** every connected calendar and every host's Razorpay key is sealed with it, so a new key disconnects them all.

| Name | Value | Required |
| --- | --- | --- |
| `HOURHAND_DATA` | `postgres` | yes |
| `DATABASE_URL` | the internal URL of the Coolify Postgres | yes |
| `BETTER_AUTH_URL` | `https://hourhand.cloud` | yes |
| `BETTER_AUTH_SECRET` | random (openssl) | yes |
| `TOKEN_ENCRYPTION_KEY` | random (openssl), never changes | yes |
| `RESEND_API_KEY` | from Resend | yes |
| `EMAIL_FROM` | `Hourhand <booking@hourhand.cloud>` | yes |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from Google Cloud | for Google sign-in and calendars |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | from Razorpay (test first) | for paid plans |
| `RAZORPAY_PLAN_SOLO_MONTH`, `_SOLO_YEAR`, `_DUO_MONTH`, `_DUO_YEAR` | the 4 Plan ids | for paid plans |
| `STRIPE_*` | only if you get Stripe (see backend.md) | no |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | from Entra (section 6); used once B6 ships | after B6 |
| `TRUSTED_PROXIES` | leave unset (defaults cover Coolify's Docker network) | no |

Never set `HOURHAND_ALLOW_MEMORY`, `HOURHAND_MAIL_TO_LOG`, `HOURHAND_E2E`, `GOOGLE_API_BASE_URL` or `RAZORPAY_API_BASE_URL` in production; they exist for local testing only.

## 6. Microsoft Entra (for B6: Outlook, Teams links, Sign in with Microsoft)

1. [entra.microsoft.com](https://entra.microsoft.com) → App registrations → New registration. Name `Hourhand`. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
2. Redirect URI, platform **Web**: `https://hourhand.cloud/api/auth/callback/microsoft`. Then Authentication → add `https://hourhand.cloud/api/calendars/microsoft/callback`, plus `http://localhost:3000/...` versions of both for development.
3. API permissions → Microsoft Graph → Delegated: `openid`, `email`, `offline_access`, `User.Read`, `Calendars.ReadWrite`. No admin consent needed for these.
4. Certificates & secrets → New client secret (24 months). Copy the **Value** straight into Coolify as `MICROSOFT_CLIENT_SECRET`. Put a reminder in your calendar a month before it expires.
5. Overview → copy **Application (client) ID** into `MICROSOFT_CLIENT_ID`. Tenant stays `common` (no variable).
6. Branding & properties: home page `https://hourhand.cloud`, privacy `https://hourhand.cloud/privacy`, terms `https://hourhand.cloud/terms`. Later, verify the publisher (needs a Microsoft Partner ID) so users don't see "unverified" on the consent screen.

Teams links only work for work or school Microsoft 365 accounts; personal Outlook.com accounts get Outlook calendar sync but no Teams link.

**Action needed:** a client secret value was pasted into chat on 2026-10-11. Delete it in Entra and create a new one (step 4).

## 7. Watch it (first week)

| What | How |
| --- | --- |
| Uptime | A monitor (Uptime Kuma on the same Coolify, or UptimeRobot free) on `https://hourhand.cloud/api/health` every minute, alerting your phone, plus one on a real booking page |
| Logs | Coolify → app → Logs. Search for `[jobs]` (email and sync failures) and `Error` |
| Failed emails | `select kind, last_error, count(*) from notifications where status = 'failed' group by 1, 2;` daily for the first week |
| Calendar health | Dashboard → Calendars sync light on your own account |
| Backups | confirm the first nightly Postgres backup landed, then restore it once into a scratch database |
| End to end | you: sign up, connect Google Calendar, create an event type, book it from your phone as a guest, cancel it. Check both emails and the calendar event |

Error tracking (Sentry or GlitchTip) isn't wired in yet; logs and the failed-email query cover the beta.

## 8. Go-live record

| | |
| --- | --- |
| Live URL | https://hourhand.cloud (not live yet: waiting for your go) |
| DNS set | (fill in after you set them) |
| First deploy commit | (fill in) |
