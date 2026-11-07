# Hydra Club & Kitchen — website

Next.js 15 + Postgres 16 + Drizzle. Built by Marvice Media Private Limited.

## Status

| Stage | State |
|---|---|
| 1. Data model | Done: schema, migrations, seed, DB tests |
| 2. Auth and roles | Done: staff sign-in, roles, forced first password change, rate limits |
| 3–8 | Not started |

## Database

```bash
pnpm install
cp .env.example .env            # set DATABASE_URL
pnpm db:migrate                 # applies drizzle/*.sql
pnpm db:seed                    # zones, 20 tables, venue settings (idempotent, never overwrites admin edits)
pnpm test                       # needs TEST_DATABASE_URL; resets that database
```

Schema lives in `src/db/schema.ts`. After changing it run `pnpm db:generate --name <change>` and commit the new file in `drizzle/`.

Rules the database itself enforces:

- **No double booking.** `bookings_no_overlap` (btree_gist exclusion, `drizzle/0001_booking_no_overlap.sql`) rejects any pending or confirmed booking that overlaps another on the same table. Ranges are half-open, so back-to-back slots fit. The API maps error `23P01` to "That table was just taken".
- **Service date.** `bookings.service_date` is generated from `starts_at` in Asia/Kolkata with a 05:00 cutoff, so a 12:30 AM booking belongs to the previous night.
- Ref format `HYD-XXXX`, Indian mobile in E.164 (`+91[6-9]XXXXXXXXX`), 1–50 guests, one hero photo per scene, one hold per table or zone per date.

Unconfirmed venue facts (WhatsApp/phone, hours, 5th vs 6th Block, VIP capacity and minimum spend) are seeded empty; see brief §12.

## Staff accounts and roles

Auth.js v5 (credentials, JWT session cookie, 12-hour shifts), argon2id hashes.

| Role | Can |
|---|---|
| host | See and work bookings: confirm, cancel, no-show, walk-in |
| manager | Everything a host can, plus CSV export, holds, menu/nights/photos, settings, audit log |
| owner | Everything, plus staff accounts |

The matrix lives in `src/auth/roles.ts`. Every admin page calls `requireUser(permission)` and every `/api/admin/*` handler calls `requireApiUser(req, permission)` from `src/auth/guard.ts`. Both re-read the user from Postgres on each request, so demoting or deleting someone takes effect immediately. Middleware only does the first redirect.

- **First owner:** set `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD`, run `pnpm db:seed`. It only works while there are no users. The owner must pick a new password at first sign-in.
- **Password change** signs the user out and invalidates every older session, including stolen cookies.
- **Brute force:** 10 attempts per email and 30 per IP per 15 minutes (Postgres sliding window, `src/lib/rate-limit.ts`). Unknown emails take the same time as wrong passwords.
- **CSRF:** cookies are SameSite=Lax; admin API mutations also require a matching `Origin` (`NEXT_PUBLIC_SITE_URL`). Server actions get Next.js's built-in origin check.
- Every sign-in, failure, lockout and password change is written to `audit_log`.

Browser check of the whole first-login journey (server running, owner just bootstrapped):

```bash
E2E_BASE_URL=http://localhost:3000 ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... node tests/e2e/auth-journey.cjs
```
