# wa-crm API

Multi-tenant WhatsApp CRM backend: Node 22, Fastify 5, Postgres 16. This is phase 1 of the build plan:
tenants and login, contacts, the WhatsApp webhook, the shared inbox and replies.

## What works now

| Area | Endpoints |
| --- | --- |
| Signup and login | `POST /auth/signup`, `POST /auth/login` (JWT, 12 h, 10 tries per minute per IP) |
| Contacts | `GET /contacts?search=&page=`, `POST /contacts` |
| WhatsApp number | `POST /waba/connect` (owner or admin; token stored encrypted) |
| Meta webhook | `GET /webhooks/meta` (verification), `POST /webhooks/meta` (signed messages and statuses) |
| Inbox | `GET /conversations`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages` |
| Platform admin | `POST /admin/auth/login`; `/admin/plans`, `/admin/tenants`, `/admin/tenants/:id/impersonate` (15 min), `/admin/stats`, `/admin/audit-logs`. Create one with `npm run create-admin -- email name` (`create-admin:prod` in the container) |
| Health | `GET /health` |

How it keeps tenants apart: every tenant table has Postgres row-level security. Tenant requests run as
role `app_tenant` with `app.tenant_id` set, so even a query with no `WHERE` clause sees one tenant's rows.
Agents only see conversations assigned to them.

## Run locally

```bash
cp .env.example .env          # fill in the values
npm install
npm run migrate
npm run dev
```

Tests need a Postgres 16 server where they can create throwaway databases:

```bash
TEST_DATABASE_URL="postgres://postgres@localhost:5432/postgres" npm test
```

## Deploy on Coolify

1. In Coolify, add a **PostgreSQL 16** resource. Note its internal connection URL.
2. Add a new resource from this Git repository, build pack **Dockerfile**, base directory `/wa-crm/api`.
3. Set the environment variables from `.env.example`. Generate secrets with
   `openssl rand -base64 48` (JWT) and `openssl rand -base64 32` (token key).
4. Port 3000, health check path `/health`. Attach your domain, for example `api.yourdomain.com`.
5. Deploy. Migrations run automatically on start.
6. In the Meta app, set the webhook URL to `https://api.yourdomain.com/webhooks/meta`, use
   `META_WEBHOOK_VERIFY_TOKEN` as the verify token, and subscribe to the `messages` field.
7. Turn on Coolify's scheduled database backups (daily) before any client data goes in.

## Next phases

1. Message templates (create, sync approval status from Meta) and sending a template outside the 24-hour window.
2. Broadcast campaigns: Redis + BullMQ queue, per-number rate limits, delivery stats.
3. Socket.io for live inbox updates; agent assignment and notes.
4. Plan limits and Razorpay subscriptions with GST invoices.
5. Flow builder (React Flow editor + run engine), keyword triggers, working-hours replies.
6. Next.js web app for the user, agent and super-admin panels.
