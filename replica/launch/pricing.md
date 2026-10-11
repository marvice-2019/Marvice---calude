# Hourhand pricing

## The market (read 2026-10-10)

| product | free plan | solo paid | team | billing model | source |
| --- | --- | --- | --- | --- | --- |
| Calendly | 1 event type, 1 calendar | Standard: **$10/seat/mo yearly** ("Save 17%"); $12 monthly* | Teams: **$16/seat/mo yearly** ("Save 20%"); $20 monthly* | per seat | [calendly.com/pricing](https://calendly.com/pricing) |
| Cal.com | 1 user, unlimited event types and calendars | (free plan covers solo use) | Teams: **$12/user/mo yearly** ("Save 25%") | per seat | [cal.com/pricing](https://cal.com/pricing) |
| TidyCal | 1 calendar, 1% fee on paid bookings | **$29 one-time** (via AppSumo); Pro **$12/mo or $99/yr** | Agency lifetime $79 | flat or lifetime | [tidycal.com/pricing](https://tidycal.com/pricing) |
| Zoho Bookings | 1 user | Basic **US$8/user/mo** monthly, US$6 yearly | Premium **US$12/user/mo** monthly, US$9 yearly | per user | [zoho.com/bookings/pricing](https://www.zoho.com/bookings/pricing.html) |

\* Calendly's own page showed only the yearly prices. The monthly prices of $12 (Standard) and $20 (Teams) come from secondary sources: [Zeeg](https://zeeg.me/post/calendly-pricing-guide), [Costbench](https://www.costbench.com/software/scheduling/calendly/) and [Zoho's comparison](https://www.zoho.com/bookings/explore/calendly-pricing-plans.html). Confirm them on calendly.com with the monthly toggle before quoting.

None of these pages showed INR prices, so there is no Indian price anchor from them. The Zoho India URL returned 404.

## What reviewers said about price and billing

From `replica/feedback.md`, 190 reviews:

| theme | reviews | sources | the point |
| --- | --- | --- | --- |
| Billing, cancelling and refunds | 14 | 2 | Charged after cancelling or pausing, double charges, cancellation hidden |
| Price and paywalls | 8 | 2 | The free plan was cut; AI features push the price up |
| Paying per seat to add a teammate | 5 | 3 | You need a second full plan just to add an assistant |

## The model

- **The free plan is genuinely useful for one person**, because the solo coach is the person who spreads the word.
- **Paid plans are flat, not per seat.** The two-person business pays one Duo price instead of two seats.
- **Pay monthly or yearly.** Yearly gets 2 months free.
- **Prices in INR first** (GST is extra and shown separately), plus USD for international buyers.

| plan | for | INR monthly | INR yearly | USD monthly | USD yearly | includes |
| --- | --- | --- | --- | --- | --- | --- |
| **Free** | trying it, or a light schedule | ₹0 | ₹0 | $0 | $0 | 1 person, unlimited booking links, 2 calendars with the sync light, email reminders, Hourhand footer on the booking page |
| **Solo** (recommended) | a coach, tutor or therapist running their own bookings | **₹399** + 18% GST = ₹470.82 | **₹3,990** + 18% GST = ₹4,708.20 | **$7** | **$70** | unlimited calendars, sync alerts by WhatsApp and email, 300 WhatsApp/SMS reminders a month, payments at booking, no footer, a human reply within 1 working day |
| **Duo** | an owner plus an assistant, or two co-hosts | **₹599** + 18% GST = ₹706.82 | **₹5,990** + 18% GST = ₹7,068.20 | **$11** | **$110** | everything in Solo for 2 people, a shared calendar, 600 reminders a month; each extra person ₹249 ($4) a month |

Against the market: Solo is $7 against Calendly Standard's $10 to $12. Duo is $11 for two people against $32 to $40 for two Calendly Teams seats, and that seat price is the complaint reviewers raised.

### Unit economics (estimates, to verify)

| Solo, per user per month | INR | basis |
| --- | --- | --- |
| price (excl. GST) | 399 | |
| payment gateway, about 2% | −8 | Razorpay standard domestic rate. **Check your contracted rate** |
| WhatsApp/SMS reminders, worst case 300 | −45 to −75 | Meta utility-message and DLT SMS rates move often. **Estimate: check the current Meta rate card and your SMS vendor's rate** |
| hosting share on the 16 GB Coolify VPS | −10 to −15 | estimate, at a few hundred users |
| support share (one person handling about 400 users) | −50 to −60 | estimate |
| **gross margin** | **about 240 to 286 (60 to 72%)** | above the 50% floor, even at the worst-case message volume |

The biggest risk to margin is reminder volume. Cap it at 300 a month and show a counter in Settings, rather than leaving it unlimited.

## Billing that fixes the complaints

1. **One-tap cancel** in Settings › Plan. No call, no chat, no retention maze. Access continues to the end of the paid period.
2. **Pausing stops billing.** A paused account is charged ₹0, and the next charge date is shown.
3. **A renewal reminder 7 days before every charge**, by email and WhatsApp, with the amount and a cancel link.
4. **No surprise seat jumps.** Adding someone to Duo shows the new monthly total before you confirm.
5. **Refunds handled by a person**, with a reply within 1 working day.
6. **A GST invoice for every charge**, with the GSTIN field at checkout for Indian businesses.

## Products and prices to create (the user creates them)

**Razorpay Subscriptions (India, INR).** Create these Plans in your Razorpay dashboard:

| plan id | amount | period |
| --- | --- | --- |
| `hourhand_solo_monthly` | ₹399 + GST | monthly |
| `hourhand_solo_yearly` | ₹3,990 + GST | yearly |
| `hourhand_duo_monthly` | ₹599 + GST | monthly |
| `hourhand_duo_yearly` | ₹5,990 + GST | yearly |
| `hourhand_extra_seat_monthly` | ₹249 + GST | monthly add-on |

**Stripe (international, USD).** Create one Product per plan (`Hourhand Solo`, `Hourhand Duo`, `Hourhand extra person`), each with a monthly and a yearly recurring Price: $7 / $70, $11 / $110, and $4 / $40. Turn on the Customer Portal with cancellation allowed immediately.

Use test mode until `/replica-deploy`. Put the keys only in `.env.local`, never in code or chat.
