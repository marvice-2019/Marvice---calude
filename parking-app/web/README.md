# Bayline web

Next.js 15 (App Router, TypeScript, strict) for drivers, plus the public SEO pages. It implements the driver screens of `../SPEC.md` §4 (S01–S08, S12) on the API in `../api`. Operator and admin screens (S09–S11) come in stage 7. The look is the prototype's: same tokens, typefaces, light and dark themes, and bottom tab bar on phones.

## Run locally

```bash
# 1. API with sample data (see ../api/README.md for Postgres + PostGIS)
cd ../api && npm ci && npm run build && npm run migrate
psql "$DATABASE_URL" -f seed/dev-seed.sql      # 8 sample Bengaluru lots, FIRST50 and WEEKEND20
WEB_ORIGIN=http://localhost:3001 npm start      # http://localhost:3000; the OTP is printed in its log

# 2. Web
cd ../web && npm ci
NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev   # http://localhost:3001
```

With no Razorpay keys, the API uses its fake gateway and the web shows a **Test payment** dialog instead of Razorpay. A pass is issued only when the API receives a signed `payment.captured` webhook, exactly as in production; the e2e helper `capture()` in `e2e/helpers.ts` shows how to send one.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | build time | Public API base URL the browser calls. Must match the API's `WEB_ORIGIN` CORS setting. |
| `API_INTERNAL_URL` | runtime | Optional private URL for server-side fetches (e.g. `http://api:3000` inside Docker). |
| `NEXT_PUBLIC_SITE_URL` | build time | Canonical URLs, sitemap and JSON-LD, e.g. `https://bayline.in`. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | build time | Support number shown on passes, digits only with country code. Optional. |
| `NEXT_PUBLIC_SAMPLE_DATA_NOTICE` | build time | Set to `off` to hide the "Sample lots and prices" banner at launch. |

`NEXT_PUBLIC_*` values are baked in at build time; rebuild after changing them.

## Checks

```bash
npm run build && npm run lint && npm run typecheck
npm run test:e2e        # needs Postgres 16 + PostGIS on TEST_PG_URL (default postgres://postgres@127.0.0.1:54329/postgres)
CHROME_PATH=... npm run lighthouse -- <url> [url...]   # fails under 90 for performance or accessibility
```

`test:e2e` builds the app, starts the **standalone** server (the same one the Docker image runs), and starts the API on a fresh `bayline_e2e` database seeded from `../api/seed/dev-seed.sql` (`e2e/start-api.mjs`). Every test runs at 390 px and 1280 px.

| Test | Stories |
|---|---|
| happy path: search → lot → checkout → pass | DRV-01, DRV-02, DRV-04, GST-01, DRV-10 |
| Park now: lot code from the board, live pass | DRV-09, DRV-12 (no cancel) |
| promo code: errors, FIRST50 carried into the payment | DRV-06 |
| failed and cancelled payments | DRV-04 |
| search validation and public SEO lot page | DRV-01, S12 |

Stage 5 results (11 Oct 2026), Lighthouse mobile profile:

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/parking/bengaluru/lot/BLR101` (public lot page) | 97 | 100 | 100 | 100 |
| `/lot/<id>` (checkout) | 96 | 100 | 100 | 63 (`noindex` on purpose) |
| `/?area=mg-road` (Find) | 92 | 100 | 100 | 100 |

## How it is built

- **API contract.** `lib/contract.ts` holds zod schemas for every response the web uses; `lib/api.ts` validates each response against them, so contract drift fails loudly. They are written by hand to mirror the API, not generated (see "Deviations").
- **Money.** Every amount on screen comes from the API in paise. The browser never recomputes a price; it only formats one.
- **Payments.** Razorpay's `checkout.js` loads only when a payment opens (checkout, or extending a pass). The pass page polls `GET /v1/bookings` every 2 s until the webhook confirms, and gives a clear "still confirming" message after 90 s.
- **SEO pages.** `/parking/bengaluru`, `/parking/bengaluru/<area>`, `/parking/bengaluru/venue/<venue>` and `/parking/bengaluru/lot/<code>` are server-rendered, cached for 5 minutes, and carry canonical URLs. Lot pages include `ParkingFacility` + `Offer` JSON-LD. `sitemap.xml` lists every live lot. Checkout, passes and account pages are `noindex`. If the API is down, these pages still render and show "live prices unavailable".
- **Offline.** Passes are cached on the device after each load; an offline banner shows, and extend and cancel are disabled while offline.
- **Map.** A schematic map that plots each lot at its true position (from the API's coordinates) with 1, 2 and 3 km rings. Real map tiles wait on SPEC open question #7.

## Deviations from the stage-5 brief

- **The API client is hand-written, not generated** from OpenAPI, because the API doesn't publish a schema yet. Every response is still validated at runtime against `lib/contract.ts`. Fix in stage 6: move the schemas into a shared package that the API, web and mobile all import.
- **Map tiles** are not used yet (SPEC open question #7). The schematic map is truthful but shows no roads.
- **The monthly payment link page (`/pay/<order>`)**, which MON-02's WhatsApp message links to, needs an order-lookup endpoint. Built in stage 7 with the operator approval flow.
- **Payment method is not shown on passes**, because the API's booking view doesn't return it.
- **The monthly request form has no name field**: the API doesn't store one, so asking would be pointless.
- **One design token changed:** light-mode `--ok` went from `#1F8A4C` to `#1B7F46`. The original is 4.4:1 on white, under WCAG AA's 4.5:1.
- **Lighthouse flags bf-cache** on dynamic pages (they're sent `no-store`). This is expected for personalised pages, and it has no score impact.
