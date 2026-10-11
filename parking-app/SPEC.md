# Bayline build spec (MVP, Bengaluru)

Stage 3 of the Replica pipeline, 11 Oct 2026. Built from `RECON.md`, `README.md`, `schema.sql` and `prototype/index.html`. Anything none of those support is marked **Proposed**, with the reason.

## 1. Scope

**MVP in (one city: Bengaluru):**
- Drivers: search, pre-book, Park now, pay by UPI, card or netbanking, digital pass, extend, cancel, promo codes, saved profile, favourites, monthly passes.
- Operators: staff check-in and check-out, dashboard, rate cards, lot status, payouts.
- Platform admin: lot onboarding, refunds, promos.
- Channels: website (Next.js) and an iOS and Android app (Expo).

**MVP out:**
- ANPR cameras (QR or plate typed by the attendant only)
- dynamic and demand pricing
- valet and "text the attendant"
- event ticket bundles
- multiple cities
- corporate accounts
- Apple Wallet passes (WhatsApp pass instead)
- EV charging payments

## 2. Roles and permissions

| Action | Guest | Driver | Op. staff | Op. admin | Platform admin |
|---|---|---|---|---|---|
| Search lots, view prices | ✓ | ✓ | ✓ | ✓ | ✓ |
| Book and pay (pre-book or Park now) | ✓ (phone OTP at pay) | ✓ | – | – | – |
| View own passes, extend, cancel | ✓ (via phone OTP) | ✓ | – | – | ✓ (support) |
| Save lots, saved profile | – | ✓ | – | – | – |
| Request monthly pass | – | ✓ | – | – | – |
| Check vehicles in and out at own lot | – | – | ✓ | ✓ | – |
| Set lot status (open, full, gate down) | – | – | ✓ | ✓ | ✓ |
| Edit rate cards, approve monthly passes | – | – | – | ✓ (own lots) | ✓ |
| View payouts | – | – | – | ✓ (own operator) | ✓ |
| Onboard lots, refunds, promos | – | – | – | – | ✓ |

A guest is a driver who has verified a phone number by OTP but has not set up a profile. Every pass belongs to a phone number. Staff and operator actions are limited to lots of their own operator (`operator_members`).

## 3. User stories

### Search and book

**DRV-01 Search lots.**
- Given a selected area, arrival time and leaving time, when the driver searches, then live lots within 3 km show with distance, lot code, price per hour, total including GST, and spots left, sorted by nearest.
- Leaving before arrival shows "Leaving time must be after arrival. Move it later."
- More than 30 days shows "Bookings run up to 30 days. For longer stays, use Monthly."

**DRV-02 Lot detail and bill.**
- Given a lot, when opened, then it shows timings, facilities, spots left and a bill with parking, discount, the ₹15 platform fee, 18% GST and the total.
- When the daily cap applies, the bill says "(daily cap applied)".

**DRV-03 Sign in.**
- Given a 10-digit Indian mobile number starting with 6–9, when an OTP is requested, then a 6-digit OTP is sent.
- When the correct OTP is entered within 5 minutes, the session starts.
- A wrong OTP shows "That code doesn't match. Check the SMS and try again."
- More than 5 requests per number per hour returns 429 with "Too many attempts. Try again in an hour."

**DRV-04 Pre-book and pay.**
- Given a lot with capacity, when the driver pays, then a 10-minute hold is created, a Razorpay order is created, and on a captured webhook the booking becomes `confirmed` and a pass with code `BL-XXXXX` is issued.
- A failed payment releases the hold and shows "Payment didn't go through. You weren't charged."

**DRV-05 Lot full.**
- Given the lot's online capacity is used up for the period, when the driver tries to book, then the API returns 409 `lot_full` and the app shows "This lot just filled up. Try a nearby lot." along with the 3 nearest alternatives.

**DRV-06 Promo code.**
- Given code `FIRST50` on a first booking, then 50% of parking is taken off, capped at ₹100, before GST.
- Given `WEEKEND20` with a Saturday or Sunday arrival, 20% is taken off, capped at ₹200.
- An unknown code shows "<CODE> isn't a valid code. Check the spelling, or try FIRST50."
- `FIRST50` on a repeat booking shows "FIRST50 works on your first booking only."
- `WEEKEND20` on a weekday shows "WEEKEND20 works only when you arrive on a Saturday or Sunday."

**DRV-07 Saved profile.**
- Given a driver who has paid before, when checkout opens, then plate, mobile and payment method are prefilled, with the note "Filled from your last booking."

**DRV-08 Favourites.**
- Given a lot, when the driver taps "Save lot", then it appears in the "Saved lots only" filter and carries a "★ Saved" chip.
- With no saved lots, the filter shows "No saved lots yet. Open a lot and tap Save to keep it here for next time."

**DRV-09 Park now.**
- Given a valid lot code (e.g. `BLR101`, spaces and hyphens ignored) and a duration of 1, 2, 3, 4 or 8 h, when the driver pays, then the pass starts at the current minute and is live immediately.
- An unknown code shows "No lot with code <CODE>. Check the board at the entrance, or pick a lot above."

**DRV-10 Passes.**
- Given bookings, when Passes opens, then each shows its status ("Starts in…", "Live · ends in…" or "Completed"), entry QR, pass code, plate, times, amount paid and method, and the WhatsApp number.
- The pass opens offline in the app.

**DRV-11 Extend.**
- Given a pass that has not ended, when the driver taps "Extend 1 hour", then 1 hour at the lot rate plus 18% GST is charged and the end time moves by 1 hour.
- If the lot is full for the extra hour, the API returns 409 and the app shows "Can't extend: the lot is full after <time>."

**DRV-12 Cancel.**
- Given a pass whose arrival time is in the future, when cancelled, then a full refund goes to the original method and the app shows "Cancelled. Full refund in 3–5 working days."
- After the arrival time, the cancel button is hidden.

**DRV-13 Overstay.**
- Given a pass whose end time has passed, when staff check the vehicle out, then each started hour is charged at the lot rate plus GST, as an exit payment through UPI collect or a payment link sent on WhatsApp.

### Guest

**GST-01 Guest checkout.**
- Given no profile, when paying after phone OTP, then the pass is issued against that phone number and sent on WhatsApp.

**GST-02 Claim passes.**
- Given passes bought as a guest, when the same phone later completes a profile, then all earlier passes appear under Passes.
- A session must not be lost during signup; this was a Parking.com 1-star complaint in the recon.

### Monthly

**MON-01 Request monthly pass.**
- Given a lot with monthly pricing, when the driver submits name, plate and start date, then the request is saved as `requested` and the app shows "Request sent. The operator replies within one working day."

**MON-02 Approve and pay.**
- Given a request, when the operator approves and assigns a bay, then the driver gets a WhatsApp payment link for the monthly fee plus 18% GST.
- After payment the pass becomes `active`.

**MON-03 Unpaid month.**
- Given an active pass, when the month's fee is still unpaid on the 3rd and the 5th, then reminders go out on those days.
- If it is still unpaid after the 7th, the status becomes `paused_unpaid` and staff check-in is refused with "Monthly pass paused: payment due."

### Operators

**OPS-01 Check in.**
- Given staff at their own lot, when they scan a pass QR or type a plate, then a valid pass checks in and records a `gate_events` row with `in`.
- An invalid, expired or other-lot pass shows a red result with the reason.
- With no network, the scan is queued and synced later.

**OPS-02 Check out.**
- Given a checked-in vehicle, when staff check it out, then an `out` event is recorded.
- If the pass has ended, the overstay amount shows (DRV-13).

**OPS-03 Rate cards.**
- Given an operator admin, when a new rate card is saved with an effective date, then it applies to quotes from that date.
- Overlapping cards are rejected by the database constraint, with the message "A rate already covers these dates."

**OPS-04 Lot status.**
- Given staff, when they set a lot to `full`, `gate_down` or `closed`, then search hides it (or marks it) and drivers with passes in the next 3 hours get a WhatsApp notice.

**OPS-05 Payouts.**
- Given an operator, when they view payouts, then each week shows gross, 15% commission, TDS/TCS, net and transfer status, downloadable as CSV.

### Platform admin

**ADM-01 Onboard lot.**
- Given operator KYC (PAN required, GSTIN optional) and lot details, when saved, then the lot gets a unique code (`BLR` + 3–4 digits) and goes live only when `is_live` is set.

**ADM-02 Refunds and disputes.**
- Given a booking, when the admin issues a full or partial refund, then a Razorpay refund is created and the action is written to the audit log.

**ADM-03 Promos.**
- Given the admin, when they create a code, then the percent, cap, first-booking-only and weekend-only flags, validity window and max uses all apply at quote time.

### Supply

**OWN-01 List your space.**
- Given the calculator inputs (bays, rate, hours, occupancy), when an owner moves a slider, then the monthly payout is shown as `bays × rate × hours × 30 × occupancy × (1 − 15%)`, together with the formula.
- **Proposed:** a lead form (name, phone, lot address, bays) that creates a CRM lead. The prototype has only the calculator, and supply is the business's top risk per the README.

## 4. Screens

| ID | Screen | Platform | Shows | Actions | Empty / loading / error | Stories |
|---|---|---|---|---|---|---|
| S01 | Find (search + list + map) | Both | Area, times, vehicle, lots, map pins, Park now strip | Search, sort, saved-only filter, open lot, open Park now | Skeleton rows; "No lots match. Try a later time or another area."; network error with retry | DRV-01, DRV-08 |
| S02 | Lot sheet + checkout | Both | Lot details, code, bill, saved profile, promo, payment methods | Save lot, apply promo, pay | Spinner on pay; inline errors; lot full fallback | DRV-02, DRV-04, DRV-05, DRV-06, DRV-07, GST-01 |
| S03 | Park now | Both | Code input, 3 nearest lots, duration chips | Enter or pick code, choose hours, continue | Unknown-code error | DRV-09 |
| S04 | Passes list | Both | Status, QR, details, WhatsApp number | Extend, cancel | "No passes yet…" empty state; offline banner in the app | DRV-10, DRV-11, DRV-12, GST-02 |
| S05 | Sign in (OTP) | Both | Phone, OTP | Request, verify, resend after 30 s | Wrong-code and rate-limit errors | DRV-03, GST-01, GST-02 |
| S06 | Monthly | Both | Lots with monthly price + GST | Request pass, pay link | No monthly lots in area | MON-01, MON-02, MON-03 |
| S07 | Account | Both | Phone, vehicles, payment preference, saved lots | Edit, delete account (DPDP) | – | DRV-07, DRV-08 |
| S08 | List your space | Web | Calculator, steps | Adjust sliders, **Proposed:** lead form | – | OWN-01 |
| S09 | Staff scan | App | Camera scanner, plate entry, today's arrivals | Check in, check out, set lot status | Offline queue count; red or green result | OPS-01, OPS-02, OPS-04, DRV-13 |
| S10 | Operator dashboard | Web | Occupancy, bookings, revenue, rate cards, monthly requests, payouts | Edit rates, approve monthly, export CSV | No data for period | OPS-03, OPS-04, OPS-05, MON-02 |
| S11 | Admin console | Web | Operators, lots, bookings, promos, audit log | Onboard, go live, refund, manage promos | – | ADM-01, ADM-02, ADM-03 |
| S12 | SEO area and lot pages | Web | Server-rendered lot list per area, prices, JSON-LD | Book CTA → S02 | – | DRV-01, DRV-02 |

## 5. API contract

Base path `/v1`. JSON throughout, with zod validation. Money is in paise. Every write that moves money takes an `Idempotency-Key` header.

| Method | Path | Auth | Request | Response | Errors | Idem. | Stories |
|---|---|---|---|---|---|---|---|
| POST | /auth/otp | public | `{phone}` | `{sent:true}` | 400 bad phone, 429 | – | DRV-03 |
| POST | /auth/verify | public | `{phone, otp}` | `{access, refresh, user}` | 401 wrong OTP | – | DRV-03, GST-01, GST-02 |
| POST | /auth/refresh | refresh | `{refresh}` | `{access}` | 401 | – | DRV-03 |
| GET | /lots/search | public | `?lat&lng&from&to&vehicle&sort` | `[{lot, distance_m, quote}]` | 400 invalid range | – | DRV-01 |
| GET | /lots/by-code/:code | public | – | `{lot}` | 404 | – | DRV-09 |
| GET | /lots/:id | public | `?from&to&vehicle` | `{lot, quote}` | 404 | – | DRV-02 |
| POST | /quotes | public | `{lot_id, from, to, vehicle, promo?}` | `{base, discount, fee, gst, total, promo_error?}` | 400, 404 | – | DRV-02, DRV-06 |
| POST | /bookings | driver/guest | `{lot_id, from, to, vehicle_id\|plate, promo?, source}` | `{booking, razorpay_order}` | 409 lot_full, 422 promo | ✓ | DRV-04, DRV-05, DRV-06, DRV-09, GST-01 |
| GET | /bookings | driver/guest | – | `[booking]` | – | – | DRV-10, GST-02 |
| POST | /bookings/:id/extend | owner | `{hours:1}` | `{booking, razorpay_order}` | 409 lot_full, 410 ended | ✓ | DRV-11 |
| POST | /bookings/:id/cancel | owner | – | `{booking, refund}` | 409 already started | ✓ | DRV-12 |
| POST | /webhooks/razorpay | signature | Razorpay event | 200 | 400 bad signature | event id | DRV-04, DRV-11, DRV-13, MON-02 |
| GET | /me | driver | – | `{user, vehicles, preferences}` | – | – | DRV-07 |
| PUT | /me/preferences | driver | `{default_vehicle_id, payment_method}` | `{preferences}` | 400 | – | DRV-07 |
| POST | /me/vehicles | driver | `{plate, kind}` | `{vehicle}` | 400 bad plate, 409 duplicate | – | DRV-07 |
| PUT/DELETE | /me/favourites/:lot_id | driver | – | 204 | 404 | – | DRV-08 |
| DELETE | /me | driver | – | 202 | – | – | DRV-03 (DPDP erasure) |
| POST | /monthly-passes | driver | `{lot_id, vehicle_id, starts_on}` | `{pass}` | 404, 409 no monthly | – | MON-01 |
| POST | /ops/monthly-passes/:id/approve | op admin | `{bay_label}` | `{pass, payment_link}` | 403, 409 | ✓ | MON-02 |
| POST | /ops/gate-events | op staff | `{lot_id, pass_code\|plate, direction, scanned_at}` | `{result, overstay?}` | 403 other lot, 404, 409 invalid | client event id | OPS-01, OPS-02, MON-03, DRV-13 |
| PUT | /ops/lots/:id/status | op staff | `{status}` | `{lot}` | 403 | – | OPS-04 |
| POST | /ops/lots/:id/rates | op admin | `{vehicle, hourly, daily_cap, monthly, valid_from}` | `{rate}` | 409 overlap | – | OPS-03 |
| GET | /ops/dashboard | op admin | `?lot_id&from&to` | `{occupancy, bookings, revenue}` | 403 | – | OPS-04, OPS-05 |
| GET | /ops/payouts | op admin | `?period` | `[payout]` (CSV with `Accept: text/csv`) | 403 | – | OPS-05 |
| POST | /admin/operators | platform admin | `{legal_name, pan, gstin?}` | `{operator}` | 400 bad PAN/GSTIN | – | ADM-01 |
| POST | /admin/lots | platform admin | lot fields | `{lot, code}` | 400, 409 code taken | – | ADM-01 |
| POST | /admin/refunds | platform admin | `{booking_id, amount}` | `{refund}` | 409 over-refund | ✓ | ADM-02 |
| POST | /admin/promos | platform admin | promo fields | `{promo}` | 400, 409 exists | – | ADM-03 |
| POST | /leads/owners | public | `{name, phone, address, bays}` | 201 | 400, 429 | – | OWN-01 (**Proposed**) |

## 6. Business rules

- **Quote.**
  - `hours` = started hours, minimum 1.
  - `base` = the sum over each 24 h block of min(hours in block × rate, 8 × rate).
  - `discount` = min(round(base × pct), cap).
  - `gst` = round((base − discount + fee) × 18%).
  - `total` = base − discount + fee + gst.
  - The fee is ₹15, never discounted.
  - The same function runs in the prototype, API, web and app, and is tested with these cases: 3 h at ₹40 → ₹159; 3 h with FIRST50 → ₹89; 10 h with FIRST50 → ₹277; 3 h with WEEKEND20 on a Saturday → ₹131.
- **GST.** Parking is SAC 9967 at 18%. CGST + SGST within Karnataka, IGST otherwise. Each payment gets an invoice in the series `BL/2026-27/000001`. Confirm with a CA.
- **Capacity.** Online capacity = floor(capacity × online_share). `book_bay()` locks the lot row; an unpaid hold expires after 10 minutes.
- **Cancellation.** A full refund (parking, fee and GST) up to the arrival time; no refund after it. Park now passes can't be cancelled once paid.
- **Extend.** 1 hour at the lot rate + GST, subject to capacity for the extra hour.
- **Overstay.** Each started hour after the end, at the lot rate + GST, collected at exit.
- **Monthly.**
  - Price + 18% GST.
  - Due by the 5th; reminders on the 3rd and 5th; paused after the 7th.
  - Six-month minimum for operator contracts (business term). There is no driver minimum.
- **Promos.** At most one code per booking, checked at quote time and again at booking time. `used_count` increments on capture, not on hold.
- **Payout.** Weekly (Monday) payout = gross parking − discount funded by the operator (none in the MVP; the platform funds promos) − 15% commission − TDS/TCS. Confirm the tax treatment with a CA.

## 7. Notifications

| Event | Channel | Template (draft) | When |
|---|---|---|---|
| Pass issued | WhatsApp (SMS fallback) | "Your Bayline pass {code} for {lot} ({lot_code}), {from}–{to}. Show this at the gate: {link}" | On payment capture |
| Expiry soon | Push + WhatsApp | "Your parking at {lot} ends at {to}. Extend 1 hour for {price}: {link}" | 15 min before end |
| Lot status change | WhatsApp | "{lot} is {status} right now. Your pass {code} is still valid / Find another lot: {link}" | On OPS-04, for passes in the next 3 h |
| Refund issued | WhatsApp | "Refund of {amount} for {code} started. It reaches you in 3–5 working days." | On refund created |
| Monthly approved | WhatsApp | "Your monthly bay {bay} at {lot} is approved. Pay {amount} incl. GST: {link}" | MON-02 |
| Monthly due | WhatsApp | "Monthly parking at {lot}: {amount} due by the 5th. Pay: {link}" | 3rd and 5th of the month |
| Monthly paused | WhatsApp | "Your monthly pass at {lot} is paused for non-payment. Pay to restore entry: {link}" | 8th |
| OTP | SMS | "{otp} is your Bayline code. Valid for 5 minutes." | DRV-03 |

WhatsApp templates need Meta approval as utility templates before launch. They are sent from n8n through the BSP.

## 8. Non-functional

- **Performance.** Search API p95 < 300 ms at 50 rps; lot page LCP < 2.5 s on a mid-range Android over 4G; checkout in under 60 s for a returning driver (the target from RECON).
- **Availability.** 99.5% monthly for the API. A pass must open offline in the app.
- **Security.**
  - OWASP Top 10.
  - zod validation on every input.
  - Rate limits: OTP 5 per hour per number and 20 per hour per IP; search 60 per minute per IP; booking 10 per minute per user.
  - Razorpay webhook signature verification.
  - JWT access tokens of 15 min and refresh tokens of 30 days, rotated.
  - No card data stored (Razorpay tokens only).
  - Secrets in Coolify env only.
- **Privacy (DPDP Act 2023).** Consent text at OTP sign-in for phone, plate and location; location only on tap; erasure via `DELETE /me`, which soft-deletes and scrubs PII within 30 days while keeping invoices as the law requires; a published privacy notice.
- **Audit log.** Every admin and operator write records actor, action, before and after, and time.
- **Backups.** Nightly `pg_dump` off-site, kept 14 days. RPO 24 h, RTO 4 h. **Proposed:** WAL archiving later for an RPO under 15 min, once bookings exceed 1,000 a day.
- **Observability.** Structured logs; Sentry for the API, web and app; an uptime check on `/health`.

## 9. Analytics events

| Event | Properties | Funnel |
|---|---|---|
| search_performed | area, from, to, vehicle, results_count | Search → book |
| lot_viewed | lot_id, position, distance_m, price | Search → book |
| park_now_opened / park_now_code_entered | method (typed or picked), valid | Park now |
| promo_applied | code, valid, error | Checkout |
| checkout_started | lot_id, source, prefilled | Checkout |
| payment_succeeded / payment_failed | method, amount, error_code, seconds_since_checkout_start | Checkout (target: under 60 s) |
| pass_viewed | offline | Retention |
| pass_extended / pass_cancelled | hours, amount | Retention |
| lot_saved | lot_id | Retention |
| monthly_requested / monthly_activated | lot_id | Monthly |
| owner_calc_used / owner_lead_submitted | bays, payout | Supply |

## 10. Milestones (reconciled with the README's 530 h)

| Pipeline stage | Covers README phases | Hours |
|---|---|---|
| 4 API | Data + auth (40), booking + payments (70), search backend (25), monthly backend (15) | 150 |
| 5 Web | Web app (70), SEO area pages (25) | 95 |
| 6 Mobile | Mobile app (110) | 110 |
| 7 Ops | Operator side (80), admin (30), monthly approvals (15) | 125 |
| 8 Deploy | From QA + release (20) | 20 |
| 9 Launch | Store release + QA (30) | 30 |
| **Total** | | **530** |

## 11. Open questions

| # | Question | Owner | Decision needed by |
|---|---|---|---|
| 1 | Final brand name after trademark search (Bayline is a working name) | Yuvaraj | Before stage 9 |
| 2 | Who funds promos, the platform or the operator? (The spec assumes the platform.) | Yuvaraj | Before stage 4 payout code |
| 3 | GST: is the platform fee taxed separately, and is TCS on operator payouts under Section 52? | CA | Before stage 4 invoicing |
| 4 | Online share default of 50% of capacity, or per lot? | Ops lead + first operators | Before ADM-01 |
| 5 | OTP provider: MSG91 or Twilio Verify (cost per OTP, DLT registration) | Tech lead | Before stage 4 |
| 6 | WhatsApp BSP: Interakt or Gupshup; template approval lead time | Marketing | Before stage 8 |
| 7 | Map tiles: MapTiler or Google Maps (cost at expected loads) | Tech lead | Before stage 5 |
| 8 | First 15–25 lots signed (supply risk from README) | Sales | Before stage 9 |
