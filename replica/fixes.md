# Calendly: what users hate, and the fix plan

Collected 2026-10-10. The `replica-entrepreneur` ranker (`reviews.py`) scored the reviews using the themes in `replica/themes.json`. Full output is in `replica/feedback.md`.

## Sample

190 reviews from 3 sources:

| source | reviews | dates | how it was read |
| --- | --- | --- | --- |
| App Store (US, app id 1451094657) | 150 | Apr 2025 to Oct 2026, the most recent 150 | Apple's public customer-reviews RSS feed, pages 1 to 3 |
| Trustpilot | 37 | Jan to Sep 2026 | review pages filtered to 1 to 3 stars, pages 1 and 2 of 12 |
| Hacker News | 3 | 2022 to 2023 | Algolia public API, comments on Calendly pricing |

Caveats, so nobody reads more into this than it holds:

- **Each quote is a short exact excerpt, not the full review.** The fetch tool returns at most about 110 characters per review. Each row is "title — excerpt", both copied exactly. Open the link for the full review.
- **The App Store links point to the RSS feed entry** (`#review-<id>`). Apple has no public per-review web URL.
- **Trustpilot was filtered to 1 to 3 stars.** Its share of complaints is high by design. Its overall TrustScore is 4.1 from 696 reviews (read 2026-10-10).
- **The App Store sample is unfiltered and skews positive.** The app's average is 4.85 from 55,409 ratings.
- Not reached: **Reddit** blocks the fetch tool and **G2** returned 403. **Google Play and Capterra** were not tried. The skill asks for three sources at minimum, and three were reached.
- **Calendly's changelog was not checked.** Claims like "they removed iCloud" come from reviewers, not from Calendly. Check before building on them.
- Two Trustpilot reviews had no text and one was about a third-party business, so all three were left out.
- **No Indian sources.** For an India-first launch, read Google Play reviews filtered to India before choosing the angle.

## 1. What they hate

| # | problem | reviews | sources | evidence |
| --- | --- | --- | --- | --- |
| 1 | The app crashes, errors out, or doesn't save changes | 23, plus 3 more found by hand | 2 | ["Can’t get signed up — Nothing but server error messages."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-12735531269) · ["the app has an issue where it simply will not save the changes."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-14622024907) |
| 2 | Billing: hard to cancel, charged after pausing or cancelling, double charges | 14 | 2 | ["Calendly continued charging my personal debit card every single month for 8 consecutive months"](https://www.trustpilot.com/reviews/6a5b288347cbd292f4d7f6f5) · ["Once you buy this they make it impossible to cancel."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13543318985) |
| 3 | Support is a bot or a script, with no phone and no human | 11, plus 3 more found by hand | 2 | ["Calendly has zero phone support even for their business accounts."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13640768356) · ["Unable to get ahold of an actual person for a billing issue. Frustrated with the bot."](https://www.trustpilot.com/reviews/6a22de59bafea0ed6d69da27) |
| 4 | Calendar sync misses events (Google, iCloud, Outlook, Zoom), leading to double bookings and missed meetings | 12, plus 4 under "sync and lost data" | 2 | ["Unavailable times on my linked calendar are showing up as available on my calendly"](https://www.trustpilot.com/reviews/69c4070e33fe43baa09f5136) · ["I keep missing meetings bc calendly wont schedule to ical."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-14140419849) |
| 5 | Availability is hard to set or override, and there are no recurring or one-off meetings | 11 | 2 | ["it reverts back to the schedule of Monday through Friday nine to five."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-14171442460) · ["sometimes when I cancel a week for a break clients are still able to book an appointment"](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13364767913) |
| 6 | Clunky and getting more complex with every update | 8, plus 3 under "redesign made it worse" (thin) | 2 | ["every update makes it more complex."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13573264819) · ["Very difficult to set up and I’m a tech guy"](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13550687899) |
| 7 | Price: the free plan was cut, and new AI features push the price up | 8 | 2 | ["now it’s only for those who are rich enough to afford it."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13630193179) · ["I do not want a price increase for all these new AI features I did not ask for or want."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-14513854136) |
| 8 | Time zone and AM/PM confusion (**thin**) | 2 | 1 | ["I missed an extremely important consultation due to Calendly’s time zone issues."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-12937878132) |

## 2. What is missing

| # | ask | reviews | sources | evidence |
| --- | --- | --- | --- | --- |
| 1 | A mobile app that does what the web app does | 5, plus 1 found by hand (**thin**, one source) | 1 | ["Using the Calendly app and using the web client is like using two different platforms,"](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-14304152598) · ["This app for iOS is less capable than its Android counterpart."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13788376463) |
| 2 | A second host or seat without paying for a second full plan | 5 | 3 | ["expensive and need to pay for 2 standard packages just to add a person to help manage your meetings."](https://www.trustpilot.com/reviews/6a3a58b6fe70bdcd6c5efff5) · ["I have paid for 2 people on my account and can only have a call with 1 person if we are to both host."](https://www.trustpilot.com/reviews/69b959b9014894f847e89851) |
| 3 | Recurring appointments and quick one-off meetings | 2 (**thin**) | 1 | ["No recurring appointment option, flags you when you try to book a recurring"](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-14435944361) |
| 4 | Dark mode | 2 (**thin**) | 1 | ["Seriously, it’s 2025 and you should have Dark Mode."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-12757207209) |
| 5 | Phone or human support on paid plans | counted under hate #3 | 2 | ["Calendly does not provide any option to speak over the phone."](https://www.trustpilot.com/reviews/6a551fbe5ab2135bcec17278) |

## 3. What is unsolved

| # | group the app leaves behind | evidence |
| --- | --- | --- |
| 1 | **Solo service providers who aren't technical**: coaches, tutors, counsellors, notaries, real estate agents. They make up most of the 5-star reviews, and the complaints show the product drifting toward sales teams. | Who loves it: [coach](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-14404144450), [notary](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13535420687), [real estate](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13455716976). What they say now: ["Not really that intuitive for folks that aren’t that techie."](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13841131606) · ["The calendar app that desires to be a CRM"](https://itunes.apple.com/us/rss/customerreviews/id=1451094657/sortBy=mostRecent/json#review-13445064691) |
| 2 | **Two-person businesses**: an owner plus an assistant, or two co-hosts. They pay for two full plans for what is one shared calendar job. | Hate #2 and missing #2: 5 reviews from 3 sources |

## 4. Fix plan

Ranked by how much evidence there is and how cheap the fix is. Each fix is added to `replica/features.csv` with `original = no`.

| # | fix | size | done in | evidence |
| --- | --- | --- | --- | --- |
| 1 | **Sync you can see.** Two-way sync with Google, Outlook and iCloud (CalDAV). A sync-status light on the dashboard, and an email or WhatsApp alert the moment a calendar disconnects. Block the slot if sync is stale, never offer it. | L | replica-backend | hate #4: 16 reviews, 2 sources |
| 2 | **Honest billing.** One-click cancel. Pausing actually stops charges. A reminder 7 days before renewal. Refunds handled by a person. | S | replica-backend, then replica-launch | hate #2: 14 reviews, 2 sources |
| 3 | **A human answers.** Reply in under 1 business day on every plan. On paid plans, a callback or WhatsApp support. | S (this is a staffing and process decision, not code) | ops, then stated in replica-launch | hate #3: 14 reviews, 2 sources |
| 4 | **Availability editor that holds.** Date overrides, "block this week", recurring bookings and one-off links, all on mobile too. Saving is confirmed on screen. | M | replica-build | hate #5: 11 reviews, 2 sources; missing #3 |
| 5 | **Mobile parity and stability.** Every web action works in the app. Crash-free sessions at 99.5% or better before launch, measured by replica-test. | M | replica-build, then replica-test | hate #1: 26 reviews; missing #1 |
| 6 | **Time zone confirm step and explicit AM/PM or 24h.** | S | replica-build | hate #8 (**thin**). Included because it is cheap and a missed meeting is costly |
| 7 | **A second seat at a fraction of the price**, or a flat price for two people. | S | replica-launch | missing #2: 5 reviews, 3 sources |
| 8 | Dark mode | S | replica-design | missing #4 (**thin**) |

## 5. The angle

**A. Recommended.** For solo coaches, tutors and service businesses who are tired of a scheduler that gets more complicated with every update and never puts them through to a person, *[your app]* is the booking link that syncs every calendar it touches, and real people answer when it doesn't.
Evidence: bugs 26, support 14, clunky 11, sync 16. 190 reviews across 3 sources.

**B.** For anyone burned by a scheduling subscription they couldn't cancel, *[your app]* has one-click cancel, a reminder before every renewal and no surprise charges.
Evidence: billing, 14 reviews across 2 sources. This is strong as a trust line on the pricing page, but too narrow to be the headline.

**C.** For two-person businesses paying double for one calendar, *[your app]* gives you a second seat for a fraction of the price.
Evidence: seats, 5 reviews across 3 sources. The theme is real but small. Use it as a pricing feature, not the positioning.

Why A: it combines the four largest themes into one promise and names the users who love the category most. Keep Calendly's name out of the app name, ads and store listing. A side-by-side comparison page is a question for a lawyer.

Next step: `/replica-brand`.
