---
name: replica-pipeline
description: Run the full Replica pipeline step by step, from competitor recon to a launched own-brand website and mobile app, stopping for the user's go after every stage. Use when the user says "/replica-pipeline", "run all replica skills", "replica step by step", or wants to take a /replica prototype to production.
argument-hint: <product folder, e.g. parking-app> [stage to start from]
---

# Replica pipeline

One stage per turn. Each stage is its own skill, writes into `<product>-app/`, commits, then **stops** and asks the user for "go" before the next stage. Never run two stages in one turn; the user redirects between them.

## Stages and gates

| # | Skill | Produces | Gate (must pass before "done") |
|---|---|---|---|
| 1 | `replica-recon` | `RECON.md` | Every line marked [V]/[E]/[GAP], sources dated |
| 2 | `replica` | `prototype/`, `schema.sql`, `README.md` | Script parses, money math hand-checked, schema smoke test green |
| 3 | `replica-spec` | `SPEC.md` | Every screen and endpoint has acceptance criteria; open questions listed |
| 4 | `replica-api` | `api/` (Fastify + Postgres) | Migrations apply, test suite green, booking race test proves no over-booking |
| 5 | `replica-web` | `web/` (Next.js) | Build passes, Playwright happy path green at phone and desktop widths |
| 6 | `replica-mobile` | `mobile/` (Expo) | Type-check and tests green, runs in Expo web preview |
| 7 | `replica-ops` | operator mode in web + mobile | Scan-to-check-in and payout report tested |
| 8 | `replica-deploy` | `deploy/<product>/` for Coolify | Compose builds locally, health checks pass, backups and secrets documented |
| 9 | `replica-launch` | `LAUNCH.md` + store listings | Store copy, privacy policy, data-safety answers, launch checklist |

## How to run

1. Read `<product>-app/` to find the last completed stage. The commit log and the files present tell you.
2. Load the next stage's skill with the Skill tool and follow it exactly.
3. At the end of the stage, reply with:
   - what was built
   - each gate's result, with command output for pass or fail
   - what's still open
   - the next stage, then "Say go for stage N."
4. If a gate fails, fix it within the stage or report it. Never advance past a red gate.

## Standing rules (all stages)

- Own brand only. Never copy the original's name, logo, copy or code.
- Default stack: Postgres 16, Fastify (Node 22, TypeScript), Next.js, Expo, Razorpay, n8n for notifications, one Coolify VPS with 16 GB RAM. Say when something won't fit.
- Production defaults: input validation at the boundary, auth with role-based access, secrets in env only, structured logs, error handling, indexes, rate limits.
- Money in paise and integer math only; show GST separately.
- Commit each stage on the working branch with a clear message, and push.
