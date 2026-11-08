# Hydra admin: staff guide

Sign in at **hydraclubkitchen.com/admin** on any phone or laptop. Each person gets their own account; never
share one. Sessions last a 12-hour shift.

## Who can do what

| Role | For | Can |
|---|---|---|
| **Host** | Door and floor staff | Today, Bookings: confirm, seat, no-show, cancel, add walk-ins |
| **Manager** | Floor manager | Everything a host can, plus Holds, Photos, Menu, Nights, Settings, CSV export |
| **Owner** | Owners | Everything, plus staff accounts (Users) |

First sign-in: you must choose a new password (12+ characters). Ten wrong passwords lock that email for 15
minutes. Forgot it? Ask the owner to reset it under **Users**; the reset signs you out everywhere.

## Every night: Today

**Today** shows tonight's arrivals by hour (after-midnight bookings stay on tonight's list) and what every
table is doing right now. It refreshes every 60 seconds.

| Button | Use when | Guest sees |
|---|---|---|
| **Confirm** | You've accepted a new web booking (status *pending*) | Notification, if n8n is on |
| **Seated / done** | The party arrived | — |
| **No-show** | They didn't come 30 min after the slot | — |
| **Cancel** | Guest asked to cancel, or you can't host them | Notification, if n8n is on |

**Walk-in:** *Add walk-in* → table, time, guests, name (phone optional). It is confirmed straight away and
blocks that table for the slot like any booking.

Two people can't book the same table and time: the system refuses the second one and offers free tables
instead. That is deliberate, not a bug.

## Bookings

Search any night, filter by status or zone, and act on a booking. Managers can **Export CSV** for a date range
(**Export to CSV → Download CSV**, for accounts or a promoter). Guests can look up or cancel their own booking with the reference (`HYD-XXXX`)
plus the last 4 digits of their phone.

## Holds (manager)

Block a **table** or a **whole zone** for a night (private party, band setup, maintenance). Guests then see it
as unavailable. Adding a hold lists any bookings it clashes with, so you can call those guests. Delete the hold
to release it.

## Photos (manager)

Upload JPG/PNG/WebP up to 15 MB. Pick the **tag** (Club, Kitchen, Bar, Floor), fill **Describe it** (one plain
sentence of what's in the photo, e.g. "DJ on the decks, lasers over a full dance floor"; screen readers and
Google use it), and optionally make it the **hero** for that scene. **Move earlier** changes the gallery order. The site resizes it, strips location data and makes fast versions automatically.
Use only photos Hydra owns or has permission to use: no screenshots from other people's Instagram.

## Menu (manager)

Add or edit dishes: name, short description, price in ₹, veg / non-veg, section. **Sold out** greys a dish out
for the night; **Available** brings it back. Prices show exactly as typed; check them before saving.

## Nights (manager)

Weekly nights for the flyer cards: title, days (e.g. "Every Friday"), one-line blurb, accent colour, and the
"Pick a table for this night" date rule. With no nights, the site points people to Instagram.

## Settings (manager)

- **Opening hours** per day (currently every day 11:30 AM to 1 AM). Booking slots follow these.
- **Contact:** WhatsApp and phone. Empty = no WhatsApp/call buttons on the site. Fill only with confirmed
  numbers.
- **Booking:** *Online booking on*, *Table time* (120 min), *Book up to* (14 days ahead), *Max guests per table*
  (12), *Spam check (Turnstile)*: leave off unless fake bookings appear (needs server setup first).
- **VIP cards and zones:** capacity and minimum spend shown on the VIP section. Leave empty until confirmed.
- **About the place:** address, maps link, Instagram, cost for two, cuisines, good-to-know list.

Changes go live within a minute. Every change is recorded with who made it and when.

## Users (owner)

Add staff with their own email and role, change roles, reset passwords, remove leavers the day they leave
(removal takes effect immediately, even on a phone that is still signed in).

## If something looks wrong

1. Hard-refresh the page.
2. Booking stuck or the floor plan won't load: note the booking reference and time, message Marvice Media
   (Yuvarajgs@marvice.in, +91 78456 67204).
3. Never fix things by creating fake bookings; use a Hold instead.
