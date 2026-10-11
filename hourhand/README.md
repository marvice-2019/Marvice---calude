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

## Sign-in

Sign-in uses [Better Auth](https://www.better-auth.com) and needs `HOURHAND_DATA=postgres`. In memory mode there are no accounts: the dashboard opens as the demo host and `/sign-in` says so.

- **Email magic link:** `/sign-in` emails a one-time link that expires after 15 minutes. Until mail is wired up (round B3), the link is printed to the server log as `[dev] magic link for …` in development. In production, a missing `RESEND_API_KEY` makes sending fail loudly. `HOURHAND_MAIL_TO_LOG=1` lets a production build print the link instead; it exists only for end-to-end tests and must never be set on a real deployment.
- **Google:** the button appears only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Add `https://<your-domain>/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local work) as a redirect URI in the Google Cloud console.
- **Sessions:** an httpOnly, SameSite=Lax cookie, `Secure` on https. Every dashboard page and server action checks the session itself through `requireUser()` in `src/lib/auth/session.ts`; there is no middleware-only check. Settings has "Sign out of all devices".
- **New hosts** get a booking-link slug from their name or email (`src/lib/auth/slug.ts`).

Environment variables for sign-in:

| variable | needed for |
| --- | --- |
| `BETTER_AUTH_URL` | the public base URL, for example `https://hourhand.app` |
| `BETTER_AUTH_SECRET` | signing sessions; a long random string (`openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in (optional) |
| `RESEND_API_KEY`, `EMAIL_FROM` | sending sign-in links (round B3) |

## What is fake today

- **Calendar sync:** none. Busy times and the sync status come from the seed.
- **Email:** sign-in links go to the server log until round B3.
- **Payments, WhatsApp, Microsoft and iCloud calendars:** not wired up. They will need: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.

## Layout

- `src/app` routes: `/dashboard/*` for the host, `/[slug]` and `/[slug]/[event]` for guests, `/b/[token]` to manage a booking.
- `src/components/ui` shared Button, Input, Label and Card.
- `src/lib/slots.ts` works out which times can be booked.
- `src/styles/tokens.css` colours, type and spacing, light and dark.
