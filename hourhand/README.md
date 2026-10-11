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

- **Email magic link:** `/sign-in` emails a one-time link that expires after 15 minutes. It goes out through Resend straight away (not through the queue). Without `RESEND_API_KEY` in development, the whole email, link included, is printed once to the server log (`[dev] email to …: Your Hourhand sign-in link`). In production, a missing `RESEND_API_KEY` stops the server from starting. `HOURHAND_MAIL_TO_LOG=1` lets a production build print the link instead; it exists only for end-to-end tests and must never be set on a real deployment.
- **Google:** the button appears only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Add `https://<your-domain>/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local work) as a redirect URI in the Google Cloud console.
- **Sessions:** an httpOnly, SameSite=Lax cookie, `Secure` on https. Every dashboard page and server action checks the session itself through `requireUser()` in `src/lib/auth/session.ts`; there is no middleware-only check. Settings has "Sign out of all devices".
- **Ownership:** every data-layer method that touches a host's records takes that host's id and enforces it in the query. Another host's record reads as "not found".
- **Rate limits:** sign-in links are limited to 3 per email and 10 per address every 10 minutes (sign-in page), and Better Auth limits its own endpoints (5 link requests per address per 10 minutes) in production. Counts are kept in memory, which fits one web container.
- **Deleting an account:** Settings → Delete your account (type your email to confirm). Links stop at once, upcoming bookings are cancelled, every session ends and the account can't sign back in. The job runner permanently deletes accounts closed more than 30 days ago, checking every hour; `npm run db:purge-deleted` does the same by hand. Guests of the cancelled bookings get a cancellation email.
- **New hosts** get a booking-link slug from their name or email (`src/lib/auth/slug.ts`).

Environment variables for sign-in:

| variable | needed for |
| --- | --- |
| `BETTER_AUTH_URL` | the public base URL, for example `https://hourhand.app`. **Required in production**: without it sign-in links would be built from the request's Host header, so the app refuses to start |
| `TRUSTED_PROXIES` | comma-separated networks of your own reverse proxy (default: private ranges, which fits Coolify's Traefik). Rate limits read the client address from the entry the proxy appended, so visitors can't forge it |
| `HOURHAND_ALLOW_MEMORY` | `1` only for a public demo. A production server refuses `HOURHAND_DATA=memory` (no sign-in) without it |
| `BETTER_AUTH_SECRET` | signing sessions; a long random string (`openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in (optional) |
| `RESEND_API_KEY`, `EMAIL_FROM` | sending email. `EMAIL_FROM` is a sender on your verified Resend domain, for example `Hourhand <bookings@mail.hourhand.app>`. **Required in production** |
| `HOURHAND_WORKER` | `0` to run a server without the job runner (only if another process runs it) |

## Email and jobs

Booking emails are queued in the `notifications` table inside the same transaction as the booking change, so a booking never exists without its emails (and a failed booking sends none). A job runner inside the server process (`src/instrumentation.ts`, Postgres mode only) sends them:

- **What is sent:** the guest's confirmation (with a calendar file) and the host's notice on booking; reminders to the guest 24 hours and 1 hour before (only those still in the future when booked); "moved" emails on a reschedule; cancellation emails to both on a cancel. When a host closes their account, only the guests are emailed.
- **When:** a booking change wakes the runner at once; otherwise it checks every 15 seconds.
- **Retries:** a temporary failure (rate limit, Resend outage, network) is retried after 1, 5, 30 and 120 minutes. After 5 attempts, or on a permanent error such as a rejected address, the row ends as `failed` with `last_error`. That is the dead-letter log: `select kind, recipient, last_error from notifications where status = 'failed'`. After a long outage, send them again with `update notifications set status = 'queued', attempts = 0, send_at = now(), last_error = null where status = 'failed' and updated_at > now() - interval '1 day'`; anything no longer worth sending is skipped at send time.
- **Never twice:** each row is claimed with `FOR UPDATE SKIP LOCKED` and a 5-minute lease, and its id is sent to Resend as the idempotency key, so several servers can run the runner and a crash mid-send does not email twice.
- **Never stale:** once a booking is cancelled or moved, nothing but the cancellation emails goes out about it, even an email that was already waiting to retry. Reminders for a started booking, and any booking email after the meeting has ended, are skipped too, each recorded as `skipped` with the reason.

## Google Calendar

Hosts connect Google Calendar from Dashboard → Calendars. It needs the Postgres store, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the same OAuth client as Google sign-in) and `TOKEN_ENCRYPTION_KEY`.

- **Permissions:** the calendar list (read-only), free/busy on the calendars the host can see (`calendar.events.freebusy`: when they're busy, never what the meetings are), and events on calendars the host owns, plus the account's email. Never full calendar access. If the host unticks one on Google's screen, Hourhand says so and keeps nothing.
- **Handshake:** a sealed 10-minute cookie ties Google's callback to the host who started it, with PKCE. A forged or replayed callback is refused.
- **Tokens** are encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` and bound to their account; a database dump or backup can't use them. Disconnecting asks Google to revoke the grant and deletes the tokens.
- **Busy times:** the job runner reads free/busy from each checked calendar every 5 minutes (2 while failing), far enough ahead to cover the host's longest booking window, and replaces the cached busy times in one transaction. A calendar Google can't read fails the sync; it is never treated as free.
- **Instant sync:** on a public https address, Hourhand asks Google to watch each checked calendar (renewed weekly, stopped when the host unchecks it or disconnects). When a meeting is added or moved, Google pings `/api/webhooks/google-calendar` and that host syncs within seconds. A ping only says "look again" and must carry the channel's own random token; a forged or lost ping changes nothing, because the 5-minute poll keeps running. Calendars Google won't watch (holiday calendars, some shared ones) stay on polling. On `http://localhost` there is no push, only polling.
- **Health:** if a connection hasn't synced for 15 minutes, its host's pages offer no times (so nobody books over a meeting) and the header shows it. After 3 failures in a row, or at once when the host revoked access, the host gets one email per outage with a link to fix it.
- **Booked events:** each booking is written to the calendar the host picks (only calendars they own), with the guest as an attendee and, for Google Meet event types, a Meet link. Google sends no email (`sendUpdates=none`); Hourhand's own emails carry the link. A guest's confirmation waits up to 3 minutes for the link, and goes without it if the calendar write fails. Reschedules move the same event; cancellations delete it. The event id is fixed per booking, so a retry never creates a second event.

Add these as authorized redirect URIs on the OAuth client: `https://<your-domain>/api/calendars/google/callback`, and `http://localhost:3000/api/calendars/google/callback` for local work (alongside the sign-in one).

| variable | needed for |
| --- | --- |
| `TOKEN_ENCRYPTION_KEY` | encrypting calendar tokens: 64 hex characters (`openssl rand -hex 32`). **Required when Google is configured**; keep it safe, changing it means every host reconnects |
| `GOOGLE_API_BASE_URL`, `HOURHAND_E2E` | end-to-end tests against a fake Google only. A production server ignores the first unless the second is `1`; never set either on a real deployment |

## Plans and billing

Hosts choose a plan from Dashboard → Plan. Rupees go through Razorpay subscriptions (UPI AutoPay or card), US dollars through Stripe Checkout. It needs the Postgres store.

- **Free:** 2 calendars checked for conflicts and a "Booked with Hourhand" footer on the booking pages. **Solo** and **Duo** remove both. Prices are in `src/lib/billing/plans.ts`; INR prices show 18% GST separately. Duo's second person isn't built yet, and the page says so.
- **Plan state comes only from the provider.** A webhook only tells Hourhand which subscription changed; Hourhand re-reads that subscription from Razorpay or Stripe (under a lock, so two events can't interleave) and saves what it finds. Events arriving late, twice or out of order still end correct. Nothing the browser sends changes a plan.
- **Webhooks** check the signature on the raw body (Stripe: refused if older than 5 minutes), are recorded once in `webhook_events`, and answer 500 when saving fails so the provider retries. A repeated event is acknowledged and ignored.
- **Paid features** count while the subscription is active, or while a failed renewal is being retried. Paused, ended, or unpaid (the provider stopped retrying: Razorpay "halted", Stripe "unpaid") means Free until the card is updated.
- **One subscription per host:** checkout is refused while one is live, paused or unpaid. If a host pays two Razorpay links from two tabs, the server log says `two open subscriptions`; refund one from the Razorpay dashboard. A late "cancelled" for an old subscription never takes away the plan a newer one pays for.
- **Cancel** stops renewal and keeps the plan to the end of the paid period. **Pause** stops charges and paid features until the host resumes. Stripe hosts also get "Card and invoices" (Stripe's billing portal).
- **Renewal reminder:** an email 7 days before each renewal, once per period, and not sent if the host cancelled or paused in the meantime.
- **Downgrades** don't switch calendars off: a host who drops to Free keeps the calendars already checked (so nothing gets double-booked), but can't turn on more than 2.
- **Not built yet:** switching between Solo and Duo on a live subscription (cancel, then choose again), and extra Duo seats.

Set up, in test mode first. **Razorpay:** create 4 Plans (Solo and Duo, monthly and yearly: ₹399, ₹3,990, ₹599, ₹5,990 before GST) and a webhook to `https://<your-domain>/api/webhooks/razorpay` with the `subscription.*` events. **Stripe:** one Product per plan with a monthly and a yearly Price ($7, $70, $11, $110), the Customer Portal turned on, and a webhook to `https://<your-domain>/api/webhooks/stripe` with `checkout.session.completed`, `customer.subscription.*` and `invoice.*`.

| variable | needed for |
| --- | --- |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay API keys |
| `RAZORPAY_WEBHOOK_SECRET` | the value you type when creating the Razorpay webhook |
| `RAZORPAY_PLAN_SOLO_MONTH`, `RAZORPAY_PLAN_SOLO_YEAR`, `RAZORPAY_PLAN_DUO_MONTH`, `RAZORPAY_PLAN_DUO_YEAR` | the Razorpay Plan ids (`plan_…`) |
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_test_…` first) |
| `STRIPE_WEBHOOK_SECRET` | the signing value Stripe shows for the webhook (`whsec_…`) |
| `STRIPE_PRICE_SOLO_MONTH`, `STRIPE_PRICE_SOLO_YEAR`, `STRIPE_PRICE_DUO_MONTH`, `STRIPE_PRICE_DUO_YEAR` | the Stripe Price ids (`price_…`) |
| `RAZORPAY_API_BASE_URL`, `STRIPE_API_BASE_URL` | end-to-end tests against fakes only; ignored in production unless `HOURHAND_E2E=1`. Never set on a real deployment |

A provider shows as "not set up" until its API key and webhook value are both set.

## Payments at booking

Hosts on Solo or Duo can charge guests for an event type, in rupees through Razorpay. **The money goes straight to the host's own Razorpay account; Marvice never holds it.** It needs the Postgres store and `TOKEN_ENCRYPTION_KEY`.

- **Connecting:** Dashboard → Integrations. The host pastes their own Razorpay key pair; Hourhand checks it with Razorpay, then stores it encrypted (AES-256-GCM, bound to the host) and shows only a masked key id and Test/Live. Disconnecting deletes it. Later, Razorpay OAuth can replace pasted keys without changing the payment code (needs Marvice approved as a Razorpay technology partner).
- **Pricing:** a "Price (₹)" field on the event type, ₹1 to ₹5,00,000. Setting one needs a paid plan and a connected Razorpay account, checked on the server. Razorpay's fee comes out of what the host receives.
- **Booking:** a priced booking holds its time for 15 minutes as "awaiting payment" (nobody else can take it), and Hourhand creates a Razorpay order on the host's account. The guest pays in Razorpay Checkout (UPI, cards, netbanking). Nothing is emailed or written to the calendar until the payment is confirmed.
- **Confirming:** the browser's result is only a hint. Hourhand checks the Checkout signature with the host's key against the order it created, then reads the payment from Razorpay (right order, right amount, captured; an authorized payment is captured), and only then confirms.
- **Background check:** every few seconds the job runner looks at pending payments a minute old or more: a guest who paid and closed the tab is confirmed; an unpaid hold past 15 minutes is released; a payment that lands within 30 minutes after its hold was released is refunded. The Pay button and Razorpay Checkout both close when the hold ends.
- **Refunds:** cancelling a paid booking (host, or guest within the event's cancellation window) refunds the full amount from the host's Razorpay account; the emails say so. A refund is asked for once per payment (Razorpay receipt `hh-<payment id>`, and existing refunds are checked first), and retried every 5 minutes if Razorpay refuses (for example, low balance); the host's booking page shows it.
- **Rescheduling** keeps the payment: no refund, no second charge.
- **Disconnecting Razorpay** is refused while a guest's payment is still being confirmed or refunded. **Closing an account** refunds paid upcoming bookings, and the 30-day purge waits until those refunds have gone through.
- **Free hosts:** a priced event of a host whose plan lapsed can't be booked; guests are told to contact the host.
- **Not built:** Stripe for non-INR (Stripe is invite-only for Indian businesses), partial refunds or cancellation fees, deposits, payment links for existing bookings, and the host's own webhook (not needed: Hourhand checks Razorpay itself).

## What is fake today

- **Calendar in demo mode:** the seed's "Work" calendar is demo data with no tokens; the sync leaves it alone. Instant sync needs a public https address, so on localhost busy times are at most 5 minutes old.
- **Email in development:** without `RESEND_API_KEY`, every email is printed to the server log instead of sent.
- **WhatsApp, Microsoft and iCloud calendars:** not wired up yet. They will need `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.

## Layout

- `src/app` routes: `/dashboard/*` for the host, `/[slug]` and `/[slug]/[event]` for guests, `/b/[token]` to manage a booking.
- `src/components/ui` shared Button, Input, Label and Card.
- `src/lib/slots.ts` works out which times can be booked.
- `src/styles/tokens.css` colours, type and spacing, light and dark.
