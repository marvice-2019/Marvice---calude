# n8n: booking notifications

`hydra-booking-notify.json` receives every booking event from the website and sends WhatsApp messages to the hosts and the guest, with Telegram as the fallback. The website never talks to WhatsApp directly.

## Flow

1. **Booking webhook** (`POST /webhook/hydra-booking`, raw body kept for the signature check).
2. **Verify signature**: HMAC-SHA256 of `"<t>.<raw body>"` with `HYDRA_WEBHOOK_SECRET`, timing-safe compare, rejects anything older than 5 minutes.
3. Bad signature → **401** and stop. Good → **200** straight away, then work continues. The site counts any non-2xx as a failure and retries 3 times (2 s, 10 s, 30 s), then writes `webhook.failed` to the admin audit log.
4. **Build messages**: one WhatsApp template per host number, plus the guest's template for `created`, `confirmed` and `cancelled`.
5. **Send WhatsApp**: Cloud API, 3 tries 5 s apart. Any message that still fails goes to the error output.
6. **Telegram fallback**: posts the host alert (or "couldn't WhatsApp the guest, call them") to the hosts' Telegram group. Also used when no host numbers are set.

Events: `booking.created`, `booking.confirmed`, `booking.cancelled` (`cancelled_by`: guest or staff), `booking.no_show`, `booking.completed`. Payload: `{ id, type, occurred_at, booking: { ref, status, table, zone, service_date, time, starts_at, ends_at, guests, name, phone_e164, notes } }`.

## Set up (once)

**n8n environment** (Coolify → n8n service → Environment):

| Variable | Value |
|---|---|
| `HYDRA_WEBHOOK_SECRET` | Same value as the website's `N8N_WEBHOOK_SECRET` (`openssl rand -hex 32`) |
| `WA_PHONE_NUMBER_ID` | WhatsApp Manager → API setup → Phone number ID |
| `HOST_WHATSAPP_NUMBERS` | Comma-separated host numbers, E.164, e.g. `+919xxxxxxxxx,+918xxxxxxxxx` |
| `TELEGRAM_HOST_CHAT_ID` | The hosts' Telegram group id (negative number) |
| `NODE_FUNCTION_ALLOW_BUILTIN` | `crypto` (the Code node needs it for HMAC) |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` (the nodes read the variables above) |

**Credentials** in n8n (then open the two nodes and select them; the JSON has `REPLACE_ME` placeholders):

- *WhatsApp Cloud API (Bearer)*: type **Header Auth**, name `Authorization`, value `Bearer <permanent system-user token>` with `whatsapp_business_messaging` permission (Meta Business Settings → System users).
- *Hydra Telegram bot*: type **Telegram API**, token from @BotFather. Add the bot to the hosts' group.

**Website env**: `N8N_BOOKING_WEBHOOK_URL=https://<n8n-domain>/webhook/hydra-booking`, `N8N_WEBHOOK_SECRET=<same secret>`.

**WhatsApp templates** (WhatsApp Manager → Message templates, category **Utility**, language English). Names and variable order must match exactly:

| Template | Body (variables in order) |
|---|---|
| `hydra_host_alert` | `{{1}}` (the one-line alert text) |
| `hydra_booking_received` | `Hi {{1}}, we've got your table request {{2}} for {{3}}, table {{4}}, {{5}} guests. We'll confirm shortly. Hydra Club & Kitchen` |
| `hydra_booking_confirmed` | `Hi {{1}}, your table is confirmed. Ref {{2}}, {{3}}, table {{4}}, {{5}} guests. Show this ref at the door. See you tonight.` |
| `hydra_booking_cancelled` | `Hi {{1}}, booking {{2}} for {{3}} (table {{4}}, {{5}} guests) is cancelled. Book again anytime on our site.` |

## Before go-live: test it

1. Import the JSON, set env and credentials, **activate**.
2. Make a real booking on staging with your own number. Expect: host WhatsApp, guest WhatsApp, 200 in n8n's execution list.
3. Send the same request with a wrong secret (or replay one older than 5 minutes) and check you get a 401 with no messages sent.
4. Revoke the WhatsApp token temporarily and check the Telegram group gets the fallback.

## Things to know

- **WhatsApp can't post into a normal WhatsApp group through the Cloud API**, so "the host group" is each host's number getting the alert. If the team prefers one shared thread, make the Telegram group the primary channel instead (free, real groups). Ask Hydra which they want.
- Business-initiated messages need approved templates and are billed per message by Meta (utility category, India). Check the current rate card in WhatsApp Manager before launch. At ~30 bookings a night with 3 hosts that is roughly 120–150 messages a night.
- Not yet run against a live n8n: the JSON was written for n8n 1.x node versions (Webhook v2, Code v2, IF v2, HTTP Request v4.2, Telegram v1.2). If an import shows a node as unknown or outdated, open it and re-select the same options.
