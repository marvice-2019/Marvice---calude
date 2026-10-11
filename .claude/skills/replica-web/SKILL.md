---
name: replica-web
description: Stage 5 of the Replica pipeline. Build the production web app (Next.js) for a replica product from SPEC.md, the prototype's design and the API. Use when the user says go for the web stage or asks to build the replica website.
argument-hint: <product folder>
---

# Replica web

Build `<product>-app/web/` with Next.js (App Router, TypeScript). Port the prototype's visual identity: its tokens, typefaces, light and dark themes, and mobile-first layout with a bottom tab bar on phones. Do not redesign it.

## Build

- Pages in SPEC section 4 order, starting with search → lot → checkout → pass, then passes, monthly, account, and the list-your-space page.
- Server-render the public SEO pages: city, area, venue and lot pages, with JSON-LD for `ParkingFacility` and `Offer`, a sitemap and canonical URLs. These are the free traffic channel.
- An API client generated from the API's zod/OpenAPI schemas. No hand-written fetch shapes.
- The Razorpay checkout script loads only on the checkout page. Handle success, failure, user cancel and the webhook arriving late; the pass page polls until the pass is issued.
- Every state from the spec is covered: empty, loading, error and offline.
- Accessibility: keyboard paths, visible focus, labels on form fields, 44 px touch targets, and support for reduced motion.

## Tests

- Playwright happy path at 390 px and 1280 px: search → lot → checkout (against a stubbed gateway) → pass visible.
- Playwright for Park now and for a promo code.
- Lighthouse on the lot page: run it and report the scores. Fix anything under 90 for performance or accessibility before claiming done.

## Gate

`npm run build`, lint, type-check and Playwright all green, with the output shown.
Commit as "Web: <product>" and stop for the user's go.
