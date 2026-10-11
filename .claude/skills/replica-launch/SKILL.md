---
name: replica-launch
description: Stage 9 of the Replica pipeline. Prepare launch of a replica product — App Store and Play listings, privacy policy, data-safety answers, supply onboarding kit, go-to-market plan with budget and kill/scale rules. Use when the user says go for the launch stage or asks for a launch plan for the replica.
argument-hint: <product folder>
---

# Replica launch

Write `<product>-app/LAUNCH.md` and a `launch/` folder.

## Deliverables

- **Store listings.** App name and subtitle within the character limits, keywords, description, screenshot captions for 6 screens, and a category. Check the current Apple and Google limits and review guidelines (impersonation, payments, location) before writing.
- **Privacy.** A privacy-policy draft and the iOS privacy-label and Play data-safety answers, mapped to what the app actually collects (phone, plate, location, payment token). Write under the DPDP Act 2023 and flag the draft for a lawyer.
- **Supply kit.** Lot-owner pitch one-pager, an MOU and agreement outline (liability, cancellations, payout terms, SLA), and signage specs for the lot-code board.
- **Demand plan.**
  - Launch areas.
  - SEO pages to publish first.
  - A Google Business Profile per lot.
  - Meta and Google search campaigns with budget, CPA target, and a kill/scale rule with thresholds.
  - WhatsApp referral flow.
  - The festival calendar.
  - Forecast with a low, base and high range, with the formula shown.
- **Launch checklist.** Payments live mode, webhooks, backups verified, status page, support inbox and SLA, refund SOP, and incident contacts.

## Gate

Every listing field is within its limits (count the characters). Every claim in store copy is true of the build. Budgets include 18% GST separately.
Commit as "Launch: <product>" and tell the user the pipeline is complete, with any open items.
