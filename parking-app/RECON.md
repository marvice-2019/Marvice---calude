# Parking.com recon: website, iOS app, Android app

Researched 11 Oct 2026; re-checked the same day with /replica-recon (App Store data unchanged; Play Store and website still unreadable). Each line is marked **[V]** (verified from a primary source, linked), **[E]** (estimate or inference) or **[GAP]** (could not get the data).

## Verdict

Parking.com has a big app (20,084 iOS ratings, 4.5 stars) with lots of inventory, but its recent experience is bad. Of the 50 newest App Store reviews, 40 are 1-star, and they keep naming the same five things: saved cards not reusing, payment errors, login loops, lost sessions and confusing time pickers. Copy its feature set but beat it on checkout: saved vehicle and card, UPI in one tap, guest checkout that never loses the pass, and a clear time picker.

## Who runs it

- **[V]** Built by SP+ as its main online sales channel for finding, reserving and buying parking across North America ([SP+ launch note](https://test.spplus.com/sp-launches-parking-com/)).
- **[V]** Metropolis Technologies agreed in Oct 2023 to buy SP+ for about US$1.5B in enterprise value, and the deal closed in 2024 ([Facilities Dive](https://www.facilitiesdive.com/news/metropolis-sp-plus-parking-automation-billion-acquisition/695855/), [Payments Dive](https://www.paymentsdive.com/news/metropolis-sp-plus-parking-automation-billion-acquisition-contactless-payment/695970/)). The iOS seller is now **Metropolis Technologies, Inc.** ([App Store lookup](https://itunes.apple.com/lookup?id=1414389805&country=us)).
- **[V]** Metropolis's core product is computer-vision checkout: drivers register their plate, phone and card in an app, then drive in and out with no gate interaction ([Payments Dive](https://www.paymentsdive.com/news/metropolis-sp-plus-parking-automation-billion-acquisition-contactless-payment/695970/)).
- **[E]** Expect Parking.com to move toward plate-based, gateless entry. Their direction is "no ticket, no QR, the plate is the pass".

## Competitors in our target market (India)

- **Park+.** [V] Drive-in pay or pre-book; earns 10–15% commission on drive-in bookings plus monthly passes (₹1,800 per site, ₹2,500 city-wide); active in Delhi NCR, Mumbai, Bengaluru, Hyderabad and Pune with about 50,000 slots ([Outlook Business](https://www.outlookbusiness.com/big-idea/that-raw-nerve-in-personal-mobility-park-has-found-a-way-around-it-6256)). [E] Those figures come from an older profile; Park+ has grown since then into FASTag and car services, so confirm its current numbers before pitching against it.
- **ParkZebra.** [V] A Bengaluru startup for searching, reserving and pre-paying parking at business parks, hospitals and malls ([The Week](https://www.theweek.in/news/sci-tech/parkzebra-app-aims-easing-parking.html)). [GAP] Its current status is unknown; the article is undated.
- **Get My Parking.** [E] A B2B vendor of white-label parking apps and gate hardware for cities, airports and corporates, so it is a possible supplier or partner rather than a consumer rival.

## iOS app facts [V] ([App Store lookup](https://itunes.apple.com/lookup?id=1414389805&country=us))

| Field | Value |
|---|---|
| Name | Parking.com - Find Parking Now |
| Rating | 4.50 from 20,084 ratings |
| Current version | 3.70.0, released 16 Sep 2026 |
| First release | 7 Aug 2018 |
| Release notes | "Improving app stability and reliability" |
| Min iOS / size | iOS 15.6 / 70.5 MB |
| Category | Navigation, Travel; ages 4+; English only; free |
| Coverage claim | 80+ US cities |

## Android app [GAP]

The Play Store page (`com.spplus.parking`) didn't render through any tool available here (empty response; AppBrain returned 403), so I have no install count, Android rating or data-safety details. Open it on a phone and note those four numbers. It's a 2-minute job.

## Website [GAP, partly covered]

parking.com is a client-rendered app. Plain fetches return an empty page, and browser automation is blocked by a session hook, so I could not walk the live site. Its feature list below comes from SP+'s own product page instead ([spplus.com/parking-com](https://spplus.com/parking-com/)).

## Feature inventory

| Feature | Source | In Bayline prototype? |
|---|---|---|
| Search by address, landmark, neighbourhood, venue, event | [V] App Store, SP+ | Partly: area only. Add venue/event search |
| Compare rates, reserve and prepay | [V] | Yes |
| QR code on pre-purchase, scanned at entry | [V] SP+ | Yes (entry code) |
| **Pay-on-arrival / drive-up "On-Demand" pay** for gateless lots | [V] SP+ | **No.** Add a "Park now" flow by lot or zone number |
| **Digital ticket** replacing paper tickets at gated lots | [V] SP+ | **No.** Add for gated lots |
| Licence-plate recognition: drive in and out | [V] SP+, Metropolis | Plate is captured; ANPR is phase 2 |
| Apple Pay / Google Pay; Add to Wallet | [V] SP+, reviews | UPI only. Add Apple/Google Wallet pass |
| Saved vehicles and cards in account | [V] SP+ | Not yet. **Must work first time** (their #1 complaint) |
| Mobile coupons / discount codes | [V] App Store | **No.** Add promo codes (schema needs a table) |
| Turn-by-turn directions | [V] App Store | No. Hand off to Google Maps link |
| Text the attendant about pick-up time (valet) | [V] App Store | No. Skip for MVP |
| Expiry alerts | [V] App Store | Partly (countdown). Add WhatsApp/push alert 15 min before |
| Favourites | [V] App Store, reviews | **No.** Add "Park here again" |
| Extend time | [V] reviews say it fails | Yes |
| Monthly parking account management | [V] App Store, SP+ | Request flow only. Add billing and pause |
| Event and venue parking pages (SEO) | [V] SP+ | No. Phase 2, big for organic traffic |
| Dynamic pricing by demand and occupancy | [V] SP+ | No. Rate cards support time windows; add demand pricing later |
| Operator reports and monthly payments portal | [V] SP+ | Planned (operator side) |

## What users hate: the 50 newest iOS reviews [V] ([review feed](https://itunes.apple.com/us/rss/customerreviews/id=1414389805/sortBy=mostRecent/json))

Window: 16 Mar to 26 Sep 2026, app versions 3.63 to 3.70. The overall 4.5 is mostly older ratings; recent ones are much worse.

| Stars | Count | Share |
|---|---|---|
| 5 | 4 | 8% |
| 4 | 1 | 2% |
| 3 | 3 | 6% |
| 2 | 2 | 4% |
| 1 | 40 | 80% |

| Pain theme (a review can count twice) | Approx. reviews | Bayline fix |
|---|---|---|
| Payment fails, internal errors, saved card ignored, re-entry every time | ~15 | One-tap UPI intent and a saved card that fills by default; retry without losing the cart |
| Confusing UI; 10–30 min to book a $2 session | ~15 | Booking in 3 taps from search; time defaults visible and editable |
| Crashes, "null" fields, JSON errors | ~15 | Error tracking (Sentry) from day one; release gate on crash-free rate |
| Login, signup and password-reset loops | ~6 | Phone OTP only, no passwords |
| Charged more than prepaid, or charged with no pass issued | ~4 | Pass is issued in the same transaction as payment capture; auto-refund if the pass fails |
| Session lost when creating an account mid-purchase; guest buy → lost-ticket fee | 2 | Guest checkout keeps the pass and links it to the phone number later |
| Can't find the zone number or the lot | 3 | Large zone/lot code on the lot page and on signage stickers |
| Gate or plate reader down, entrance closed with no notice | 1–3 | Live lot status set by operator staff; push notice to booked drivers |
| Refund delays | 3 | Self-serve cancel with stated refund time |

Praise is rare and is about the location of the lot, not the app.

## Moves for Bayline (ranked by impact)

1. **Make checkout bulletproof first.** That is where Parking.com loses users. Target: search to pass in under 60 seconds, with zero re-entry for a returning driver.
2. **Add "Park now" (drive-up pay by zone number).** It's a large share of their use; reviewers mention city lots that moved onto the app. Most Indian lots have no pre-booking habit yet, so drive-up pay is the wedge.
3. **Plate as the account key.** Collect the plate at first booking and use it for attendant lookup now and ANPR later, the direction Metropolis is taking.
4. **WhatsApp pass and expiry alerts.** This replaces Apple Wallet for most Indian users and fixes "my session isn't showing".
5. **Venue and event pages** (stadiums, metro stations, malls, hospitals). Parking.com and SP+ use these for SEO, and they're cheap to generate from lot data.

## What the Bayline prototype is still missing

1. **"Park now".** Drive-up pay by lot or zone number, with no pre-booking.
2. **Saved vehicle and card for returning drivers.** The prototype asks for the plate every time.
3. **Guest purchase linked to a phone number.** The pass should survive account creation.
4. **Favourites ("Park here again")** and promo codes. The schema also needs a `promo_codes` table.
5. **Directions hand-off to Google Maps** and an expiry alert 15 minutes before the end.
6. **Venue and event search** (metro stations, stadiums, hospitals).
7. **Live lot status** set by operator staff (gate down, lot full, entrance closed).

## Gaps to close before building

- [GAP] Play Store numbers (installs, Android rating, data safety). Check on a phone.
- [GAP] Parking.com's own fees and cancellation policy. Book one test reservation in the US app and screenshot each step; it's free to cancel if their policy allows.
- [GAP] Their live web search flow. Walk it on a desktop browser and screenshot it; automation was blocked here.

## Sources (all checked 11 Oct 2026)

- [App Store lookup API, id 1414389805](https://itunes.apple.com/lookup?id=1414389805&country=us)
- [App Store newest reviews feed](https://itunes.apple.com/us/rss/customerreviews/id=1414389805/sortBy=mostRecent/json)
- [Play Store listing, com.spplus.parking](https://play.google.com/store/apps/details?id=com.spplus.parking) (did not render)
- [SP+ Parking.com product page](https://spplus.com/parking-com/)
- [SP+ launches Parking.com](https://test.spplus.com/sp-launches-parking-com/)
- [Facilities Dive: Metropolis to buy SP+](https://www.facilitiesdive.com/news/metropolis-sp-plus-parking-automation-billion-acquisition/695855/)
- [Payments Dive: Metropolis computer-vision checkout](https://www.paymentsdive.com/news/metropolis-sp-plus-parking-automation-billion-acquisition-contactless-payment/695970/)
- [Outlook Business: Park+ profile](https://www.outlookbusiness.com/big-idea/that-raw-nerve-in-personal-mobility-park-has-found-a-way-around-it-6256)
- [The Week: ParkZebra](https://www.theweek.in/news/sci-tech/parkzebra-app-aims-easing-parking.html)
