# wa-crm — WhatsApp CRM SaaS

Multi-tenant WhatsApp Business platform: shared live inbox, templates, broadcast campaigns, chatbot
flows, team roles, Razorpay billing with GST invoices, and a super-admin API. Built for one VPS on Coolify.

| Part | Folder | Stack |
| --- | --- | --- |
| API + background worker | `api/` | Node 22, Fastify 5, Postgres 16, Socket.io |
| Web app | `web/` | Next.js 15, React 19, Tailwind 4, React Flow 12 |
| Deployment | `docker-compose.yml` | Postgres + API + web |

## Deploy on Coolify (one VPS)

1. **Domains.** Point two DNS records at the VPS, for example `app.yourdomain.com` (web) and
   `api.yourdomain.com` (API).
2. **New resource.** In Coolify: *New Resource → Docker Compose*, this Git repository, base directory
   `/wa-crm`, compose file `docker-compose.yml`.
3. **Domains in Coolify.** Service `web` → `https://app.yourdomain.com` (port 3100). Service `api` →
   `https://api.yourdomain.com` (port 3000). Coolify issues the TLS certificates.
4. **Environment variables** (Coolify → Environment Variables):

   | Variable | Value |
   | --- | --- |
   | `POSTGRES_PASSWORD` | `openssl rand -base64 24` |
   | `JWT_SECRET` | `openssl rand -base64 48` |
   | `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` (keep a copy: losing it makes stored WhatsApp tokens unreadable) |
   | `META_APP_SECRET` | Meta app → App settings → Basic → App secret |
   | `META_WEBHOOK_VERIFY_TOKEN` | any random string, also pasted into Meta |
   | `META_APP_ID`, `META_ES_CONFIG_ID` | app ID, and the Embedded Signup configuration ID from Meta app → Facebook Login for Business → Configurations. Leave empty until Tech Provider review passes; the "Connect with Facebook" button stays hidden. |
   | `WEB_URL` | `https://app.yourdomain.com` |
   | `API_URL` | `https://api.yourdomain.com` |
   | `APP_NAME` | your product name (shown in the app) |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | from Razorpay (billing stays off until set) |
   | `SUPPLIER_STATE_CODE` | your GST state code, `29` = Karnataka |

5. **Deploy.** Migrations run automatically when the API starts.
6. **Super-admin.** In Coolify open a terminal on the `api` container and run
   `npm run create-admin:prod -- you@yourdomain.com "Your Name"`. It prints a password once.
7. **Meta webhook.** Meta app → WhatsApp → Configuration: callback URL
   `https://api.yourdomain.com/webhooks/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN`, subscribe to
   `messages` and `message_template_status_update`.
8. **Razorpay webhook.** Razorpay → Webhooks: `https://api.yourdomain.com/webhooks/razorpay`, secret =
   `RAZORPAY_WEBHOOK_SECRET`, events `subscription.activated`, `subscription.charged`,
   `subscription.halted`, `subscription.cancelled`. Create plans in Razorpay and set each plan's
   `razorpay_plan_id` through the admin API.
9. **Backups.** Coolify → the Postgres service → Backups: daily, kept 14 days, to S3-compatible storage.

Capacity estimate for the 16 GB VPS: about 50 active tenants before a second server is worth it. Load-test
broadcasts before selling large plans.

## Before the first real client

- Meta Business Verification for your company, then Tech Provider app review, so clients can connect
  through Embedded Signup (set `META_APP_ID` and `META_ES_CONFIG_ID`, and add your app domain under
  Facebook Login for Business → Allowed domains). Until then, numbers are connected manually in Settings
  with a system-user token.
- Privacy policy, terms and a data processing agreement (India DPDP Act). Have a lawyer review them.
- Confirm the current Graph API version and set `META_GRAPH_VERSION`.

## Known limits

- Flow webhook steps block localhost and private IP addresses, but a public hostname that resolves to a
  private address is not caught. Allow only trusted URLs until DNS-pinned requests are added.
- The web app keeps the session token in the browser (12-hour expiry) under a strict Content Security
  Policy. Moving to an httpOnly cookie session is planned.

## Develop and test

```bash
cd api && npm ci && TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
cd web && npm ci && npm run build
```
