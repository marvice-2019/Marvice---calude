# Hourhand backend

Status as of 2026-10-11. The backend is built in rounds. Each round lands with tests against a real Postgres 16 database, not just the in-memory store.

| Round | Scope | Status |
| --- | --- | --- |
| B1 | Postgres data layer: migrations, `PgStore` behind `DataStore`, seed, second-host isolation tests | in progress |
| B2 | Better Auth: email magic link, Google sign-in, httpOnly sessions, sign out everywhere, account deletion | not started |
| B3 | Email (Resend) and pg-boss jobs: confirmation and reminder emails, retries, dead-letter log | not started |
| B4 | Google Calendar: free/busy, writing booked events, push channels and incremental sync, sync health | not started |
| B5 | Payments in test mode: Razorpay (INR) and Stripe (USD), Checkout and portal, signed and deduplicated webhooks | not started |
| later | Microsoft Graph, iCloud CalDAV, WhatsApp Cloud API, DLT SMS, Zoom | not started |

## Decisions

- **Plain SQL through `pg`, not Drizzle.** `replica/schema.sql` is already tested on Postgres 16, and the TypeScript types already exist in `src/lib/data/types.ts`. An ORM would mean keeping a second copy of the schema in sync. Migrations are numbered `.sql` files applied by `scripts/migrate.ts` and tracked in `schema_migrations`.
- **Store selection is explicit.** `HOURHAND_DATA=memory|postgres`. If `postgres` is chosen without `DATABASE_URL`, the app refuses to start. It never falls back silently to memory.
- **Double booking is impossible at the database.** The `no_double_booking` exclusion constraint is the guard. The app maps its violation to "slot taken" with the next free slots.

## Things only you can do (start the slow ones this week)

| Task | Lead time | Needed for |
| --- | --- | --- |
| Create a Google Cloud project with an OAuth client (web), redirect URI `https://<domain>/api/auth/callback/google`, plus `http://localhost:3000/...` for dev | 30 min | B2 |
| Enable the Google Calendar API and **submit OAuth verification** for the `calendar.events` and `calendar.freebusy` scopes. Until it is approved, the app is limited to 100 test users | **2–6 weeks** | B4, public launch |
| Resend account, domain `mail.<domain>` with SPF, DKIM, DMARC `p=none` | 1 day for DNS | B3 |
| Razorpay account (test mode keys) and KYC for live | KYC takes days | B5 |
| Stripe account (test mode keys) | 30 min | B5 |
| Meta WhatsApp Business account; submit utility templates for confirmation and reminder | 1–7 days per template | later |
| DLT registration of the entity, sender ID and SMS templates (for example via MSG91) | **days to weeks** | later |
| Trademark search for "Hourhand" before buying the domain | 1 day | launch |
| Coolify: a Postgres 16 service with daily backups to S3-compatible storage, and a monthly restore test | 1 hour | deploy |

Claude never creates these accounts or types keys. Put the values in `hourhand/.env.local` on your machine and in Coolify's environment settings.

## Environment variables

`hourhand/.env.example` should contain exactly these names with no values. A hook in this environment blocks Claude from writing `.env*` files, so create it yourself from this list:

```
HOURHAND_DATA=
DATABASE_URL=
TEST_DATABASE_URL=
APP_URL=
BETTER_AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TOKEN_ENCRYPTION_KEY=
RESEND_API_KEY=
EMAIL_FROM=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
TURNSTILE_SECRET_KEY=
```

Rounds after B1 add their variables here as they land.

## Security checklist

- [ ] secrets only in env vars, `.env*` in `.gitignore`, nothing in client bundles
- [ ] input validated on the server on every route (booking and manage routes: done in the fake-data rounds; host actions: done)
- [ ] authorisation checked on every read and write, tested with a second user (B1 tests the data layer; B2 wires the session in)
- [ ] rate limits on auth, sign up, and anything that sends email or SMS
- [ ] webhooks verify signatures and dedupe on `webhook_events`
- [ ] uploads: size and type limits, served from a separate bucket or domain (avatars only)
- [ ] no user data in URLs or logs (manage links use an opaque token, not an email)
- [ ] dependencies audited: `npm audit --omit=dev` is clean; 5 dev-only advisories via `eslint-config-next`, with no non-breaking fix
- [ ] privacy policy lists every processor (host, Resend, Razorpay, Stripe, Google, Meta)
