---
name: replica-api
description: Stage 4 of the Replica pipeline. Build the backend API (Fastify + TypeScript + Postgres) from SPEC.md and schema.sql, with auth, payments, webhooks and tests. Use when the user says go for the API stage or asks to build the replica backend.
argument-hint: <product folder>
---

# Replica API

Build `<product>-app/api/` from SPEC.md section 5 (API contract) and section 6 (business rules).

## Build order

Data first, then auth, then the core flow, then everything else.

1. **Project.** Node 22, TypeScript strict, Fastify, `pg` with SQL migrations (node-pg-migrate) taken from `schema.sql`, zod schemas for every request and response, and pino logs. A `.env.example` lists every variable with no real values.
2. **Auth.** Phone OTP login through a provider interface (MSG91 or Twilio Verify), with a console stub in dev. JWT access token plus a refresh token, and role guards built from the SPEC role matrix.
3. **Core flow.** Search (geo plus rate card), quote (the same formula as the prototype, in paise), hold (via `book_bay`), Razorpay order, webhook (verify the signature, then make it idempotent), pass issue, extend, cancel and refund.
4. **Remaining endpoints** in SPEC order: monthly passes, promos, favourites, operator, admin.
5. **Rate limits** on OTP, search and payment endpoints. Turn on CORS for the web origin only.

## Tests (vitest, real Postgres)

- A unit test of the pricing function with the same cases as the prototype, which must give identical totals.
- An integration test per story's acceptance criteria.
- A **race test**: N concurrent holds on a lot with capacity 1 produce exactly 1 success.
- A webhook replay test: the same event twice produces one payment.
- Security tests: a driver can't read another driver's booking, and staff can't act on another operator's lot.

## Gate

`npm run build && npm test` green, with the output shown. Migrations apply on an empty database. Report coverage of the stories (story ID → test).
Commit as "API: <product>" and stop for the user's go.
