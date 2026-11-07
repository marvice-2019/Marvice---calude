# Hydra Club & Kitchen — website

Next.js 15 + Postgres 16 + Drizzle. Built by Marvice Media Private Limited.

## Status

| Stage | State |
|---|---|
| 1. Data model | Done: schema, migrations, seed, DB tests |
| 2–8 | Not started |

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
