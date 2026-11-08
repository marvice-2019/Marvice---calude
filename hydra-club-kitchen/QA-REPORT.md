# Hydra Club & Kitchen website: QA report and handover

Prepared by Marvice Media Private Limited, 8 November 2026. Code: `hydra-club-kitchen/` on branch
`claude/charming-keller-stjfc6`.

**Verdict:** ready to deploy. Every automated check passes, the production image is verified end to end, and
QA found and fixed one real booking bug (below). Going live needs the four inputs listed under
"Before go-live"; nothing else blocks it.

## 1. Results (all run 8 Nov 2026 on the final code)

| Check | Result |
|---|---|
| TypeScript strict | Pass |
| ESLint | Pass, 0 warnings |
| Unit + database tests (Vitest, real Postgres 16) | **139 / 139** pass |
| Same suite with the server clock in `Asia/Kolkata`, `UTC`, `America/Los_Angeles` | 139 / 139 in each: booking times are IST regardless of server timezone |
| Browser tests (390 px phone + 1440 px desktop) | **70 passed**, 6 skipped by design (phone-only / desktop-only checks) |
| Accessibility (axe-core, WCAG 2.2 A/AA rules: home, /book, /menu, /gallery, /privacy, /terms, admin sign-in) | 0 violations; signed-in admin pages checked by keyboard/role tests, not axe |
| Concurrency: 3 and 8 people booking one table at once | Exactly one wins, the rest get "just taken" + alternatives; booking suite looped 25× with 0 failures |
| Production Docker image | Builds (454 MB), runs as non-root, migrates and seeds an empty DB, health check 200, 503 with DB down and recovers, photo pipeline and retention work, browser suites pass against the container |

**Lighthouse (mobile, Lighthouse 13.6, local production build):**

| Page | Performance | Accessibility | Best practices | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| Home | 96–98 | 100 | 100 | 100 | 1.0 s | 0 |
| /book | 99 | 100 | 100 | 100 | 0.8 s | 0.001 |
| /menu | 98 | 100 | 100 | 100 | 0.8 s | 0 |

Home's first cold run after a server restart scored 77 (blocking time while caches warm); repeat runs 96 and
98. Expect slightly lower numbers on the live server over real 4G; re-measure after go-live.

## 2. Bugs found and fixed during QA

1. **Guests could get an error during a booking rush.** When several people booked the same table at the same
   moment, Postgres sometimes resolved the clash as a deadlock and one guest saw a server error after a
   1-second stall instead of "That table was just taken". No double booking was ever possible (the database
   guarantee held). Fix: bookings for one table now queue for a few milliseconds (per-table advisory lock),
   plus an automatic retry as a safety net. Pinned by two new tests.
2. **Phone layout widened past the screen** (Menu button cut off): an unanchored animated beam in the empty
   "Nights" card and a gallery heading too wide for small phones. Fixed; the sideways-scroll checks in all
   five test files were also strengthened, because the old check could never fail on phones.

## 3. Build effort and running cost

**Effort, measured as what a conventional agency team would bill** (built AI-assisted over 2 days, 21 commits,
~11,600 lines of code and tests):

| Stage | Hours |
|---|---|
| 1. Data model, migrations, no-double-booking constraint | 8 |
| 2. Staff sign-in, roles, password rules, rate limits | 12 |
| 3. Booking API, guest lookup/cancel, calendar file, n8n notifications | 20 |
| 4. Public site: light show (WebGL), sound engine, floor-plan booking, content pages | 60 |
| 5. Admin: Today, bookings, holds, walk-ins, CSV, photos, menu, nights, settings, staff | 30 |
| 6. SEO, structured data, performance, accessibility, consent + analytics | 14 |
| 7. Docker image, Coolify setup, deploy guide | 6 |
| 8. QA, fixes, documentation | 10 |
| **Total** | **160 h** |
| Still to do by the Marvice team: Coolify setup, DNS cutover, loading menu/photos | ~6 h |

**Monthly running cost (₹, before 18% GST):**

| Item | Cost | Basis |
|---|---|---|
| Server | ₹0 extra | Runs on the existing 16 GB Coolify VPS. Measured: app ~250 MB RAM, database ~10 MB. Fair share ≈ 3% of the VPS bill |
| Database backups | ₹0 | Cloudflare R2 free tier (10 GB) |
| Spam check, analytics, Meta CAPI | ₹0 | Free tiers |
| n8n notifications | ₹0 extra | Existing n8n instance |
| WhatsApp notifications (if turned on) | Per message | Meta per-message pricing for India; **verify current rate on Meta's pricing page before quoting** |
| Domain renewal | Existing client cost | hydraclubkitchen.com at Hostinger |
| Hostinger "Cloud Startup" hosting | Can be dropped | Only serves the old WordPress site; already set to not renew (ends 20 Feb 2027) |

## 4. Before go-live (owner: Marvice + Hydra)

1. **Coolify access:** the Coolify API token in this workspace returns *401 Unauthenticated*; create a new token
   (Coolify → Keys & Tokens, root or admin team) or do the setup by hand following `DEPLOY.md`.
2. **VPS public IP** for the DNS A record (Coolify → Servers).
3. **Confirm the cutover**: hydraclubkitchen.com currently shows a live WordPress site. The switch replaces it
   for visitors (5-minute rollback, WordPress stays untouched on Hostinger). Email is not affected.
4. **Rotate the Hostinger API token** that was pasted in chat (hPanel → Account → API).

## 5. Open items from the brief (§12): the site hides each one until it is confirmed

| Item | Where it goes | Who |
|---|---|---|
| WhatsApp number, phone | Admin → Settings → Contact (buttons appear automatically) | Hydra |
| 5th or 6th Block address | Admin → Settings → About the place | Hydra |
| VIP / VVIP capacity and minimum spend | Admin → Settings → VIP cards | Hydra |
| Floor markers 1–6 on the floor plan | Code change (~1 h) once Hydra marks them on a photo | Hydra → Marvice |
| Menu dishes and prices | Admin → Menu (nothing invented) | Hydra |
| Weekly nights | Admin → Nights | Hydra |
| Venue photos (own or licensed) | Admin → Photos or `import-photos` | Hydra |
| Logo as vector (SVG/AI/PDF) | PNG is live; vector needed for print and very large screens | Hydra |
| Legal entity name + grievance officer for the privacy page (DPDP Act) | `src/content` legal pages; lawyer review | Hydra + lawyer |
| n8n webhook, GA4 ID, Meta Pixel ID | Coolify env vars (`DEPLOY.md`) | Marvice |

## 6. Risks

| Risk | Likelihood / impact | Mitigation in place | First move |
|---|---|---|---|
| **Light show on low-end Android** (heat, battery, jank) | Medium / medium; biggest UX risk | WebGL starts only after the first touch, lowers quality on slow frames, gives up after 8 slow frames and falls back to CSS beams; reduced-motion users get none | Test on a ₹8–12k Android over real 4G before launch day |
| Old WordPress URLs lose Google rankings | Medium / low-medium | Sitemap, structured data, fast pages | Check Search Console for pages with traffic; redirect those |
| Booking notifications fail silently (n8n down) | Low / medium | Retries 3×, failures logged in the audit log; bookings are always saved | Staff check **Today** each evening |
| Single VPS | Low / high | Nightly DB backup to R2, restore test in `DEPLOY.md`, health check | Run the restore test in week 1 |
| Unconfirmed facts shown wrongly | Low | Unconfirmed values are hidden, not guessed | Fill §5 items |

## 7. Documents in the repo

- `README.md`: developer setup, architecture, booking rules
- `DEPLOY.md`: Coolify + DNS cutover, backups, restore test, rollback
- `ADMIN-GUIDE.md`: staff guide (hosts, managers, owners)
- `n8n/README.md` + `n8n/hydra-booking-notify.json`: importable notification workflow
- `.env.example`: every setting with what it does
