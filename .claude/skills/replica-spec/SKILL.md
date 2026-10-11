---
name: replica-spec
description: Stage 3 of the Replica pipeline. Turn RECON.md, the prototype and schema.sql into a build spec (SPEC.md) with roles, user stories, screens, API contract, acceptance criteria and milestones. Use after /replica, or when the user asks for a spec or PRD for a replica build.
argument-hint: <product folder, e.g. parking-app>
---

# Replica spec

Read `RECON.md`, `README.md`, `schema.sql` and `prototype/index.html` in the product folder. The spec describes what is to be built; it must not invent features that none of those sources support. Anything new goes under "Proposed" with the reason.

## SPEC.md sections, in this order

1. **Scope.** MVP in, MVP out, one city.
2. **Roles and permissions.** A matrix of role × action (driver, guest, operator staff, operator admin, platform admin).
3. **User stories.** Grouped by journey. Each story has an ID (`DRV-01`) and **Given / When / Then** acceptance criteria that a test can check, including the error states and messages.
4. **Screens.** For each screen: purpose, the data it shows, the actions available, empty, loading and error states, and which stories it serves. Mark which screens are web only, app only, or both.
5. **API contract.** A table with method, path, auth role, request body, response, errors and idempotency key where money moves. Include payment-gateway webhooks.
6. **Business rules.** Pricing formula, daily cap, promo rules, GST, cancellation and refund, overstay, capacity holds and their expiry, monthly billing (due by the 5th, entry blocked after the 7th).
7. **Notifications.** Event → channel (WhatsApp, SMS, push) → template text → when it is sent.
8. **Non-functional.** Performance targets (search p95, checkout time), availability, security (OWASP top 10, rate limits, PII), DPDP Act consent and erasure, audit log, backups (RPO and RTO).
9. **Analytics events.** Event name, properties, and the funnel each one measures.
10. **Milestones.** Map the work to pipeline stages 4–9 with hour estimates, so the totals reconcile with the README.
11. **Open questions.** Each with its owner and the decision needed.

## Gate

- Every screen lists at least one story, and every story has testable criteria.
- Every endpoint maps to at least one story.
- Hour totals match the README, or the README is updated with the reason.
- Run a quick consistency check with grep: every story ID referenced in screens or endpoints exists.

Commit as "Spec: <product>" and stop for the user's go.
