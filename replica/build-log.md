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
