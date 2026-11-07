# Hydra Club & Kitchen — website

Next.js 15 + Postgres 16 + Drizzle. Built by Marvice Media Private Limited.

## Status

| Stage | State |
|---|---|
| 1. Data model | Done: schema, migrations, seed, DB tests |
| 2. Auth and roles | Done: staff sign-in, roles, forced first password change, rate limits |
| 3. Booking flow and API | Done: availability, bookings, guest lookup/cancel, .ics, admin bookings and holds, n8n webhook + workflow |
| 4–8 | Not started (4 needs `/reference/`) |

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

## Booking API

All rules live in `src/booking/service.ts` (no Next.js inside, tested directly against Postgres); route handlers only parse, rate-limit and map results to HTTP.

| Endpoint | Who | What |
|---|---|---|
| `GET /api/availability?date=` | public | Time slots for that night with free-table counts |
| `GET /api/availability?date=&time=` | public | Every table: `available`, `booked` or `held` |
| `POST /api/bookings` | public | Creates a `pending` booking, returns `ref` (`HYD-XXXX`) |
| `GET /api/bookings/:ref?last4=` | guest | Their booking (ref + last 4 phone digits) |
| `POST /api/bookings/:ref/cancel` `{last4}` | guest | Cancels an upcoming booking |
| `GET /api/bookings/:ref/ics?last4=` | guest | Add-to-calendar file |
| `GET /api/admin/bookings?date=&status=&zone=` | bookings:read | A night's bookings |
| `PATCH /api/admin/bookings` `{id, action}` | bookings:write | confirm, cancel, no_show, complete |
| `GET/POST/DELETE /api/admin/holds` | holds:write (GET: bookings:read) | Block a table or zone for a night; POST lists bookings it clashes with |

Rules:

- **Nights, not calendar days.** `date` is the service date. Times before 05:00 belong to the previous night, so on Friday's list `00:00` means just after midnight.
- **Slots** start every 30 minutes from opening; the last start is an hour before closing; a booking lasts `slot_length_minutes` but never past closing. No hours set → booking is closed and the UI hides.
- **Double booking** is refused by Postgres; the API answers 409 "That table was just taken" with up to 5 free tables at the same time, same zone first.
- **Abuse:** honeypot field `website` (bots get a fake success, nothing stored), 5 attempts per IP per hour (failed ones count), Turnstile behind the `captcha_enabled` setting, 20 lookups/cancels per IP per hour, a wrong last-4 looks exactly like an unknown ref.
- **Phones:** any common Indian format, stored as `+91XXXXXXXXXX`; only mobiles starting 6–9.
- **Notifications:** every create/confirm/cancel/no-show/complete is sent to n8n after the response (`after()`), HMAC-signed, retried 2 s/10 s/30 s; a final failure is written to `audit_log` as `webhook.failed`, never shown to the guest. n8n setup: `n8n/README.md`.

Browser check of the whole first-login journey (server running, owner just bootstrapped):

```bash
E2E_BASE_URL=http://localhost:3000 ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... node tests/e2e/auth-journey.cjs
```
