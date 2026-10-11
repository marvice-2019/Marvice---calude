---
name: replica
description: Build our own-brand version of an existing website and mobile app — a clickable mobile-first prototype, a tested Postgres data model, and a costed build plan — from the product's URL or a /replica-recon report. Use when the user says /replica, "clone this app", "build something like X", or wants to compete with an existing product.
argument-hint: <website URL or path to RECON.md> [market, e.g. India / UK / US]
---

# Replica

Turn an existing product into our own buildable version. Deliver working files, not a plan about files.

## Inputs

`$ARGUMENTS` holds a product URL or a path to a recon report, plus an optional target market.

- If no `RECON.md` exists for this product, run the `replica-recon` skill first, or do a short recon inline (store lookup, top features, review complaints) and say so.
- Default market: India (INR, 18% GST, UPI, WhatsApp, Bengaluru sample data). State that assumption in one line and switch if the user names another market.

## Hard rules

- **Never copy the brand.** No name, logo, copy, images, screenshots or code from the original. That is trademark and copyright infringement and gets the app rejected by both app stores. Use a neutral working name and tell the user to run a trademark search before launch.
- Use real place names for sample data, but invented operators and prices, labelled as samples. Never present invented data as real.
- Note: verify before claiming done. Run the code, recompute every money figure, test the schema.

## Deliverables

Put everything in `<product>-app/` at the repo root (e.g. `parking-app/`).

1. **`prototype/index.html`.** One self-contained, mobile-first clickable prototype of the core user journey, from discovery through payment to the post-purchase state. It should also include the account view, the recurring or subscription flow if the product has one, and the supply-side pitch (seller, owner or partner) for marketplaces.
   - Load the `artifact-design` skill before writing it. Give the product its own visual identity drawn from the subject, with light and dark themes.
   - Use a bottom tab bar on phones, so the same layout serves as the native app spec.
   - Money is shown with tax separately (GST 18% for India). Validate inputs the way the market expects (plate formats, phone numbers, postcodes).
   - Fix every pain theme from the recon in the design: for example a checkout with no re-entry, guest purchase that keeps the pass, and clear time pickers.
   - Extract the script and run `node --check` on it, then run the pricing function on 2–3 sample inputs and check the totals by hand.
   - Publish it as an Artifact and give the user the link.
2. **`schema.sql`.** PostgreSQL 16 data model: users and roles, the core entities, transactions with concurrency-safe capacity or inventory control, payments (Razorpay for India, Stripe elsewhere), tax invoices, payouts for marketplaces, and indexes. Money is stored in minor units.
   - Validate it on a throwaway Postgres: `initdb` into the scratchpad and connect over TCP on `127.0.0.1` (the Unix socket path there is too long). Stub any extension that isn't installed, such as PostGIS, and say so. Run a smoke test that proves the concurrency guard rejects an over-booking.
3. **`README.md`.** Verdict, what's in the folder, what we copy and what we don't, the real business risk (usually supply or distribution, not software), the recommended stack on the user's Coolify VPS (Next.js web, Expo app, Postgres, n8n), a build plan with hours per phase, monthly running cost with GST and gateway fees shown separately, unit economics and break-even (formula shown), and flags for a CA or lawyer.

## Finish

Commit on the working branch and push. Reply with:

- the prototype link
- what was verified and what wasn't
- the biggest risk and the first move against it
- hours and monthly cost
- one next action

Then offer to run `replica-recon` gap fixes into the prototype if a recon exists.
