# Hourhand backend

Status as of 2026-10-11. The backend is built in rounds. Each round lands with tests against a real Postgres 16 database, not just the in-memory store.

| Round | Scope | Status |
| --- | --- | --- |
| B1 | Postgres data layer: migrations, `PgStore` behind `DataStore`, seed, second-host isolation tests | **done** (2026-10-11) |
| B2a | Better Auth: email magic link, Google sign-in (switched on by env), httpOnly sessions, sign out everywhere | **done** (2026-10-11) |
| B2b | Ownership checks in the nine data methods without a user id, account deletion, rate limits on sign-in | **done** (2026-10-11) |
| B3 | Email (Resend) and pg-boss jobs: confirmation and reminder emails, retries, dead-letter log | not started |
| B4 | Google Calendar: free/busy, writing booked events, push channels and incremental sync, sync health | not started |
| B5 | Payments in test mode: Razorpay (INR) and Stripe (USD), Checkout and portal, signed and deduplicated webhooks | not started |
| later | Microsoft Graph, iCloud CalDAV, WhatsApp Cloud API, DLT SMS, Zoom | not started |

## Decisions

- **Plain SQL through `pg`, not Drizzle.** `replica/schema.sql` is already tested on Postgres 16, and the TypeScript types already exist in `src/lib/data/types.ts`. An ORM would mean keeping a second copy of the schema in sync. Migrations are numbered `.sql` files applied by `scripts/migrate.ts` and tracked in `schema_migrations`.
- **Store selection is explicit.** `HOURHAND_DATA=memory|postgres`. If `postgres` is chosen without `DATABASE_URL`, the app refuses to start. It never falls back silently to memory.
- **Scripts run on Node 22's built-in TypeScript support** (`node scripts/migrate.ts`), not tsx. Scripts use explicit `.ts` relative imports and `import type`, never `@/` aliases.
- **Rescheduling cancels the old booking, then inserts the new one, in one transaction.** The exclusion constraint is not deferrable, so inserting first would reject moving a booking by less than its own length. If the insert fails, the old booking stays confirmed.
- **Slugs are case-insensitive** in Postgres (`citext`).
- **Double booking is impossible at the database.** The `no_double_booking` exclusion constraint is the guard. The app maps its violation to "slot taken" with the next free slots.

## B1 evidence (2026-10-11, Postgres 16.15)

- 93 tests pass with `TEST_DATABASE_URL` set (83 without; the 10 Postgres tests skip).
- Two simultaneous bookings for one slot: exactly one wins. With the exclusion-violation mapping removed, 3 tests fail.
- A second host sees none of Priya's event types, bookings or schedules. With the user filter removed from one read, the isolation test fails.
- End to end with `HOURHAND_DATA=postgres`: slots 200, book 201, retry 200 same booking, same slot 409, reschedule 201, retry 200, cancel 200, unknown link 404, dashboards 200.

## B2a evidence (2026-10-11, Postgres 16.15, production build)

- 102 tests pass with `TEST_DATABASE_URL` set (92 without). Migration 0002 applies on top of 0001; a second run applies nothing.
- Sign-in end to end, 15 of 15 checks: signed-out dashboard redirects to `/sign-in`; magic link signs Priya in with an `HttpOnly; SameSite=Lax` cookie; she sees her event types and bookings and none of Arun's; a used link fails with `INVALID_TOKEN`; a new email signs up and gets the slug `newhost`; "sign out of all devices" kills an older session; the public booking page and slots API still work signed out.
- Calling a dashboard server action directly with no session is redirected to sign-in and changes nothing. With that action's session check removed, the same call switched Priya's event type off; restored, it is blocked again.
- Better Auth writes its own non-uuid ids into the verification table, so the auth tables' ids are `text` (references to `users` stay `uuid`).

## B2a security review (fresh-context reviewer)

- **Fixed (medium):** sign-in links could be built from a forged Host header if `BETTER_AUTH_URL` was unset. Production now refuses to start without it, and Better Auth only trusts that origin. A test fails when the guard is removed.
- **Fixed (low):** reserved slugs (`dashboard`, `sign-in`, `api` …); magic-link tokens stored hashed (checked: the emailed token appears nowhere in the database); dev outbox capped at 50; every dashboard page checks the session itself; a production server refuses memory mode unless `HOURHAND_ALLOW_MEMORY=1`.
- **Accepted for now:** two first-time sign-ups racing for the same slug — the unique constraint holds and the loser asks for a new link. Magic-link slugs come from the email's local part until onboarding lets hosts choose one.
- After the fixes: 109 tests pass against Postgres, and the 15-check sign-in run passes again.

## B2b evidence (2026-10-11, Postgres 16.15, production build)

- 117 tests pass with `TEST_DATABASE_URL` set (103 without).
- **Ownership:** the nine methods now take the host id and enforce it in the query, in both stores. Tests show a second host can't read Priya's locations or questions, overwrite her questions, cancel or move her booking, or change her hours. With the host filter removed from `cancelBooking`, the test fails.
- **Account deletion:** closing an account turns its links off, cancels upcoming bookings, deletes its sessions and blocks it from signing back in (a session hook). Purge removes it with everything it owns only after 30 days. Removing the session hook let a closed account sign in again (e2e failed); removing the 30-day grace made the purge test fail.
- **Rate limits:** the 6th sign-in link request from one address in 10 minutes gets a 429; other addresses are unaffected; forged addresses to the left of the proxy's entry don't escape the limit. The sign-in page adds 3-per-email and 10-per-address limits of its own, because server actions call Better Auth directly.
- **Found while testing:** Better Auth trusts `x-forwarded-for` only when it holds a single address and otherwise drops requests into one shared bucket, so a visitor could have exhausted sign-in for everyone. It now trusts only our proxy's networks (`TRUSTED_PROXIES`, default private ranges) and reads the address the proxy appended. Not covered by a negative test: without the setting the forged requests are still limited, just in the shared bucket.

## B2b security review (fresh-context reviewer)

- **Fixed (medium):** replaying another host's request key returned that host's booking and manage link, for new bookings and reschedules. A key now only returns the booking it was first used for (same event type, or same rescheduled booking); anything else is a 409 `key_conflict`. Negative test: with the fix set aside, the cross-host replay test fails.
- **Fixed (medium):** the per-email sign-in limit now runs inside the magic-link sender, which both the sign-in page and direct `/api/auth` calls go through. IPv6 addresses are grouped by /64 in our limiter (Better Auth does the same by default). E2E: the 4th link for one inbox is refused even from a 4th address.
- **Fixed (low):** the limiter sweeps expired windows once a minute and never holds more than 50,000 keys.
- **Checked (low):** purging a host who has payments works (they cascade with the host); the purge test now includes a paid booking.
- **Found while fixing:** importing `./types.ts` with an extension in one file made the bundler load the module twice, so `instanceof` on data-layer errors (slot taken, key conflict) silently failed in the API. Reverted; the closing and purge SQL now lives in `src/lib/data/account-lifecycle.ts`, which has no runtime imports, for the scripts. A lint rule now rejects `.ts` import extensions under `src/`.
- **Open (medium, needs production):** check what `x-forwarded-for` looks like behind Coolify's Traefik for IPv6 and (if used) Cloudflare. If IPv6 visitors arrive as a Docker gateway address, the per-address limits would treat them all as one; set `TRUSTED_PROXIES` to the Traefik container's address only.
- **Follow-ups (low):** a booking or a session created in the same instant as an account closes can survive; the dashboard is still blocked, and B3's emails reach those guests.

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
HOURHAND_MAIL_TO_LOG=
HOURHAND_ALLOW_MEMORY=
TRUSTED_PROXIES=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
TURNSTILE_SECRET_KEY=
```

Rounds after B1 add their variables here as they land.

## Security checklist

- [ ] secrets only in env vars, nothing in client bundles. All env files except the example are git-ignored since B1
- [ ] input validated on the server on every route (booking and manage routes: done in the fake-data rounds; host actions: done)
- [x] authorisation checked on every read and write, tested with a second user (B2b closed the nine-method gap). B1: every data method that takes a user id is tested against a second host (Arun) and returns nothing. **Open:** nine methods take no user id (`listEventLocations`, `listCustomQuestions`, `cancelBooking`, `rescheduleBooking`, `saveWeeklyHours`, `saveDateOverride`, `deleteDateOverride`, `blockDateRange`, `saveQuestions`) and rely on the caller's ownership check; B2 adds that check with the session. Calendar list methods filter by user but have no second-host test yet
- [ ] rate limits on auth, sign up, and anything that sends email or SMS (sign-in: done in B2b; booking and slot endpoints, email and SMS sends: still to do)
- [ ] webhooks verify signatures and dedupe on `webhook_events`
- [ ] uploads: size and type limits, served from a separate bucket or domain (avatars only)
- [ ] no user data in URLs or logs (manage links use an opaque token, not an email)
- [ ] dependencies audited: `npm audit --omit=dev` is clean; 5 dev-only advisories via `eslint-config-next`, with no non-breaking fix
- [ ] privacy policy lists every processor (host, Resend, Razorpay, Stripe, Google, Meta)
