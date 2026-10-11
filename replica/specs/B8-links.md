# B8: hidden event types, single-use links, one-off meetings

Recon: S19 "One-off / single-use link" (S04 → New → One-off): a meeting with custom times, or a link that expires after one booking. States: created, used, expired. Flow F08: S04 → S19 → pick times → copy link.

## 1. Hidden event types
- The event-type editor gets a switch: "Only people with the link can book". It sets `event_types.hidden` (the column exists).
- A hidden type is left off the public profile (already true in `src/app/[slug]/page.tsx`), but its own URL `/{slug}/{event}` still books normally.
- A hidden type is also left out of anything else public that lists event types (check the slots and booking APIs don't list them).

## 2. Single-use links
- A host makes a single-use link for any of their active event types, from the Links page or the event type's menu. The link is `/l/{token}`.
  - The token is 32 random bytes in base64url.
  - Only its SHA-256 hash is stored, so the raw token is shown once, when created, with a copy button.
- Opening `/l/{token}` shows that event type's normal booking page (times, form, payment if priced). Booking through it uses the link up.
  - Use the link in the **same transaction** as creating the booking. Two guests racing on one link means exactly one booking, and the other sees "This link has already been used".
  - A booking that fails or expires unpaid (B5b pending_payment hold that lapses) gives the link back, i.e. the link is consumed by a confirmed booking or an unexpired hold.
  - Rescheduling a booking made through a link keeps working through the manage link and does not need the single-use link.
- Link states, shown on the Links page:
  - **Open**: not used, not expired, not revoked.
  - **Used**: shows who booked and when.
  - **Expired**: optional expiry date, default none. One-off meetings expire after their last offered time.
  - **Revoked**: the host can revoke an open link.
- Unknown, revoked, expired and used tokens each get a plain page saying which. Never leak the event or host for an unknown token.
- Links are scoped to the host: every store method takes the host id. Another host's link id is not found.

## 3. One-off meetings
- From the Links page, "New one-off meeting". The host enters:
  - name, duration, and location (same choices as event types);
  - optional description;
  - 1 to 20 specific start times, picked as date and time in the host's time zone, each in the future.
- It is stored as an `event_types` row with `kind = 'one_off'`, `hidden = true` and a generated slug, plus the offered times in a new table. A single-use link to it is created at once and shown.
- The guest sees only the offered times that are still free: not past, not overlapping the host's busy blocks or existing bookings, with buffers 0 and min notice 0. Booking one uses the link (as in section 2), so the meeting can be booked once.
- One-off types don't appear in the Event types list; they live on the Links page.

## Data (migration 0009)
- `booking_links`:
  - columns: id, user_id, event_type_id, token_hash (unique), label, expires_at null, revoked_at null, used_booking_id null references bookings on delete set null, created_at;
  - index on user_id.
- `one_off_times`: event_type_id references event_types on delete cascade, start_at; primary key on both.
- A booking made through a link records `bookings.booking_link_id` (nullable, references booking_links on delete set null).

## Out of scope
- Meeting polls.
- Multi-use links with a count.
- Group events (B10).
