---
name: replica-ops
description: Stage 7 of the Replica pipeline. Build the supply side of a replica marketplace — operator staff mode (scan/check-in), operator dashboard, rate editor, payouts, and platform admin. Use when the user says go for the ops stage or asks for operator, partner or admin features.
argument-hint: <product folder>
---

# Replica ops

The supply side keeps the marketplace alive. Build it inside the existing web and mobile apps behind roles, not as a separate app.

## Build

- **Staff mode (mobile).** Scan a pass QR or type a plate, then check the vehicle in or out. Overstay is calculated at exit, with offline queueing when the basement has no signal. Show today's expected arrivals.
- **Operator dashboard (web).** Occupancy and bookings by hour, revenue (gross, commission, GST, net), live lot status (open, full, gate down) that pushes a notice to booked drivers, a rate-card editor with effective dates, and monthly-pass approvals.
- **Payouts.** A weekly payout report per operator, with gross, commission, TDS/TCS and net. Razorpay Route transfer with a status. Downloadable as CSV.
- **Platform admin.** Lot onboarding with KYC fields (PAN, GSTIN, bank details held by the gateway only), refunds and disputes, promo management, and an audit log of every admin action.

## Tests

- Check-in and check-out across a pass's whole life, including overstay billing.
- An operator can only see its own lots; staff can't edit rates.
- Payout math: hand-check one week's sample against the report.

## Gate

Tests green, with the output shown. Flag the payout tax treatment (TDS 194-O, GST TCS) for a CA.
Commit as "Ops: <product>" and stop for the user's go.
