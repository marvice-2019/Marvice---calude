# Bayline API

Fastify 5 + TypeScript + PostgreSQL 16 / PostGIS. Implements `../SPEC.md` §5 (API contract) and §6 (business rules). Money is in paise, with integer math throughout.

## Run locally

```bash
cd parking-app/api
npm ci
export DATABASE_URL=...           # Postgres 16 with PostGIS available
export JWT_SECRET=$(openssl rand -base64 48) RAZORPAY_WEBHOOK_SECRET=dev-secret INTERNAL_TOKEN=$(openssl rand -hex 16)
npm run build && npm run migrate  # applies migrations/*.sql once each
npm start                         # http://localhost:3000/health
```

With `RAZORPAY_KEY_ID` unset, the API uses a built-in fake gateway. Production refuses to start without real Razorpay keys, and refuses `OTP_PROVIDER=console`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection URL |
| `JWT_SECRET` | yes | 32+ characters |
| `RAZORPAY_WEBHOOK_SECRET` | yes | from the Razorpay dashboard webhook settings |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | prod | empty in dev = fake gateway |
| `INTERNAL_TOKEN` | yes | 16+ chars; n8n cron sends it as `x-internal-token` to `/v1/internal/jobs/*` |
| `WEB_ORIGIN` | no | the only CORS origin allowed; also the base for payment links |
| `OTP_PROVIDER` | no | `console` (dev only), `msg91` or `twilio`. Neither real provider is implemented yet (SPEC open question #5) |
| `N8N_NOTIFY_URL` | no | n8n webhook that sends WhatsApp, SMS and push messages |
| `PLATFORM_FEE_PAISE` / `COMMISSION_BPS` / `TDS_BPS` | no | 1500 / 1500 / 100; confirm TDS with a CA |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_SCALE` | no | global per-IP limit per minute / multiplier for per-route limits (keep 1 in production) |

## Sample data

`seed/dev-seed.sql` loads 8 sample Bengaluru lots (codes BLR101–BLR108, the prototype's prices) and the FIRST50 and WEEKEND20 promos. It can be re-run safely. It is for development and the web e2e suite; never load it into production.

```bash
psql "$DATABASE_URL" -f seed/dev-seed.sql
```

## Tests

They need a Postgres 16 + PostGIS server; set `TEST_PG_URL` to its admin database (default `postgres://postgres@127.0.0.1:54329/postgres`). The global setup builds a migrated template database, and each test file gets its own copy.

```bash
npm run build && npm test
```

### Story coverage

| Story | Test (file › describe) |
|---|---|
| DRV-01 | auth-public › DRV-01 search |
| DRV-02 | auth-public › DRV-02 lot detail; pricing › quote |
| DRV-03 | auth-public › DRV-03 sign in with OTP |
| DRV-04 | bookings › DRV-04 pre-book and pay |
| DRV-05 | bookings › DRV-05 lot full and the race test |
| DRV-06 | auth-public › DRV-06 promo quote; bookings › DRV-06 promo at booking; pricing |
| DRV-07 | me-monthly › DRV-07 saved profile |
| DRV-08 | me-monthly › DRV-08 favourites |
| DRV-09 | auth-public › DRV-09 lot code lookup; bookings › DRV-09 Park now |
| DRV-10, GST-01, GST-02 | bookings › passes belong to the phone number |
| DRV-11 | bookings › DRV-11 extend |
| DRV-12 | bookings › DRV-12 cancel |
| DRV-13, OPS-01, OPS-02 | ops-admin › check in / check out with overstay |
| MON-01, MON-02, MON-03 | me-monthly › MON-01..03 monthly passes |
| MON-01 (S06 lot list) | auth-public › MON-01 monthly lots (S06) |
| OPS-03 | ops-admin › OPS-03 rate cards |
| OPS-04 | ops-admin › OPS-04 lot status |
| OPS-05 | ops-admin › OPS-05 dashboard and payouts |
| ADM-01, ADM-02, ADM-03 | ops-admin › ADM-01..03 platform admin |
| OWN-01 | auth-public › owner lead |
| Security | bookings › webhook security and replay; drivers only touch their own bookings; ops-admin › other operator's staff |

## Decisions and deviations

- **GST is exact to the paise** (for example ₹159.30, not ₹159), as invoices need. The clickable prototype rounds GST to the rupee for display; the web stage uses this API's numbers.
- **Migrations use a 50-line runner** (`src/migrate.ts`, ordered `.sql` files, advisory lock) instead of node-pg-migrate. `001_init.sql` is `../schema.sql` unchanged.
- **Requests are validated with zod; responses are typed but not validated at runtime.** Add response schemas when the web stage generates its client.
- **Razorpay orders are created inside the database transaction.** A slow gateway call holds the lot lock for that time. Acceptable at MVP volumes; move it to an outbox if checkout p95 suffers.
- **A captured payment for an expired hold is still confirmed.** Re-checking capacity at capture, with an auto-refund if the lot is full, is a follow-up.
- **There is no `.env.example`.** Two safety hooks in this session block writing any `.env*` file, so the table above is the reference.
