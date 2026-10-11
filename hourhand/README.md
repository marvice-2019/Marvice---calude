# Hourhand

Hourhand gives you one link people can use to book time with you. It checks your calendar so nobody lands on a busy slot, and shows each guest times in their own zone.

## Run it

```sh
npm install --legacy-peer-deps
npm run dev     # http://localhost:3000
npm run build   # production build
npm run test    # Vitest unit tests
npm run lint    # ESLint
```

`--legacy-peer-deps` is needed because npm 10 trips over Vite's optional peer dependencies. If `next build` then complains about missing native binaries, run `npm rebuild @next/swc-linux-x64-gnu @tailwindcss/oxide`.

## Data: memory or Postgres

Screens only talk to `store` from `src/lib/data`. `HOURHAND_DATA` picks what sits behind it:

- `memory` (the default): an in-memory store seeded with a demo host, Priya Raman (`/priya`). It resets on every restart.
- `postgres`: the Postgres store. Needs `DATABASE_URL` (for example `postgres://user@localhost:5432/hourhand`); it fails at startup without one rather than falling back to memory.

Set up a database (Node 22.18 or later runs the TypeScript scripts directly):

```sh
createdb hourhand
DATABASE_URL=postgres://user@localhost:5432/hourhand npm run db:migrate   # applies db/migrations/*.sql not yet in schema_migrations
DATABASE_URL=postgres://user@localhost:5432/hourhand npm run db:seed      # demo hosts Priya (/priya) and Arun (/arun); skips hosts already there
HOURHAND_DATA=postgres DATABASE_URL=postgres://user@localhost:5432/hourhand npm run start
```

The Postgres integration tests in `src/lib/data/pg-store.test.ts` are skipped unless `TEST_DATABASE_URL` is set. The database it names must have "test" in its name: each run drops and recreates it, then migrates and seeds it. The user needs rights to create databases, and the server must also have a `postgres` database to connect to while doing so.

```sh
TEST_DATABASE_URL=postgres://user@localhost:5432/hourhand_test npm run test
```

## What is fake today

- **Current user:** fixed to Priya. There is no sign-in yet; `/login` is a placeholder.
- **Calendar sync:** none. Busy times and the sync status come from the seed.
- **Payments, email, WhatsApp, sign-in:** not wired up. They will need: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `RESEND_API_KEY`.

## Layout

- `src/app` routes: `/dashboard/*` for the host, `/[slug]` and `/[slug]/[event]` for guests, `/b/[token]` to manage a booking.
- `src/components/ui` shared Button, Input, Label and Card.
- `src/lib/slots.ts` works out which times can be booked.
- `src/styles/tokens.css` colours, type and spacing, light and dark.
