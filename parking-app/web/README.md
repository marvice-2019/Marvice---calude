# Bayline web (stage 5)

Next.js 16 App Router, React 19, TypeScript strict, `output: standalone`. It talks to `../api` through its own route handlers, so session tokens stay in httpOnly cookies and never reach page JavaScript.

## Design

The look is "dusk on the ring road": a deep-blue dusk hero with moving tail-light trails, white road-sign cards, and kerb-yellow for lot codes and the Park now call to action. Type is Archivo (condensed widths, like road signs) for headings, Atkinson Hyperlegible for body text, and IBM Plex Mono for codes and plates. Every colour is a token in `app/globals.css`, with a full dark theme that follows the system setting. Motion (staggered card rise, trails, live pulse, skeleton shimmer) runs only when the visitor hasn't asked for reduced motion.

## Pages

| Route | What it does | Stories |
|---|---|---|
| `/` | Hero, destination search with recents, arrival presets, duration, vehicle, filters, sort, live results | DRV-01, DRV-15, DRV-16 |
| `/lots/[id]` | Server-rendered lot page with ParkingFacility + Offer JSON-LD, bill with GST, inline OTP, promo, checkout | DRV-02, DRV-04–07, GST-01 |
| `/park-now` | Digits-only lot code → hours → pay | DRV-09 |
| `/passes` | QR passes (saved for offline), polling until the webhook issues the pass, +1 hour, cancel, Mark my spot | DRV-10, DRV-11, DRV-12, DRV-14 |
| `/valet` | Live tracker, tip chips, validation code, nearby desks with GST | VAL-02–05 |
| `/monthly` | Monthly bay request | MON-01 |
| `/account` | Vehicles, preferences, data export, delete, sign out | ACC-01, ACC-02 |
| `/list-your-space` | Owner lead form | OWN-01 |
| `/parking/[slug]` | SEO landing page per area, mall or stadium, with ItemList JSON-LD | SEO |
| `/sitemap.xml`, `/robots.txt` | Generated from the API's destinations | SEO |

The Razorpay checkout script loads only when someone presses Pay (`lib/pay.ts`).

## Run locally

```sh
# API on :3999 with the fake gateway, then seed sample lots (invented operators and prices)
cd ../api && npm ci && npm run build && node dist/src/migrate.js
psql "$DATABASE_URL" -f seed/dev.sql
PORT=3999 node dist/src/server.js > api.log &

# web on :3001
cd ../web && npm ci
API_URL=http://127.0.0.1:3999 RAZORPAY_WEBHOOK_SECRET=<same as API> DEV_FAKE_PAY=1 npm run build && npm start
```

| Variable | Purpose |
|---|---|
| `API_URL` | Base URL of the API (server side only) |
| `SITE_URL` | Public URL, used for canonical links and the sitemap |
| `DEV_FAKE_PAY` | `1` enables `/api/dev/pay` and the demo banner. Never set it in production |
| `RAZORPAY_WEBHOOK_SECRET` | Only needed with `DEV_FAKE_PAY=1`, to sign the fake webhook |

## Checks

- `npm run lint`, `npm run typecheck`, `npm run build`
- `npm run smoke`: 45 checks against a running API and web app, without a browser (pages, SEO output, BFF, sign-in, promo, book → pay → pass, webhook replay, Park now, spot, extend, cancel, valet). Needs `WEB_URL` and `API_LOG` (the API's stdout, to read the console OTP).
- `e2e/flows.spec.ts`: browser tests at 390 px and 1280 px (search → lot → checkout → pass, promo, bad promo, Park now, unknown code, no horizontal scroll). They run in CI (`.github/workflows/parking-web.yml`); this build session can't launch a browser test runner.

The API client in `lib/types.ts` is hand-written because the API has no OpenAPI document yet; the smoke script checks the shapes against the live API so drift fails the build.
