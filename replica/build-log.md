# Hourhand build log

One line per screen or unit. "Done" means built and checked: build, types, lint, tests, the rebrand sweep, and an end-to-end run on a local server. No screenshots yet, because browser automation is blocked in this environment, so `replica/clone-screens/` is empty.

| ID | date | status | what's missing | harder than expected |
| --- | --- | --- | --- | --- |
| scaffold | 2026-10-10 | done | `.env.example` (a hook blocks `.env*` writes; the variable names are in the README) | npm 10.9.4 crashes on Vitest's optional peers, so installs need `--legacy-peer-deps` |
| slot engine | 2026-10-10 | done | — | daylight-saving expansion per local date; covered by a London test across 25 Oct 2026 |
| data layer (fake) | 2026-10-10 | done | lookup by idempotency key (it scans the host's bookings for now) | pages and API routes got separate copies of the in-memory store until it moved onto `globalThis` |
| shell (18 routes) | 2026-10-10 | done | most host screens are still stubs | — |
| API `/api/slots`, `/api/bookings` | 2026-10-10 | done | rate limiting; Turnstile on abuse | the re-check that a start is still offered has to run after the repeated-key lookup, or it rejects the booking's own slot |
| S13 public profile | 2026-10-10 | done | — | — |
| S14 booking page | 2026-10-10 | done | — (12h/24h toggle added in round 2; remembered per browser) | avoiding a server/browser render mismatch on the detected time zone and the stored clock choice |
| S15 details form | 2026-10-10 | partial | add guests (phone and answers are saved since round 2) | — |
| S16 confirmation | 2026-10-10 | partial | add-to-calendar file, redirect option (times follow the guest's 12h/24h choice since round 3) | first paint shows 12h, then switches to the stored choice; keeps the server render identical to the first browser render |
| S11 bookings list | 2026-10-10 | done | filters (past / cancelled tabs) | — |
| S12 booking detail | 2026-10-10 | partial | host actions (cancel, reschedule, mark no-show) | — |
| S17 guest cancel | 2026-10-10 | done | email delivery of the link (shown on the confirmation page for now) | cancelling twice must stay a no-op; a past start counts as inside the cut-off |
| S18 guest reschedule | 2026-10-10 | done | email delivery of the link | the overlap check and the slot list both have to skip the booking being moved, or the guest can't shift by one slot; a retry with the same key must return the same new booking instead of hitting "cancelled" |

| S09 availability | 2026-10-10 | done | "until midnight" (24:00) can't be typed in the browser's time field; overrides list shows HH:MM, not the 12h/24h choice | "today" and past dates have to be judged in the schedule's time zone, not the server's |
| S05–S07 event type editor | 2026-10-10 | done | unsaved-changes warning; Notifications tab dropped until notifications exist | delete is blocked by any booking, past ones included, because the schema keeps bookings tied to their event type |

| Postgres data layer (B1) | 2026-10-11 | done | owner check for the nine methods without a user id (comes with sign-in, B2) | a builder worktree can't switch to the postgres OS user, so the orchestrator runs the throwaway database; tsx can't load esbuild here, so scripts run on Node's own TypeScript support |
| Sign-in (B2a) | 2026-10-11 | done | Resend sending (B3); account deletion, rate limits and owner checks (B2b) | Better Auth inserts non-uuid ids into the verification table, so auth table ids had to be text; builders could not fit this round in their context, so it was built in the main session |
| Ownership, deletion, rate limits (B2b) | 2026-10-11 | done | booking/slot endpoint limits; guests not yet emailed when a host closes their account (B3) | Better Auth puts requests with a multi-entry x-forwarded-for into one shared rate-limit bucket unless trusted proxies are configured |
| Google Calendar (B4a) | 2026-10-11 | done | push channels and incremental sync (B4b); a real run against Google (needs your OAuth client and test-user setup) | a guest's confirmation waiting for its Meet link had to be released whatever the calendar write did, or a failing or unconfigured calendar held it up |
| Plans and billing (B5a) | 2026-10-11 | done | switching Solo↔Duo on a live subscription; Duo's second person; a real run against Razorpay and Stripe test mode (needs your keys) | neither provider guarantees webhook order, so a webhook only names the subscription and Hourhand re-reads it under a lock; a late cancel of an old subscription had to be kept from wiping a newer plan |
| Booking payments (B5b) | 2026-10-11 | done | Stripe for non-INR (no Stripe access); OAuth connect (needs Razorpay partner approval); a real test-mode payment through Checkout | Razorpay Route turned out to put guests' money in the platform's account, so the design changed to the host's own key pair; builders kept running out of context, so the round was cut into seven small jobs |
| Instant Google sync (B4b) | 2026-10-11 | done | a real run against Google (needs the https deploy and the new scope on the consent screen) | Hourhand's free/busy scope couldn't watch calendars; `calendar.events.freebusy` reads the same availability and can, so the scope was swapped before any host connected |
| Host meeting actions (B7) | 2026-10-11 | done | none for this scope | the reschedule path recorded every move as the guest's; it now records who moved it, and the email says so |
| Microsoft: Outlook, Teams, Sign in with Microsoft (B6) | 2026-10-11 | done | Outlook push (5-minute polling only), Zoom | Microsoft rotates refresh tokens, so concurrent refreshes needed a lock; Entra emails are often unverified, so Microsoft sign-up needed its own guard |
| Hidden event types, single-use links, one-off meetings (B8) | 2026-10-11 | done | multi-use links with a count, meeting polls | `instanceof` on store errors fails in a production build (route and store bundled apart); found only by the end-to-end race |
| Batch A: WhatsApp buttons, holidays, running late, rebook suggestions, appearance + zone confirm | 2026-10-11 | done | official WhatsApp API (B9); browser run of the zone confirm and theme switch (browser automation is blocked in this environment, so they're covered by unit tests and HTTP checks) | holiday dates conflict across sources, so each was checked against the DoPT orders; rebook suggestions are worked out as of when the email was queued, so a retried send has the same body |
| Batch B: weekly repeats, session packages, no-show deposit, GST invoices | 2026-10-11 | done | paid weekly series without a package; automatic package refunds; guest state on invoices (IGST); GSTR-1 JSON export; a CA's sign-off on the invoice format and on GST for kept deposits | a review found rescheduling a package session handed its credit back (unlimited sessions for one payment); moves now carry the package. Invoices are issued in the same transaction as the money, so numbering stays gapless under concurrency |
| Batch C: client notes, monthly earnings, waitlist, mini website, Duo second person, Indian languages, iCloud | 2026-10-11 | done | native-speaker review of the Hindi, Tamil, Telugu and Kannada drafts; guest emails and WhatsApp texts in those languages; showing Google review text on the page (needs a paid Places key, so it links out); iCloud uses polling, not the collection ctag; a real iCloud account run (needs a test Apple ID) | the review found refunds slid into whatever month a payment row was last written (an updated_at trigger), so refunds now carry refunded_at; the waitlist and Duo invites could mail strangers without limit, now capped. Duo access is an allowlist: only shared pages call requireHost, everything else stays on the signed-in person's own account, and every request re-checks the seat |
| Email and jobs (B3) | 2026-10-11 | done | a real send through Resend (needs the key and a verified domain); per-event-type email settings (the `notification_settings` table is unused, every event type gets the defaults); proper calendar invites (B4) | the job runner had to live in the web process: scripts run on Node's own TypeScript, which can't load app modules that import each other without extensions |

**Feature parity after round 3**: 42.0 / 100, must-haves 9 of 22 done (round 2: 33.9 and 6). Not shippable yet: calendar connection and sync, emails, payments and auth are the big must-haves left.

**End-to-end check after round 3** (Node fetch against `next start` on localhost:3120): book 201, reschedule 201 with a new link, retry with the same key 200 and the same booking, cancel 200, unknown link 404; `/dashboard/availability`, `/dashboard/event-types`, `/new` and the coaching editor all 200 with their sections. The save buttons were not clicked in a browser (browser automation is blocked here), so the save round trip is covered by unit tests on the data layer, not by a live run.

**Feature parity after round 2** (`parity.py replica/features.csv`): 33.9 / 100, must-haves 6 of 22 done (up from 24.1 and 4 after the first slice). Not shippable yet.

**End-to-end check, 2026-10-10** (Node fetch against `next start` on localhost):

- `GET /api/slots` for priya/coaching over 14 days returned 105 slots.
- `POST /api/bookings` returned 201.
- The same slot with a new key returned 409 `slot_taken` with 3 next slots.
- The same key again returned 200 with the same booking.
- Invalid input returned 400.
- The booking appeared on `/dashboard/bookings`.
- The confirmation page returned 200 and showed "You're booked".
