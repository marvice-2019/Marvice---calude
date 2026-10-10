# Recon map: Calendly (web app, with the mobile app noted)

- **Scope:** the solo booking loop. The host connects a calendar, sets availability and event types, and shares a link. The guest books, reschedules or cancels. Notifications and reminders go out. Teams, routing, CRM and AI features are left out (see "Out of scope").
- **For:** Hourhand, a booking link for solo coaches, tutors and therapists, India-first (`replica/brand.md`, `replica/fixes.md`).
- **Date:** 2026-10-10

**Method: public sources only.** No Calendly account was used. Calendly's terms may forbid using an account to build a competing product, and none was needed for this map. The screens, routes and click counts below are **inferred from help articles and the public API**, not observed in the product. Confirm them against the public booking page and the App Store screenshots before `/replica-design`. `replica/screens/` is empty: this environment can't take screenshots, because browser automation is blocked.

## Sources

| # | source | URL | what it gave |
| --- | --- | --- | --- |
| 1 | public API v2 (index) | https://developer.calendly.com/llms.txt | the resource list: users, event types, availability, scheduled events, invitees, no-shows, webhooks, routing forms |
| 2 | API: Event Type | https://developer.calendly.com/api-docs/calendly-api/event-types/get-event-type.md | the event type fields: kind, pooling, duration options, locations, custom questions, secret, paid |
| 3 | API: Scheduled Event | https://developer.calendly.com/api-docs/calendly-api/scheduled-events/get-scheduled-event.md | the booking fields: status, times, location and conference status, guests, cancellation |
| 4 | API: Invitee | https://developer.calendly.com/api-docs/calendly-api/scheduled-events/get-event-invitee.md | the guest fields: answers, time zone, reschedule and cancel URLs, payment, no-show, reconfirmation, UTM |
| 5 | API: Availability Schedule | https://developer.calendly.com/api-docs/calendly-api/availability/get-user-availability-schedule.md | weekly (`wday`) and date-specific (`date`) rules with intervals, in the schedule's own time zone |
| 6 | help centre home | https://calendly.com/help | the feature areas: scheduling, integrations, payments, mobile, admins, Notetaker, Callie, contacts |
| 7 | help: Event types (20 articles) | https://calendly.com/help/event-types | the event kinds: one-on-one, group, collective, round robin, one-off, single-use, polls; multiple durations |
| 8 | help: availability settings | https://calendly.com/help/how-to-fine-tune-your-availability-settings | minimum notice, booking window, buffers, booking limits, start-time increments, time zone lock, secret events |
| 9 | help: Sharing & booking (25 articles) | https://calendly.com/help/sharing-booking | the booking form, confirmation page, redirect, cancel and reschedule links, cancellation policy, embeds, prefill, UTM tracking |
| 10 | help: Automations (14 articles) | https://calendly.com/help/automations-notifications | notifications, reminders by email and text, reconfirmation, text opt-out, templates |
| 11 | help: connect a calendar | https://calendly.com/help/connect-your-calendar-to-calendly | Google, Office 365/Outlook.com and Exchange; Free plan 1 calendar, paid up to 6; one "add to" calendar; **iCloud not listed** |
| 12 | pricing page (read 2026-10-10) | https://calendly.com/pricing | what is gated: Free has 1 event type and 1 calendar; Standard has unlimited event types and 6 calendars; Teams adds round robin |
| 13 | App Store listing | https://itunes.apple.com/search?term=calendly&entity=software&country=us | app 1451094657: 4.85 stars from 55,409 ratings; the 150 reviews in `replica/reviews.csv` |
| 14 | user reviews | `replica/feedback.md` | where the product fails: sync, availability, mobile parity, support |

## Core loop

A host shares one link, and a guest picks a time the host is genuinely free and books it, without any back-and-forth messages.

## Screens

The "states seen" column lists the states the clone must build, inferred from the docs and the reviews.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Sign up / log in | `/signup`, `/login` | create an account (email, Google or Microsoft) | auth form, OAuth buttons | empty, error (bad password), loading, server error (reviews 12735531269, 13865142831) |
| S02 | Onboarding: connect calendar | after sign-up | link Google or Outlook to read busy times | provider cards, permissions explainer | not connected, connecting, connected, OAuth denied, permission too broad ("Too invasive", Trustpilot) |
| S03 | Onboarding: weekly hours | after S02 | set default working hours and time zone | weekday rows with time ranges, time zone select | default Mon–Fri 9–5, edited, invalid range |
| S04 | Scheduling home (event types list) | `/event_types` | list event types, copy links, toggle on/off | event type cards, copy-link button, "New" menu | empty (first run), filled, Free plan limit reached (1 event type), secret badge |
| S05 | Event type editor: basics | S04 → New or Edit | name, duration(s), location, description, colour | text inputs, duration chips, location picker, rich text | new, editing, validation error, unsaved changes |
| S06 | Event type editor: scheduling rules | S05, availability tab | the schedule to use, minimum notice, booking window, buffers, daily limits, increments | schedule select, number inputs, toggles | defaults, edited, conflicting rules |
| S07 | Event type editor: booking form | S05, form tab | custom questions | question list, add question (text, phone, single or multi select), required toggle | default (name, email), with questions, reorder |
| S08 | Event type editor: notifications | S05, notifications tab | confirmation, reminders, follow-ups by email and text | automation list, template editor with variables | none, on, text opt-out note |
| S09 | Availability schedules | `/availability` | weekly hours plus date overrides; several named schedules | weekday grid, date-override calendar, schedule tabs | one schedule, several, override added, **reverts to 9–5 bug** (review 14171442460) |
| S10 | Calendar connections | settings | which calendars to check, which calendar to add to | connection rows, "check for conflicts" toggles, "add to" select | connected, **error / disconnected** (reconnect), plan limit (1 or 6) |
| S11 | Meetings list | `/scheduled_events` | upcoming, pending, past and cancelled bookings | tabs, date filter, meeting rows, export | empty, filled, loading, error (reviews 13474314781, 12636881481) |
| S12 | Meeting detail | S11 → row | guest details, answers, location, actions | detail panel, cancel, reschedule, mark no-show, notes | active, cancelled, rescheduled, no-show |
| S13 | Public profile page | `calendly.com/<slug>` | the host's name and every public event type | avatar, name, event type list | several events, single event (skips to S14), all secret |
| S14 | Booking: pick a time | `/<slug>/<event>` | date picker plus slots, in the guest's time zone | month calendar, slot list, time zone select, duration options | loading, slots available, **no slots this week**, time zone changed, 12h/24h |
| S15 | Booking: guest details | S14 → slot → Next | name, email, custom answers, guests, text reminder number | form, add guests, phone input with country code, consent checkbox, payment step if paid | empty, validation error, **phone country-code bug** (Trustpilot 698347e1…), **reCAPTCHA interrupt** (review 14611975449), submitting |
| S16 | Booking confirmed | after S15 | confirm the booking and give next steps | summary card, add to calendar, links, or a redirect | confirmed, **slot taken while filling the form** (error then re-pick), payment failed |
| S17 | Guest: cancel | link in the email | cancel with an optional reason | summary, reason textarea, cancel button | allowed, past the cancellation policy, already cancelled |
| S18 | Guest: reschedule | link in the email | pick a new time for the same booking | S14 layout with the old time shown | slots, none, already rescheduled |
| S19 | One-off / single-use link | S04 → New → One-off | a meeting with custom times, or a link that expires after one booking | time picker, link output | created, used or expired |
| S20 | Integrations | `/integrations` | video (Zoom, Meet, Teams) and payments (Stripe, PayPal) | integration cards, connect buttons | not connected, connected, error (Zoom not attaching, review 13587303160) |
| S21 | Account and billing | settings | profile, plan, invoices, cancel the plan | profile form, plan card, invoice list, cancel button | Free, paid, **cancel flow** (Hourhand fix 2: one-tap, with a renewal reminder) |
| S22 | Mobile app (iOS and Android) | stores | meetings, share links, quick availability changes | tab bar, meeting list, link share sheet | **weaker than web** (no meeting polls on iOS, can't override times; reviews 13788376463, 13802480280) |

The system emails and texts (booking confirmation, reminders, cancellation, reschedule) are templates rather than screens. They're listed under the notifications feature rows.

## Flows

The click counts are inferred from the docs and become the numbers to beat once checked against the public booking page.

```
F01 Host gets a working booking link
    S01 -> S02 -> S03 -> S04 (copy link)
    happy path clicks: ~6 (sign up with Google, allow, connect calendar, allow, save hours, copy link)
    edge: OAuth denied; work calendar blocked by admin; wrong time zone detected

F02 Host creates an event type
    S04 -> S05 -> S06 -> S07 -> S08 -> save
    happy path clicks: ~5 (New, one-on-one, name + duration, location, save)
    edge: Free plan already has 1 event type; duplicate slug; several durations

F03 Guest books a meeting   <- the core loop
    S13 -> S14 -> S15 -> S16
    happy path clicks: 5 (pick event, pick date, pick time, Next, Schedule) plus typing name and email
    edge: no slots in view; guest time zone differs from host; slot taken mid-form;
          paid event and payment fails; reCAPTCHA; phone country code; the host's calendar
          has silently stopped syncing (the shown slot is not really free)

F04 Guest reschedules
    email -> S18 -> pick new time -> confirm
    happy path clicks: 4
    edge: no new slots; past the policy window; host calendar out of sync

F05 Guest cancels
    email -> S17 -> reason -> cancel
    happy path clicks: 2
    edge: past the cancellation policy; refund on a paid booking

F06 Host changes availability for specific dates
    S09 -> date override -> set hours or mark unavailable -> save
    happy path clicks: ~4
    edge: blocking a whole week (review 13364767913: clients could still book); override not saved;
          changes made on mobile (not possible in the app per reviews)

F07 Host handles a booking
    S11 -> S12 -> cancel | reschedule | mark no-show
    happy path clicks: 3
    edge: cancelled booking still shown on the calendar (review 14359013879)

F08 Host shares a one-off time or single-use link
    S04 -> S19 -> pick times -> copy link
    happy path clicks: ~4
    edge: link reused after booking; "not easy to make a 1 off meeting" (review 14589292561)

F09 Host connects video and payments
    S20 -> connect Zoom/Meet -> connect Stripe/PayPal -> set price on an event type (S05)
    edge: video link not attached to the booking; payment currency not supported (Calendly lists AUD, CAD, EUR, GBP, USD; no INR)

F10 System sends reminders
    booking created -> confirmation (email + calendar invite) -> reminder(s) at T-24h / T-1h -> follow-up
    edge: guest opts out of texts; reminder not delivered (review 13327204382); time zone shown wrongly
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger, link | default, hover, focus, disabled, loading | all |
| Text input / textarea | single, multi-line, with prefix | empty, filled, error, disabled | S01, S05, S07, S15, S17 |
| Phone input | with country code | valid, invalid | S15 |
| Select / combobox | time zone, schedule, calendar | open, selected, searching | S03, S06, S10, S14 |
| Duration chips | single, multi-select | selected | S05, S14 |
| Weekday hours row | on/off, multiple ranges | valid, overlapping | S03, S09 |
| Date-override calendar | single date, range | override set, unavailable | S09 |
| Month calendar (booking) | — | available day, no slots, selected, today, past | S14, S18 |
| Time slot button | — | available, selected, taken | S14, S18 |
| Event type card | public, secret, off | default, hover, copy-link confirmation | S04, S13 |
| Meeting row | upcoming, past, cancelled, no-show | default, expanded | S11 |
| Tabs | — | active | S05, S11 |
| Toggle | — | on, off, disabled (plan gate) | S04, S06, S08, S10 |
| Integration card | video, payments, calendar | not connected, connected, error | S02, S10, S20 |
| Modal / confirm dialog | cancel, delete, plan upsell | open | S12, S04, S21 |
| Toast | success, error | — | all |
| Banner | info, warning (calendar disconnected), plan limit | — | S04, S10 |
| Empty state | — | — | S04, S11, S14 |
| Avatar | user | image, initials | S13, S12 |

## Inferred data model

```
User            id, name, email, slug, timezone, avatar_url, locale, plan, created_at
                evidence: API Get current user; S13 profile; pricing tiers
                confidence: high

CalendarConnection  id, user_id, provider (google | outlook | exchange | icloud*), account_email,
                    check_conflicts (bool), is_add_to (bool), status (ok | error), last_synced_at*
                evidence: help "Connect your calendar", S10
                confidence: high for provider and check/add-to; *icloud and last_synced_at are Hourhand additions

AvailabilitySchedule  id, user_id, name, timezone, is_default
AvailabilityRule      id, schedule_id, type (wday | date), wday, date, intervals [{from "hh:mm", to "hh:mm"}]
                evidence: API Availability Schedule (exact fields)
                confidence: high

EventType       id, user_id, name, slug, kind (solo | group), pooling_type (null | round_robin | collective),
                type (standard | adhoc), duration, duration_options[], description, color, secret, active,
                is_paid, price, currency, locale, position, schedule_id,
                min_notice_minutes, booking_window_days, buffer_before, buffer_after,
                daily_limit, start_increment_minutes, lock_timezone
                evidence: API Event Type (first block, exact); help availability settings (second block, inferred)
                confidence: high / medium

EventLocation   id, event_type_id, kind (physical | phone_outbound | phone_inbound | google_meet | zoom | teams | custom | ask_invitee),
                value, additional_info
                evidence: API LocationConfiguration
                confidence: high

CustomQuestion  id, event_type_id, label, type (string | text | phone_number | single_select | multi_select),
                required, enabled, position, answer_choices[], include_other
                evidence: API EventTypeCustomQuestion (exact)
                confidence: high

Booking (ScheduledEvent)  id, event_type_id, start_at, end_at (UTC), status (active | canceled), location_type,
                join_url, conference_status, invitee_limit, external_calendar_event_id, created_at
                evidence: API Scheduled Event
                confidence: high

Invitee         id, booking_id, name, email, timezone, answers [{question, answer, position}], phone_for_texts,
                status (active | canceled), rescheduled, old_invitee_id, new_invitee_id,
                cancel_token, reschedule_token, utm{}, scheduled_by, created_at
                evidence: API Invitee (cancel_url / reschedule_url imply tokens)
                confidence: high

Guest           id, booking_id, email
                evidence: API event_guests
                confidence: high

Cancellation    booking_id, canceled_by, canceler_type (host | invitee), reason, created_at
NoShow          invitee_id, created_at
Reconfirmation  invitee_id, created_at, confirmed_at
                evidence: API objects
                confidence: high

Payment         id, invitee_id, provider (stripe | paypal | razorpay*), external_id, amount, currency, successful, terms
                evidence: API Invitee.payment; *razorpay and INR are Hourhand additions (Calendly lists no INR)
                confidence: high / addition

Automation      id, user_id, event_type_id?, trigger (booked | before_start | after_end | canceled), offset_minutes,
                channel (email | sms | whatsapp*), recipient (invitee | host), template
                evidence: help Automations (triggers inferred, not listed in sources)
                confidence: guess
```

**Relationships:** User 1-n CalendarConnection; User 1-n AvailabilitySchedule 1-n AvailabilityRule; User 1-n EventType; EventType n-1 AvailabilitySchedule; EventType 1-n EventLocation, 1-n CustomQuestion; EventType 1-n Booking; Booking 1-n Invitee (n for group events), 1-n Guest, 0-1 Cancellation; Invitee 0-1 Payment, 0-1 NoShow, 0-1 Reconfirmation; Invitee self-reference through the reschedule chain (old/new); User 1-n Automation.

**Hard constraint:** two active bookings for the same host must not overlap, including buffers. That's a database-level exclusion constraint, not a UI check (`/replica-architect`).

## Feature matrix

See `features.csv`: 40 Calendly feature rows plus the 9 Hourhand fix rows from `/replica-entrepreneur` (`original = no`).
Of the Calendly rows, must: 22, should: 9, could: 3, skip: 6. The parity scorer reads the file and counts 34 scored rows (skip and fix rows are excluded), with must-haves 0 of 22 done.

## Out of scope (cannot or should not be cloned)

- **Team scheduling** (round robin, collective, managed events, admin roles, SCIM, SAML SSO). This is a different product for sales teams. The Duo plan gets a simple shared calendar instead.
- **Routing forms and the Salesforce integration.** Enterprise lead routing, not this audience.
- **Notetaker and Callie (AI).** Reviewers ask for fewer AI features, not more ("I did not ask for or want", review 14513854136).
- **Contacts and Opportunities (CRM).** "The calendar app that desires to be a CRM" is a complaint (review 13445064691).
- **Calendly's integrations directory, partner deals and brand.** Hourhand builds its own integrations through each provider's official API, with the user's own keys.
- **Exchange on-premise calendars.** Skipped at launch; few solo coaches use them.

## Size

Screens 22, flows 10, entities 14.

The hard parts, roughly in order:

1. **Two-way calendar sync that knows when it's broken.** Google and Microsoft Graph OAuth, push notifications or polling, token refresh, iCloud over CalDAV, and the sync-health state. This is the core differentiator and the riskiest piece.
2. **Slot computation.** Weekly rules plus date overrides plus busy times plus buffers, notice, booking window and limits, across time zones and daylight saving, without double-booking under concurrent requests.
3. **Reminders over WhatsApp, SMS and email.** WhatsApp Business API template approval, India's DLT SMS registration, delivery tracking and opt-out.
4. Payments (Razorpay plus Stripe) with refunds on cancellation, and video links (Meet, Zoom) attached to each booking.

**Size: M to L.** The web app with Google and Outlook sync, booking, reminders and payments is about 6 to 10 weeks for one experienced developer, which makes it M. Adding a native mobile app with full parity and iCloud CalDAV pushes it to L, a quarter. Recommendation: ship web plus a mobile-responsive booking page first, and treat a native app as phase 2.

Next step: `/replica-architect`.
