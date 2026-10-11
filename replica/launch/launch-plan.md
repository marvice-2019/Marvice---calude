# Hourhand launch plan

The goal is 50 active Solo or Duo users within 90 days of public launch. "Active" means at least 5 bookings a month. The plan measures sign-ups and bookings, which we can influence, not revenue.

## Before launch (weeks −6 to 0)

| # | task | owner | done when |
| --- | --- | --- | --- |
| 1 | **Waitlist page.** The landing page from `landing/index.html` with "Join the beta" in place of "Start free". It captures name, email, WhatsApp, profession and current scheduling tool. | dev | the form writes to Postgres or Airtable, and the confirmation email goes out |
| 2 | **Analytics before any traffic.** A privacy-friendly tool (Plausible or Umami, self-hosted on the Coolify VPS) plus UTM links on every post. | dev | events fire: `waitlist_join`, `signup`, `calendar_connected`, `link_shared`, `first_booking` |
| 3 | **Error tracking.** Sentry, or a self-hosted GlitchTip, on the web app and the API. Uptime checks on the booking page and the sync worker. | dev | a test error appears in the dashboard and the uptime alert reaches WhatsApp |
| 4 | **Closed beta, 20 users.** Hand-picked (see "First 10" below), free Solo for 3 months in return for one 20-minute call and permission to quote them. | founder | 20 users have each had at least one real booking |
| 5 | **Proof, collected honestly.** After 30 days, ask beta users for a one-line quote, their name and their photo. Use only those who agree in writing. | founder | at least 3 permissioned quotes, or the proof section stays empty |
| 6 | **Store review prep.** Screenshots at the sizes App Store Connect and Play Console ask for when you upload (they change), with the sync light and one-tap cancel visible. Privacy labels, the data safety form, privacy policy and support URLs, age rating, and review notes with a demo account. | dev | both submissions accepted |

## Where the unhappy users talk

The research reached the App Store, Trustpilot and Hacker News. Reddit could not be fetched, so the Reddit communities below are where this audience is known to gather, **not places where the complaints were verified**.

| place | how to show up |
| --- | --- |
| Trustpilot and App Store reviews of the incumbent | Never comment or reply there, and never post fake reviews. Use them only to choose words for ads. |
| r/lifecoaching, r/tutor, r/therapists, r/smallbusiness (verify activity before posting) | Answer scheduling questions with genuine help. Mention Hourhand only when asked, and follow each subreddit's self-promotion rules. |
| Indian coach and tutor communities: LinkedIn, Instagram, WhatsApp and Telegram groups for life coaches, fitness trainers, music and language tutors | Run a 15-minute live demo: "How I stopped double bookings". Invite people into the beta. |
| Hacker News | One "Show HN" at public launch (below). |
| Product Hunt | Launch day, with a 40-second demo video built around the sync light. |

## Launch posts that lead with the fix

**Show HN: Hourhand – booking links that pause themselves when a calendar stops syncing**

> Scheduling tools usually fail quietly: a calendar disconnects, the link keeps offering times, and two clients turn up. Hourhand checks every connected calendar, shows a sync light, and pauses bookings for a calendar it can't verify, with a WhatsApp or email alert. Solo is $7/mo, Duo is $11 for two people (not per seat), and you cancel in one click. Built for coaches and tutors. Happy to talk about the sync design.

**Product Hunt tagline (60 characters max):** "A booking link that knows when your calendar stops syncing" (58 characters)

Neither post names the incumbent. No ranking claims ("best", "#1"), and no invented numbers.

## The first 10 users to talk to by hand

Pick them in this order, and book a 20-minute call with each before they get access:

1. **Marvice Media's own clients who sell sessions:** coaches, consultants, clinics, tutors. Pull the list from the CRM and send a WhatsApp invite. Ask about their current tool and their last double booking.
2. **Two-person businesses (an owner plus an assistant).** They're the Duo test, the evidence behind fix 7.
3. **People who currently pay a competitor and complained about billing or support.** Don't contact reviewers. Find them through your own network by asking "who's annoyed with their scheduler?"

Track them in a sheet with these columns: name, profession, current tool, call date, top pain, connected calendar (yes/no), first booking date, would-pay (yes/no), quote permission (yes/no).

## Launch-day checklist

- [ ] The sweep (`sweep.py --config replica/brand.json`) exits 0 on the app folder
- [ ] `listing.py replica/launch/listing.json` exits 0
- [ ] The billing flow is tested end to end: subscribe, pause, cancel and refund, in Razorpay and Stripe test mode
- [ ] The sync-failure alert is tested by revoking a Google token by hand
- [ ] The support inbox has someone assigned, with a reply-time target of 1 working day
- [ ] The privacy policy lists every processor (host, Razorpay, Stripe, the WhatsApp provider, the email provider, analytics)

Next step: `/replica-deploy`, after the app exists (`/replica-recon` → `/replica-architect` → `/replica-design` → `/replica-build` → `/replica-backend` → `/replica-test`).
