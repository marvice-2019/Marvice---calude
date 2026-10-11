# Bayline: parking marketplace (web + mobile app)

A Parking.com-style product, built for India first, under its own brand. "Bayline" is a working name; change it before launch, after a trademark search.

## What's in this folder

| Path | What it is | Status |
|---|---|---|
| `prototype/index.html` | Clickable web prototype of the full driver flow: search by area and time, list + map, lot detail with GST bill, checkout with plate and UPI, passes with entry code, extend and cancel, monthly pass request, and an owner earnings calculator. Mobile-first; on phones it runs with a bottom tab bar, the same layout the native app will use. | Done. Sample data, no real payment |
| `schema.sql` | PostgreSQL 16 + PostGIS data model: users, vehicles, operators, lots, rate cards, bookings with a capacity-safe `book_bay()` function, Razorpay payments, GST invoices, monthly passes, gate events, operator payouts. | Tested on Postgres 16 (geo column stubbed; PostGIS not installed in the test box) |

## What we copy and what we don't

We copy the *product pattern*: search, compare, prepay, digital pass, monthly accounts, operator supply. We do **not** copy Parking.com's name, logo, text, images or code. Those belong to SP+ and copying them is trademark and copyright infringement. That would also get the app rejected under App Store and Play Store impersonation rules.

## The real risk is supply, not software

Parking.com works because SP+ already runs thousands of lots, so it has inventory on day one. A new app has none. Spend the first 6 weeks signing 15–25 lots in one city (malls, hospitals, office parks, apartment associations with idle bays) **before** building the full app. The owner calculator in the prototype is the sales tool for those meetings.

Second risk: gate integration. A booked driver must get in without arguing at the barrier. Start with QR scan by the attendant (cheap, works everywhere). Add ANPR cameras only at high-volume lots.

## Recommended stack (fits the existing Coolify VPS)

| Layer | Choice | Why |
|---|---|---|
| Web app | Next.js 15 (App Router) | SEO for "parking near X" pages, which bring in most of the free traffic |
| Mobile app | Expo (React Native), one codebase for iOS + Android | Shares types and API client with the web app |
| API + DB | Postgres 16 + PostGIS on Coolify, with a Node (Fastify) API | `schema.sql` drops straight in |
| Auth | Phone OTP (MSG91 or Twilio Verify) | Drivers in India sign in with mobile numbers |
| Payments | Razorpay Orders + Route (split payouts to operators) | UPI-first; Route handles operator settlement |
| Maps | MapLibre GL + MapTiler (or Google Maps if budget allows) | Cheaper per map load than Google at this volume |
| Notifications | WhatsApp pass via a BSP (Interakt/Gupshup) + n8n | Matches how Indian drivers already share passes |
| Operator app | Same Expo app, staff role: scan QR, mark in/out, see today's bookings | No separate app to maintain |

## Build plan and hours

| Phase | Scope | Hours |
|---|---|---|
| 1. Data + auth | Schema, migrations, OTP login, roles (driver / operator staff / admin) | 40 |
| 2. Search | Geo search, rate cards, availability, SEO area pages | 50 |
| 3. Booking + payments | Holds, Razorpay checkout and webhooks, refunds, GST invoices, extend/cancel | 70 |
| 4. Web app | Prototype → production Next.js | 70 |
| 5. Mobile app | Expo app: search, map, pay, passes, push and WhatsApp | 110 |
| 6. Operator side | Staff scan mode, lot dashboard, rate editor, payout reports | 80 |
| 7. Monthly passes | Requests, approvals, recurring billing (due by the 5th) | 30 |
| 8. Admin | Lot onboarding, KYC, disputes, refunds | 30 |
| 9. QA + store release | Device testing, App Store / Play review, load test | 50 |
| **Total** | MVP for one city | **530 h** (about 12–14 weeks with 2 developers + 1 designer part-time) |

## Monthly running cost (MVP, one city)

All prices are estimates as of Oct 2026. Check each one before quoting a client.

| Item | Est. cost |
|---|---|
| Existing 16 GB Coolify VPS | ₹0 extra if it has headroom; Postgres + API + Next.js need about 3–4 GB |
| Maps (MapTiler Flex or similar) | ₹2,000–₹8,000 / month, depending on map loads |
| OTP SMS (about ₹0.20–0.25 per OTP) | ₹1,000–₹3,000 |
| WhatsApp utility messages via a BSP | ₹1,000–₹4,000 |
| Razorpay | About 2% per transaction, plus 18% GST on the fee. Comes out of each transaction, not a fixed cost |
| Apple Developer / Google Play | US$99 per year / US$25 one-time |
| Backups (off-site, e.g. S3-compatible) | ₹500 |
| **Fixed total** | **About ₹5,000–₹16,000 / month + gateway fees** |

## Revenue model (per booking)

From the prototype's sample numbers: a 3-hour car booking at ₹40/hr is ₹120 parking + ₹15 platform fee + ₹24 GST = ₹159 total. Platform income = ₹15 fee + 15% commission on ₹120 (₹18) = ₹33 per booking. Razorpay takes about ₹3.75 of that (2% of ₹159 plus GST on the fee), leaving ₹29.25. Break-even on ₹16,000 fixed cost is about 550 bookings a month, roughly 18 a day across the city.

## Flags for a CA / lawyer

- GST treatment of parking (SAC 9967) and the platform fee. Also whether Section 9(5) or TCS rules for e-commerce operators apply to payouts.
- TDS (194-O) on operator payouts.
- Operator agreement: liability for vehicle damage or theft, cancellation and refund policy, bay availability SLA.
- DPDP Act 2023: consent for phone, plate and location data; erasure flow (`users.deleted_at` is in the schema).

## Run the prototype

Open `prototype/index.html` in any browser. No build step. Bookings are saved in your browser only.
