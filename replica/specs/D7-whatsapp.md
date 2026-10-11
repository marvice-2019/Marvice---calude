# D7: automatic WhatsApp confirmations and reminders (Meta Cloud API)

Status: plan, waiting on Meta approval and four decisions (end of file). Written 2026-10-11.

## Verdict

Send WhatsApp from **one Hourhand-owned business number**, through Meta's Cloud API directly (no BSP), using
**utility templates** with the host's name in the message. Guests opt in on the booking form. A booking costs about
₹0.27 in Meta fees (two messages), so a host with 100 bookings a month costs about ₹27. Build: 14–18 hours. This
closes the last must-have (text reminders) in the feature matrix.

## What the guest gets

| Message | When | Template (utility) |
| --- | --- | --- |
| Confirmation | on booking (and on paid confirmation) | `hh_booking_confirmed` |
| Reminder | 24 hours before (skipped if booked inside 24 h) | `hh_booking_reminder` |
| Cancelled / moved | when the host or guest cancels or reschedules | `hh_booking_changed` |

Each template carries: guest first name, host name, event name, date and time in the guest's zone, and the manage link
as a URL button (`https://hourhand.cloud/b/{token}`). Extra guests (D2) get nothing on WhatsApp: there is no phone
for them and the manage link must not reach them.

Draft English bodies (wording is strictly transactional so Meta keeps them in the utility category):

- Confirmed: "Hi {{1}}, your {{2}} with {{3}} is booked for {{4}}. Use the button to reschedule or cancel."
- Reminder: "Hi {{1}}, a reminder: {{2}} with {{3}} is on {{4}}. Use the button to reschedule or cancel."
- Changed: "Hi {{1}}, your {{2}} with {{3}} has changed: {{4}}. Use the button for details."

Each template is submitted once per language. Launch with English and Hindi (6 approvals). Tamil, Telugu and
Kannada follow after the native-speaker review of the D3 drafts (9 more).

## Data model (migration 0024)

- `invitees.whatsapp_opt_in_at timestamptz`: set when the guest ticks "Send me updates on WhatsApp" next to the phone
  field. No tick, no WhatsApp. WhatsApp's Business Policy requires opt-in before a business starts a chat.
- `whatsapp_opt_outs (phone text primary key, opted_out_at timestamptz not null)`: a guest who replies STOP is never
  messaged again, for any host.
- `notifications`: already allows `channel = 'whatsapp'`. Dedupe keys `booking:<id>:wa:confirmed`,
  `booking:<id>:wa:reminder:1440`, `booking:<id>:wa:changed:<event>`. `provider_message_id` holds Meta's `wamid`.
- Monthly cap per host: count of `whatsapp` notifications sent this calendar month (IST) against a plan limit.
  Over the cap, WhatsApp is skipped (`status = 'skipped'`, reason recorded) and email still goes.

## Flow

1. **Queue:** where guest emails are queued today, also queue WhatsApp rows when the guest gave a phone, opted in,
   is not in `whatsapp_opt_outs`, and the host's plan includes WhatsApp.
2. **Send:** the existing job runner posts to `POST https://graph.facebook.com/<version>/<phone-number-id>/messages`
   with the template name, the guest's language and the variables. A 4xx that won't fix itself (number not on
   WhatsApp, template paused) marks the row `failed` with no retry. A 5xx or 429 retries with backoff (3 tries).
3. **Webhook** `GET/POST /api/webhooks/whatsapp`:
   - GET answers Meta's verification challenge with `WHATSAPP_VERIFY_TOKEN`.
   - POST is accepted only with a valid `X-Hub-Signature-256` (HMAC of the raw body with `WHATSAPP_APP_SECRET`).
   - Status updates (`sent`, `delivered`, `read`, `failed`) update the row by `wamid`.
   - An incoming "STOP" (any case, also "stop", "unsubscribe") adds the phone to `whatsapp_opt_outs` and replies
     once, free, inside the window that the message opened.
4. **Dashboard:** the booking page shows WhatsApp status next to email. The wa.me buttons from Batch A stay for
   hosts without the plan, or when the guest gave no opt-in.

## Environment (Coolify; nothing pasted in chat)

`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_ACCESS_TOKEN` (permanent system-user token),
`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (any long random string you make up). All unset means the feature is
off and nothing else changes, so the code can ship before Meta approves.

## Cost

Meta charges per delivered template since 1 July 2025, by category and the recipient's country. Utility templates
sent inside an open 24-hour customer service window are free ([Meta pricing docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)).

| Item | Figure | Source / status |
| --- | --- | --- |
| Utility template, India | ₹0.115 + 18% GST = ₹0.136 per message | [third-party summary of Meta's rate card](https://baat.ai/blog/whatsapp-api-pricing-india), **unverified: check the INR rate card in Business Manager** |
| Messages per booking | 2 (confirmed + reminder), 3 if changed | plan above |
| Per booking | about ₹0.27 | 2 × ₹0.136 |

Per host per month (formula: bookings × 2 × ₹0.136):

| Case | Bookings / month | Meta cost / month (incl. GST) |
| --- | --- | --- |
| Low | 40 | ₹11 |
| Base | 100 | ₹27 |
| High | 250 | ₹68 |

No BSP fee, since we call the Cloud API directly. Meta changes rates only on 1 Jan, 1 Apr, 1 Jul or 1 Oct with a
month's notice.

**Deadline:** Indian WhatsApp Business accounts must move to INR billing by 31 December 2026, or Meta stops
delivering non-INR messages from 1 January 2027 ([Meta pricing docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)). Set the new account up in INR from the start.

## Build (14–18 hours)

| Step | Hours | Check |
| --- | --- | --- |
| Migration 0024, opt-in tick on the booking form, validation | 3 | unit: no tick or opted-out phone queues nothing |
| Sender in the job runner, retries, monthly cap | 4–5 | unit against a fake Graph API: template, language, variables, retry rules, cap |
| Webhook: verify, signature, statuses, STOP | 3–4 | unit: bad signature 401; STOP blocks later sends |
| Dashboard status, settings copy | 1–2 | e2e page check |
| e2e with a fake Meta server (like the fake Razorpay one) | 3 | `e2e-d7.mjs` in CI |

## Risks

1. **A template gets put in the marketing category or rejected.** Marketing costs about 7.5× utility in India. First
   move: keep the wording above (no offers, no "book again"), and submit the templates the day the account is
   verified, since approval takes 1 day to 1 week.
2. **New numbers start with a low daily limit** on business-started chats, raised as quality holds. First move:
   finish Meta business verification before launch, and only message opted-in guests so block rates stay low.
3. **A wrong number gets someone else's booking.** The phone field already validates format. First move: send
   only to numbers the guest typed with the opt-in tick, never to a number the host typed.

## You (Meta account steps; Claude never signs in or handles the token)

1. Meta Business Suite: business verification for Marvice Media Private Limited.
2. WhatsApp Manager: create the WhatsApp Business Account in **INR**, add a number not used on the WhatsApp app,
   display name "Hourhand" (needs approval).
3. Add a payment method.
4. Business settings → System users: create one, give it the WhatsApp account, generate a permanent token with
   `whatsapp_business_messaging` and `whatsapp_business_management`. Put it straight into Coolify.
5. App → WhatsApp → Configuration: webhook URL `https://hourhand.cloud/api/webhooks/whatsapp`, the verify token you
   chose, subscribe to `messages`.
6. Submit the six templates (Claude will give exact JSON for each, ready to paste).

## Decisions needed

1. **One Hourhand number for all hosts** (recommended: one approval, one quality rating, live in days), or each host
   connects their own number (their brand in the chat, but Tech Provider onboarding and weeks of work).
2. **Monthly WhatsApp cap per plan.** Recommended: Solo 300 messages (₹41 worst case), Duo 600. Over the cap,
   email still goes.
3. **Launch languages.** Recommended: English and Hindi now; ta/te/kn after native review.
4. **Messages.** Recommended: confirmation, 24-hour reminder, cancelled/moved. A 2-hour reminder doubles the cost
   per booking; add it later if no-shows warrant it.
