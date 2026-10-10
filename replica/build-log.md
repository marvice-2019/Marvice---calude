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
| S14 booking page | 2026-10-10 | partial | 24h toggle | avoiding a server/browser render mismatch on the detected time zone |
| S15 details form | 2026-10-10 | partial | phone number and question answers are validated but not saved (the invitee type has no fields for them); add guests | — |
| S16 confirmation | 2026-10-10 | partial | add-to-calendar file, redirect option | — |
| S11 bookings list | 2026-10-10 | done | filters (past / cancelled tabs), detail actions | — |
| S17/S18 manage page | — | not started | cancel and reschedule | — |

**Feature parity after the slice** (`parity.py replica/features.csv`): 24.1 / 100, with must-haves 4 of 22 done (more are partial). Not shippable yet, as expected at this stage.

**End-to-end check, 2026-10-10** (Node fetch against `next start` on localhost):

- `GET /api/slots` for priya/coaching over 14 days returned 105 slots.
- `POST /api/bookings` returned 201.
- The same slot with a new key returned 409 `slot_taken` with 3 next slots.
- The same key again returned 200 with the same booking.
- Invalid input returned 400.
- The booking appeared on `/dashboard/bookings`.
- The confirmation page returned 200 and showed "You're booked".
