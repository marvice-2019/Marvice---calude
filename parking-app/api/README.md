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
| `PLATFORM_FEE_PAISE` / `COMMISSION_BPS` | no | 1500 paise / 1500 bps. Payouts use each operator's own `commission_bps`; `COMMISSION_BPS` is the onboarding default |
| `TDS_BPS` / `TCS_BPS` / `COMMISSION_GST_BPS` | no | 10 (0.1%, s.194-O from 1 Oct 2024) / 50 (0.5% GST TCS, s.52, Notification 15/2024-CT) / 1800. **Confirm all three with a CA** |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_SCALE` | no | global per-IP limit per minute / multiplier for per-route limits (keep 1 in production) |

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
| OPS-03 | ops-admin › OPS-03 rate cards |
| OPS-04 | ops-admin › OPS-04 lot status |
| OPS-05 | ops-admin › OPS-05 dashboard and payouts |
| ADM-01, ADM-02, ADM-03 | ops-admin › ADM-01..03 platform admin |
| OWN-01 | auth-public › owner lead |
| DRV-14 | valet › DRV-14 mark my spot |
| DRV-15, DRV-16 | valet › destinations, filters, digits |
| VAL-01 | valet › VAL-01 drop off |
| VAL-02, VAL-03, VAL-04, VAL-05 | valet › request, validate, tip, status, collect |
| VAL-06 | valet › VAL-06 damage report |
| VAL-07 | valet › staff queue security and validations |
| ACC-01, ACC-02 | valet › preferences, data export |
| Security | bookings › webhook security and replay; drivers only touch their own bookings; ops-admin › other operator's staff |

## Decisions and deviations

- **Photo storage is a stand-in.** `/v1/uploads` returns a dev placeholder URL; production refuses until SPEC open question #12 (bucket and retention) is decided.
- **Valet tip and GST:** tips are charged with the request but excluded from the GST invoice, and a validated tip-only payment raises no invoice. This is pending the CA's answer (SPEC open question #9).

- **GST is exact to the paise** (for example ₹159.30, not ₹159), as invoices need. The clickable prototype rounds GST to the rupee for display; the web stage uses this API's numbers.
- **Migrations use a 50-line runner** (`src/migrate.ts`, ordered `.sql` files, advisory lock) instead of node-pg-migrate. `001_init.sql` is `../schema.sql` unchanged.
- **Requests are validated with zod; responses are typed but not validated at runtime.** Add response schemas when the web stage generates its client.
- **Razorpay orders are created inside the database transaction.** A slow gateway call holds the lot lock for that time. Acceptable at MVP volumes; move it to an outbox if checkout p95 suffers.
- **A captured payment for an expired hold is still confirmed.** Re-checking capacity at capture, with an auto-refund if the lot is full, is a follow-up.
- **There is no `.env.example`.** Two safety hooks in this session block writing any `.env*` file, so the table above is the reference.

## Operations (stage 7)

Migration `004_ops.sql` adds `payments.captured_at`, full payout deduction lines (commission GST, TDS, TCS), the Route transfer lifecycle (`pending → processing → paid | failed`) and audit-log indexes. Load demo console logins with `seed/dev.sql`: platform admin `9000000100`, operator admin `9000000101` and gate staff `9000000102` (dev OTP is printed in the API log).

| Endpoint | Role | Purpose |
|---|---|---|
| `GET /v1/ops/lots` | staff, operator admin, platform admin | Lots I work at, with parked now and expected today |
| `GET /v1/ops/lots/:id/arrivals?date=` | staff, operator admin | Today's expected arrivals (IST) and who is parked |
| `GET /v1/ops/lots/:id/rates` | staff (read), operator admin | Current and scheduled rate cards |
| `GET /v1/ops/monthly-passes?status=` | operator admin | Monthly requests across my lots (driver phone masked) |
| `GET /v1/ops/dashboard` | operator admin | Hourly arrivals and occupancy (≤31 days) and the money split |
| `GET /v1/ops/payouts[?format=csv]` | operator admin | Weekly payouts with every deduction line |
| `GET /v1/admin/operators`, `PUT /v1/admin/operators/:id/payout-account` | platform admin | KYC list; Razorpay Route linked account id (bank details stay at Razorpay) |
| `POST /v1/admin/payouts/run`, `GET /v1/admin/payouts` | platform admin | Weekly run (Monday start, idempotent) and ledger |
| `POST /v1/admin/payouts/:id/transfer` | platform admin | Route transfer, once; `transfer.processed` / `transfer.failed` webhooks settle it |
| `GET /v1/admin/bookings/:code`, `GET /v1/admin/promos`, `GET /v1/admin/audit` | platform admin | Refund lookup, promo list, audit log (paged) |

**Payout formula** (per operator, IST week Monday–Sunday, from payments captured that week):
gross = parking value (booking base before platform-funded promos, extensions, overstays, monthly fees, valet fees; excludes GST, the platform fee and tips; excludes cancelled bookings and fully refunded payments). net = gross − commission − 18% GST on commission − 0.1% TDS − 0.5% TCS (TCS only for GST-registered operators). Each line is rounded half-up to the paise. `test/payouts-ops.test.ts` checks one week by hand: ₹200 gross → ₹30 + ₹5.40 + ₹0.20 + ₹1.00 → ₹163.40 net.

**For the CA** (do not go live on payouts before this):
1. Who is the supplier of parking for GST: the operator (marketplace; TCS applies and the operator pays GST on parking) or Bayline (principal; no TCS, and our current single GST invoice is right). The code supports the marketplace model; the invoice model is principal-style. These must agree.
2. TDS 194-O at 0.1% on the gross amount of sales; check the threshold exemption for individual/HUF operators (₹5 lakh with PAN), the 5% no-PAN rate, and the section number under the Income-tax Act 2025 from 1 April 2026.
3. GST TCS at 0.5% on net taxable value; whether unregistered operators may supply through us at all.
4. GST on commission at 18% (SAC 9985), and whether partial goodwill refunds should reduce the operator's gross.
5. Razorpay Route `POST /v1/transfers` request shape: verify in Razorpay test mode before the first live transfer.

