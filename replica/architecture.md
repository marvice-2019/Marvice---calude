# Hourhand architecture

This reads `replica/recon.md` (22 screens, 10 flows, 14 entities) and `replica/features.csv` (22 must, 9 should, 3 could, plus 9 Hourhand fixes). The SQL is in `replica/schema.sql`.

## 1. Stack

It's built for the stack Marvice already runs: a single 16 GB VPS on Coolify, with Postgres and n8n. It needs no Vercel or Supabase bill, and it's one app and one database.

| layer | choice | why |
| --- | --- | --- |
| web app | **Next.js (App Router) + TypeScript**, one container on Coolify | server actions for the dashboard, server-rendered booking pages that load fast on mobile data, one codebase |
| styling | **Tailwind**, mapped to `replica/design/tokens.json` | tokens already set by replica-brand; components use roles (`bg-surface`), never raw hex |
| database | **Postgres 16**, a Coolify-managed instance on the same VPS | one database; `btree_gist` exclusion constraints make double-booking impossible at the data layer |
| ORM | **Drizzle** | SQL-first, types generated from `schema.sql`, migrations checked in |
| auth | **Better Auth**: email magic link, Google and Microsoft sign-in | actively maintained; Auth.js has been in maintenance mode since Sept 2025 ([LogRocket](https://blog.logrocket.com/best-auth-library-nextjs-2026/), [WorkOS](https://workos.com/blog/top-nextauth-alternatives-secure-authentication-2026)). Sessions in httpOnly cookies, checked in every server action and route, **never in middleware alone** (CVE-2025-29927) |
| background jobs | **pg-boss**, a Postgres-backed queue, in a second container from the same image | reminders, sync and renewal emails with retries, and no Redis to run; n8n stays for ops alerts only |
| calendars | Google Calendar API (push channels plus incremental sync), Microsoft Graph (change subscriptions plus delta queries), iCloud via **CalDAV** with an app-specific password (polled every 5 minutes) | official public APIs with the user's own OAuth consent. iCloud is the gap Calendly leaves |
| video | Google Meet through Calendar `conferenceData`; Zoom through the Zoom OAuth API | links created on the host's own account |
| payments | **Razorpay** (INR subscriptions and booking payments) plus **Stripe** (USD) | INR-first, a GST invoice on every charge; Calendly supports no INR |
| email | **Resend** or **Amazon SES** from `mail.hourhand.<tld>` with SPF, DKIM and DMARC | transactional only; pick on price at launch |
| WhatsApp / SMS | **Meta WhatsApp Cloud API** (approved utility templates) plus a DLT-registered SMS vendor (for example MSG91) | the reminder channel Indian clients actually read |
| files | local volume for avatars, backed up with the database | nothing large is stored; move to R2 only if needed |
| errors / uptime | GlitchTip (self-hosted, Sentry-compatible) and an uptime monitor | alerts to WhatsApp through n8n |
| analytics | Umami, self-hosted | privacy-friendly, so no cookie banner |

Pin every package at the current stable version on the day you install it. These versions are deliberately not pinned from memory.

**Will it fit the VPS?** Yes, with room to spare. The web app (about 300–500 MB), the worker (about 200 MB) and Postgres (about 1 GB shared buffers at this size) run alongside n8n. The first scaling move is separating Postgres onto its own server, which is worth doing at roughly a few thousand active hosts or if the database grows past half the RAM. That's an estimate; watch the metrics.

## 2. Schema

`replica/schema.sql` has **23 tables**. It was applied to a throwaway Postgres 16.4 on 2026-10-10 with no errors and then deleted.

| area | tables |
| --- | --- |
| accounts | `users`, `auth_accounts`, `auth_sessions`, `auth_verification_tokens` (shape owned by Better Auth's CLI), `subscriptions`, `team_members` |
| calendars | `calendar_connections` (with sync health: `status`, `last_synced_at`, `error_count`, `alert_sent_at`), `calendars`, `busy_blocks` |
| availability | `availability_schedules`, `availability_rules` (weekly or date, intervals in jsonb, in the schedule's time zone) |
| event types | `event_types`, `event_locations`, `custom_questions` |
| bookings | `bookings`, `invitees`, `booking_guests`, `payments` |
| messaging | `notification_settings`, `notifications` (outbox with `dedupe_key`) |
| ops | `integrations`, `webhook_events` (idempotency), `support_tickets` |

Conventions: uuid primary keys, `created_at` and `updated_at` with triggers, an owner column on every user-owned table, every `on delete` rule chosen deliberately, indexes on every foreign key and every filter column, check constraints on every status field, `timestamptz` everywhere, money as integer minor units plus a currency.

**Access rule:** there is no row level security. Every data-layer function takes the session `userId` and filters by `host_id` or `user_id`. Public booking routes read only `active` event types by slug. A test logs in as a second user and must get nothing back.

### The hard constraint

```sql
busy tstzrange generated always as (tstzrange(buffered_start, buffered_end, '[)')) stored,
constraint no_double_booking exclude using gist (host_id with =, busy with &&) where (status = 'confirmed')
```

The app widens each booking by its buffers when it inserts it. Postgres then refuses any overlapping confirmed booking for the same host, even when two guests click "Book" in the same millisecond. Group events store one `bookings` row per slot, with several `invitees` rows capped by `seat_limit`, so the constraint still holds.

**Tested 2026-10-10** (on the throwaway database):

| test | expected | result |
| --- | --- | --- |
| base booking 10:00–10:30 IST, buffers ±10 min | accepted | accepted |
| same host 10:30–11:00 (buffers overlap) | rejected | rejected by `no_double_booking` |
| same host 10:50–11:20 (buffers touch, no overlap) | accepted | accepted |
| a different host at the same time | accepted | accepted |
| double submit with the same `idempotency_key` | rejected | rejected by the unique constraint |
| cancel the first booking, then rebook its slot | accepted | accepted |
| status `cancelled` without `cancelled_at` | rejected | rejected by a check |
| a price without a currency | rejected | rejected by a check |
| invitee created | gets a 48-character manage token; email match is case-insensitive | as expected |

**Concurrency** wasn't tested with two parallel sessions. It relies on Postgres's exclusion constraint semantics: the second insert waits for the first transaction, then fails. Add a parallel test in `/replica-test`.

## 3. API

These are server actions (SA) and route handlers (GET/POST). "Host" means a signed-in owner, checked in the handler. **46 routes and actions, 6 incoming webhooks, 8 jobs.**

**F01 Host gets a link** (S01–S04)

| method | path / action | does | who | input | output |
| --- | --- | --- | --- | --- | --- |
| GET/POST | `/api/auth/*` | Better Auth: magic link, Google, Microsoft | public | email or OAuth | session cookie |
| SA | `completeOnboarding` | set slug, time zone, default schedule | host | slug, tz, weekly hours | user |
| GET | `/api/calendars/connect/:provider` | start OAuth for Google or Microsoft, or the iCloud form | host | provider | redirect |
| GET | `/api/calendars/callback/:provider` | store encrypted tokens, list calendars, first sync | host | OAuth code | redirect to S10 |
| SA | `connectIcloud` | verify the app-specific password over CalDAV | host | Apple ID, app password | connection |

**F02 Event types** (S04–S08)

| method | path / action | does | who | input | output |
| --- | --- | --- | --- | --- | --- |
| SA | `listEventTypes` | the S04 list | host | — | event types |
| SA | `createEventType` / `updateEventType` | validate (zod) and save; enforce the Free plan limits | host | fields | event type |
| SA | `toggleEventType` / `deleteEventType` / `reorderEventTypes` | | host | id(s) | ok |
| SA | `saveQuestions` | replace custom questions | host | list | questions |
| SA | `saveNotificationSettings` | reminders per event type, within the plan quota | host | list | settings |

**F03 Guest books** (S13–S16), the core loop

| method | path / action | does | who | input | output |
| --- | --- | --- | --- | --- | --- |
| GET | `/:slug` | profile page (server-rendered) | public | — | HTML |
| GET | `/:slug/:event` | booking page | public | — | HTML |
| GET | `/api/slots?event=&from=&to=&tz=` | compute free slots (rules + overrides − busy blocks − bookings − buffers, notice, window, limits); **returns nothing for a calendar whose sync is stale** (fix 1) | public, rate-limited | range, tz | slot list |
| POST | `/api/bookings` | in one transaction: recheck the slot, insert booking and invitee (the exclusion constraint is the final guard), queue notifications, write to the host calendar after commit | public, rate-limited, Turnstile on abuse only | slot, details, answers, `idempotency_key` | booking plus manage link, or `409 slot_taken` with the next 3 slots |
| POST | `/api/bookings/:id/pay` | create a Razorpay or Stripe payment for a paid event; the booking stays pending until the webhook | public | booking id | checkout params |

**F04/F05 Guest manages a booking** (S17, S18)

| method | path / action | does | who | input | output |
| --- | --- | --- | --- | --- | --- |
| GET | `/b/:token` | manage page | token holder | — | HTML |
| POST | `/api/b/:token/cancel` | cancel within the policy, refund if paid, notify | token holder | reason | ok |
| POST | `/api/b/:token/reschedule` | new booking linked through `rescheduled_from_id`, old one cancelled, in one transaction | token holder | new slot | booking |

**F06 Availability** (S09) and **calendars** (S10)

| method | path / action | does | who | input | output |
| --- | --- | --- | --- | --- | --- |
| SA | `listSchedules` / `saveSchedule` / `deleteSchedule` | weekly hours | host | schedule | schedule |
| SA | `saveDateOverride` / `blockDateRange` | override a date; block a whole week (fix 4) | host | date(s), intervals | rules |
| SA | `listConnections` | the sync light for each connection (fix 1) | host | — | connections with status |
| SA | `updateCalendarSettings` | check-conflicts and add-to choices | host | calendar ids | ok |
| SA | `disconnectCalendar` / `resyncNow` | | host | id | ok |

**F07 Meetings** (S11, S12)

| method | path / action | does | who | input | output |
| --- | --- | --- | --- | --- | --- |
| SA | `listBookings` | upcoming, past or cancelled, paginated | host | filter, cursor | bookings |
| SA | `hostCancelBooking` / `hostRescheduleLink` / `markNoShow` | | host | id | ok |
| GET | `/api/bookings/export.csv` | CSV export | host | range | file |

**F08 One-off links** (S19)

| method | path / action | does | who | input | output |
| --- | --- | --- | --- | --- | --- |
| SA | `createOneOff` | a `one_off` or `single_use` event type | host | times or event | link |

**F09 Integrations and billing** (S20, S21)

| method | path / action | does | who | input | output |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/integrations/zoom/connect` and `/callback` | Zoom OAuth | host | code | redirect |
| SA | `connectPayments` | Razorpay or Stripe keys or OAuth for taking booking payments | host | — | integration |
| SA | `startCheckout` | subscribe to Solo or Duo through Razorpay Subscriptions or Stripe Checkout | host | plan, interval | redirect |
| SA | `cancelPlan` / `pausePlan` / `resumePlan` | **one tap**, effective at period end; pausing stops charges (fix 2) | host | — | subscription |
| SA | `inviteTeamMember` / `removeTeamMember` | Duo seats, showing the new total before confirming | host (owner) | email | member |
| SA | `openSupportTicket` | goes to the support inbox; target a human reply within 1 working day (fix 3) | host | subject, body | ticket |

**Incoming webhooks.** Each one verifies its signature, then inserts into `webhook_events (provider, external_id)` first. A duplicate is a no-op.

| path | from | handles |
| --- | --- | --- |
| `POST /api/webhooks/razorpay` | Razorpay | `subscription.*`, `payment.captured`, `payment.failed`, `refund.processed` |
| `POST /api/webhooks/stripe` | Stripe | `checkout.session.completed`, `customer.subscription.updated` / `.deleted`, `invoice.payment_failed`, `charge.refunded` |
| `POST /api/webhooks/google-calendar` | Google push channel | marks the calendar dirty, so the job runs an incremental sync |
| `POST /api/webhooks/microsoft-graph` | Graph subscription | validation handshake, then marks the calendar dirty |
| `POST /api/webhooks/whatsapp` | Meta | delivery status, opt-out ("STOP") |
| `POST /api/webhooks/email` | Resend or SES | bounces and complaints, which suppress the address |

**Outgoing webhooks:** none at launch. Zapier and n8n hooks are a could-have.

**Jobs** (pg-boss, in the worker container)

| job | schedule | does |
| --- | --- | --- |
| `sync-calendar` | on push, plus every 5 min for iCloud, plus every 15 min as a safety net | incremental sync into `busy_blocks`; on error, raise `error_count`, set status to `degraded` or `disconnected` |
| `sync-health-alert` | every 2 min | connection stale for over 15 min or disconnected: alert the host once (WhatsApp and email), so slots stop being offered (fix 1) |
| `renew-push-channels` | hourly | renew Google channels and Graph subscriptions before `push_expires_at` |
| `send-notifications` | every minute | send due `notifications` rows; retry 3× with backoff, then mark `failed`; count against the plan quota |
| `renewal-reminders` | daily 09:00 IST | email and WhatsApp 7 days before `current_period_end` (fix 2) |
| `write-calendar-event` | after each booking, cancel or reschedule | create, update or delete the event in the host's add-to calendar, attaching the Meet or Zoom link |
| `purge-deleted-users` | daily | hard-delete personal data 30 days after an account is deleted |
| `cleanup` | daily | expire unpaid pending bookings after 30 min; prune old `webhook_events` and `busy_blocks` |

## 4. The parts that bite

- **Time zones and daylight saving.** Store UTC. Expand availability rules in the schedule's IANA time zone per date, so that daylight-saving shifts in the guest's zone (the UK, the US) move the displayed time and not the host's hours. India has no daylight saving, but its clients abroad do. Show the zone next to every time (fix 6).
- **Idempotency.** Webhooks retry, so dedupe on `webhook_events`. Booking submits carry an `idempotency_key`. Notifications carry a `dedupe_key`, so a reminder can't send twice.
- **Race conditions.** The exclusion constraint is the guard. A losing request returns `409` with the next open slots (the S16 "slot taken" state).
- **Sync correctness.** This is the product promise. Never offer a slot from a calendar whose last good sync is older than 15 minutes. Show the reason on S10 and alert once per outage.
- **Rate limits.** Booking and slot endpoints: per IP and per host, in Postgres or in memory. Respect Google, Graph and Meta API quotas with backoff.
- **Abuse and fake bookings.** Show a Turnstile challenge only on suspicious traffic, never by default. reCAPTCHA interruptions were a review complaint (review 14611975449).
- **WhatsApp templates.** Utility templates need Meta approval before launch, so submit them early. Store opt-outs.
- **SMS in India.** DLT registration of the entity, sender ID and templates takes days to weeks. Start in week 1.
- **Google OAuth verification.** Calendar scopes are sensitive, so public launch needs Google's verification, which takes weeks. Until then you're limited to 100 test users. Start in week 1.
- **Email deliverability.** A dedicated sending subdomain, SPF, DKIM and DMARC starting at `p=none`, and automatic suppression on bounces.
- **Multi-tenancy.** Every query is scoped by `host_id`. Duo members access the owner's data only through `team_members`.
- **Data deletion.** Account deletion removes personal data after 30 days (an App Store requirement for apps with sign-up). Invitee data can be deleted on request.
- **Secrets.** OAuth tokens and the iCloud password are encrypted with AES-GCM, with the key in an environment variable on Coolify. Every variable is listed in `.env.example`, which holds no values.
- **Backups.** Nightly `pg_dump` to off-box storage (Coolify backup to S3-compatible storage), and a restore test monthly.

## 5. Build order

The hours are estimates for one experienced full-stack developer working with AI-assisted tools.

| # | milestone | screens | tables | routes / jobs | hours |
| --- | --- | --- | --- | --- | --- |
| 1 | **Vertical slice, ugly:** sign in with Google, connect Google Calendar, one event type, public booking page, book, confirmation email, booking appears in Google Calendar | S01, S02, S04, S05 (basic), S14–S16 | users, auth_*, calendar_connections, calendars, busy_blocks, availability_*, event_types, bookings, invitees, notifications | auth, calendar connect/callback, `/api/slots`, `/api/bookings`, `sync-calendar`, `send-notifications`, `write-calendar-event` | 40–55 |
| 2 | **Must-haves, availability and event types:** weekly hours, overrides, notice, window, increments, buffers, locations, custom questions, profile page | S03, S05–S07, S09, S13 | event_locations, custom_questions | F02 and F06 actions | 30–40 |
| 3 | **Must-haves, guest management and host views:** cancel and reschedule links, meetings list and detail, no-show, Outlook connection, check-conflicts and add-to settings | S10–S12, S17, S18 | booking_guests | F04, F05, F07, Graph webhook | 30–40 |
| 4 | **Must-haves, notifications:** confirmation plus reminders by email, WhatsApp and SMS, opt-out | S08 | notification_settings | WhatsApp and email webhooks | 20–30 |
| 5 | **Fixes that make it Hourhand:** sync light and alerts, stale-sync slot blocking, iCloud CalDAV, block a week, recurring and one-off links, 12h/24h with zone confirmation | S09, S10, S14, S19 | (already in the schema) | `sync-health-alert`, `connectIcloud`, `createOneOff` | 35–45 |
| 6 | **Billing and plans:** Razorpay and Stripe subscriptions, one-tap cancel and pause, renewal reminders, GST invoice, Duo seats, plan limits | S21 | subscriptions, team_members, webhook_events | billing actions, payment webhooks, `renewal-reminders` | 30–40 |
| 7 | **Should-haves:** several schedules, multiple durations, daily limits, hidden events, cancellation policy, embed, Meet and Zoom links, booking payments | S05, S06, S20 | payments, integrations | Zoom OAuth, `/api/bookings/:id/pay` | 35–45 |
| 8 | **Hardening:** rate limits, Turnstile, data deletion, backups, GlitchTip, Umami, support inbox | — | support_tickets | `purge-deleted-users`, `cleanup` | 15–20 |
| 9 | **Could-haves (after launch):** group events, prefill, meeting polls, native mobile app | S22 | — | — | not estimated |

**Total to launch-ready web (milestones 1–8): about 235–315 hours**, roughly 6–8 weeks for one developer. That matches the M estimate in `recon.md`. Milestones 5 and 6 are what make it worth paying for; don't ship without them.

### Monthly running cost at launch (estimates, before GST)

| item | cost | note |
| --- | --- | --- |
| VPS (existing 16 GB Coolify box) | ₹0 extra | shared with n8n; separate it later |
| off-box backups | about ₹100–300 | S3-compatible storage, a few GB |
| email | about ₹0–1,700 | free tier first; check Resend or SES pricing at launch |
| WhatsApp and SMS | pass-through | budgeted per plan in `pricing.md` (≤ ₹75 per Solo user, worst case) |
| domain | about ₹100 a month | amortised |
| **fixed total** | **about ₹200–2,100 a month** | everything else scales with paid users |

Next step: `/replica-design`.
