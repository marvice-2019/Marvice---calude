# Hourhand components

These cover the component list in `replica/recon.md`, plus three that only Hourhand has (the sync light, the time zone label and the plan meter, marked ★).

- **Base library:** shadcn/ui (copy-in components on Radix primitives) for focus management, keyboard behaviour and ARIA.
- **Icons:** [Lucide](https://lucide.dev), ISC licence.
- **Fonts:** Fraunces and Inter, both OFL. No asset, icon or wording is taken from Calendly.
- **Tokens:** `replica/design/tokens.css`. In Tailwind, colours are `bg-<role>`, `text-<role>` and `border-<role>`; for example `bg-card text-text border-border-input`. Never use a raw hex value in a component.

**Rules for every component:**

- Tap targets are at least 44 px (`--hh-tap`).
- `focus-visible` shows a 2 px `focus` ring with a 2 px offset (5.58:1 on bg, 6.16:1 in dark mode).
- Motion uses `--hh-motion-*`, which is 0 ms when the user prefers reduced motion.
- Anything on `highlight` uses `on-highlight` text.
- Every colour pair a component uses is listed in `tokens.json` `pairs`, and both themes pass AA.

---

```
Button
  variants  primary (bg accent, text on-accent), secondary (bg card, border border-input, text text),
            ghost (transparent, text text), danger (bg danger, text on-accent), link (text accent, underline on hover)
  sizes     sm 36px, md 44px, lg 52px (md is the default; nothing below 44px on touch screens)
  states    default, hover (8% darker), active, focus-visible, disabled (50% opacity, no pointer), loading (spinner + label kept)
  tokens    radius md, font sm/600 (md: base/600), padding x 16 / 20 / 24
  a11y      real <button> or <a> for navigation; loading sets aria-busy and keeps the visible label;
            an icon-only button needs aria-label
  used on   all screens
```

```
TextInput / Textarea
  variants  default, with prefix (hourhand.app/), with trailing icon
  sizes     md 44px
  states    empty (placeholder text-muted), filled, focus, error (border danger + message below), disabled, read-only
  tokens    bg card, border border-input (3.92:1 against card), radius sm, font base/400
  a11y      visible <label> (never placeholder-only); error linked by aria-describedby and aria-invalid
  used on   S01, S05, S07, S15, S17
```

```
PhoneInput
  variants  country select + number; defaults to +91, detected from the guest's locale
  states    empty, valid, invalid ("Check the number, it should have 10 digits after +91")
  tokens    as TextInput
  a11y      the country select has its own label; E.164 value stored
  note      replaces the country-code bug users reported (Trustpilot 698347e1...)
  used on   S15, onboarding WhatsApp number
```

```
Select / Combobox
  variants  native select (short lists), searchable combobox (time zones, calendars)
  states    closed, open, highlighted option, selected, no results, disabled
  tokens    as TextInput; listbox bg card, shadow pop, radius md
  a11y      Radix Select / cmdk: arrow keys, type-ahead, Esc closes, aria-activedescendant
  used on   S03, S06, S10, S14
```

```
DurationChips
  variants  single select (booking page), multi select (event editor)
  states    default, selected (bg accent, text on-accent), focus, disabled
  tokens    radius pill, border border-input, font sm/500
  a11y      role=radiogroup (single) or group of checkboxes (multi)
  used on   S05, S14
```

```
WeekdayHoursRow
  variants  day on/off toggle + one or more time ranges, "copy to all days"
  states    unavailable (text-muted "Unavailable"), one range, several ranges, overlap error
  tokens    surface rows, gap space-3
  a11y      each range has from/to labelled "Monday start" / "Monday end"; add/remove range buttons labelled
  used on   S03, S09
```

```
DateOverrideCalendar
  variants  single date, date range ("Block a week")
  states    no overrides, override set (dot highlight), unavailable (struck through), saved confirmation toast
  tokens    as MonthCalendar
  a11y      the grid pattern (arrow keys move by day, PageUp/PageDown by month); the selection is announced
  used on   S09
```

```
MonthCalendar (booking)
  variants  —
  states    loading (skeleton grid), day with slots (bold, text text), day without slots (text-muted, disabled),
            selected (bg accent, text on-accent), today (ring border-input), past (disabled), no slots in view
            (empty state "No open times this month" + jump to next available)
  tokens    cell 44px, radius pill, font sm/500
  a11y      role=grid, aria-selected, aria-disabled; days with slots carry an aria-label such as "Thursday 14 November, 6 times free"
  used on   S14, S18
```

```
SlotButton
  variants  —
  states    available (border border-input, text text), selected (bg accent, text on-accent, then "Next" appears beside it),
            taken (removed on refresh; on a 409, toast "That time was just taken" and the list refreshes)
  tokens    height 44px, radius sm, font sm/500, tabular-nums
  a11y      a <button> labelled with the full time and zone, e.g. "10:30 am IST"
  used on   S14, S18
```

```
TimezoneLabel ★
  variants  inline ("Times in IST (your time)"), selectable (opens the time zone combobox)
  states    detected, changed by guest, locked by host ("Times shown in IST")
  tokens    text-muted, font xs/500
  a11y      part of the slot list's accessible name
  note      fix 6: every time on screen and in messages shows its zone; 12h/24h follows the user's time_format
  used on   S14, S15, S16, S18, emails
```

```
SyncLight ★
  variants  per calendar (S10 row), summary (S04 header, S14 host preview)
  states    ok (success dot, "In sync · checked 2 min ago" on success-bg),
            degraded (warning dot, "Sync slow · retrying" on warning-bg),
            disconnected (danger dot, "Disconnected. Bookings paused" on danger-bg, with a Reconnect button)
  tokens    dot 8px, radius pill, font xs/500; pairs success/success-bg, warning/warning-bg, danger/danger-bg (all AA)
  a11y      the state is written in words, never colour alone; the S04 summary is a live region
            (aria-live=polite) so a change is announced
  note      fix 1, the product's main promise
  used on   S02, S04, S10
```

```
EventTypeCard
  variants  active, hidden (badge "Link only"), off (text-muted, toggle off)
  states    default, hover (shadow card), copy-link pressed ("Copied" for 2 s), menu open
  tokens    bg card, border border, radius lg, padding space-5; left edge shows the event colour as a 4px dot, not a rail
  a11y      card is not one big link: title link + separate copy and menu buttons
  used on   S04, S13
```

```
MeetingRow
  variants  upcoming, past, cancelled (struck time, "Cancelled by guest"), no-show (badge)
  states    default, expanded (answers, location, actions)
  tokens    divider border, font sm, time tabular-nums
  a11y      the expand toggle is a <button aria-expanded>
  used on   S11
```

```
Tabs
  variants  underline (S05 editor), segmented (S11 Upcoming/Past/Cancelled)
  states    active (text text, 2px accent underline), inactive (text-muted), focus
  a11y      Radix Tabs: arrow keys, role=tablist
  used on   S05, S11
```

```
Toggle (Switch)
  variants  —
  states    on (bg accent), off (bg border-input), disabled, plan-locked (disabled + "Solo plan" hint)
  tokens    track 44×24, radius pill
  a11y      role=switch, aria-checked, a visible label beside it
  used on   S04, S06, S08, S10
```

```
IntegrationCard
  variants  calendar, video, payments
  states    not connected (Connect button), connecting (spinner), connected (account email + Disconnect),
            error (danger-bg message + Reconnect)
  tokens    bg card, border border, radius lg
  a11y      the status is written in words
  used on   S02, S10, S20
```

```
Dialog
  variants  confirm (cancel booking, delete event type), form (date override), plan (upgrade or cancel plan)
  states    open, submitting, error
  tokens    bg card, shadow pop, radius lg, scrim rgb(0 0 0 / .4)
  a11y      Radix Dialog: focus trap, Esc closes, focus returns to the trigger, aria-labelledby set to the title
  note      cancelling a plan is one dialog with one button; there's no retention maze (fix 2)
  used on   S04, S12, S21
```

```
Toast
  variants  success, error, info
  states    enter, visible 4 s (errors stay until dismissed), exit
  tokens    bg text / text bg (inverted), radius md, shadow pop
  a11y      role=status (success, info) or role=alert (error); never the only place an error is shown
  used on   all screens
```

```
Banner
  variants  warning (calendar disconnected), info (plan limit reached), danger (payment failed)
  states    visible, dismissed (except disconnected, which stays until reconnected)
  tokens    <state>-bg, text <state>, radius md
  a11y      role=status, plus an action button inside
  used on   S04, S10, S21
```

```
EmptyState
  variants  first run (S04 "Create your first booking link"), none yet (S11 "No bookings yet. Share your link
            and they'll show up here."), no slots (S14)
  tokens    text-muted body, one primary action, no illustration (illustrations are commissioned later)
  used on   S04, S11, S14
```

```
Avatar
  variants  image, initials (bg surface, text text)
  sizes     24, 32, 64
  a11y      alt is the person's name; decorative where the name sits beside it
  used on   S12, S13
```

```
PlanMeter ★
  variants  reminders used this month ("212 of 300 WhatsApp/SMS reminders")
  states    under 80% (text-muted), 80–99% (warning), 100% (danger + "reminders fall back to email")
  tokens    track border, fill accent / warning / danger, height 6px, radius pill
  a11y      role=meter with aria-valuenow and aria-valuemax
  note      keeps reminder costs inside the margin in pricing.md
  used on   S08, S21
```

The primitives are built in isolation at `replica/design/primitives.html`. This is a static check page that uses `tokens.css`, not the app's component code. The real components get built in the Next.js app during `/replica-build` (milestone 1).
