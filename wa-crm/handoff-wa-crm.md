# active-memory handoff: wa-crm (WhatsApp CRM SaaS built from scratch)

**Handoff #1** · 2026-11-25 · Lineage: #1 (2026-11-25): analysed the Wapi CodeCanyon demo, then built our own multi-tenant WhatsApp CRM SaaS (API + web), 93 tests passing, latest features Embedded Signup and Growth tools

## 0. Instructions for Claude (read first)

You are continuing work from a previous chat. That chat is gone; this file is the complete context and the source of truth.

1. Read this whole file before replying.
2. Follow sections 3 (Style), 4 (Hard rules) and 5 (Corrections) in every reply, for the rest of this chat. They override your defaults.
3. Use the values in section 8 exactly. Never round, re-estimate, or "correct" them.
4. Do not suggest anything listed in section 7 (Changed / rejected) again unless the user brings it up.
5. Code word: None active. If the user types /amcodeword, start every reply with the phrase they choose (default "Yes Boss!").
6. Your first reply: at most 5 lines covering the goal, the current state, and the next step (section 11). Mention any files from section 13 that were not attached. Ask the questions in section 12 if there are any. End with "Ready to continue with <next step>?" Then wait for the user's go.

## 1. Mission
- **Goal:** Build our own WhatsApp CRM SaaS (multi-tenant, sold to clients) from scratch, matching the features of the "Wapi – WhatsApp CRM SaaS" CodeCanyon item, instead of buying it.
- **Done looks like:** "Everything completely": a complete, deployable product on Coolify, with every Wapi feature built, tested and pushed.
- **Why it matters / context:** "I can't spend money on this now."

## 2. About the user (as relevant to this work)
- Founder & Director, Marvice Media Private Limited (Bengaluru; Chennai, Hyderabad, UK). Agency with 100+ clients; sub-brands Onscreens, Worxforu (software/SaaS), Conxyou.
- Builds with AI tools (Claude Code, Coolify, n8n), not a traditional coder.
- Stack: single 16 GB VPS on Coolify, n8n, Postgres. India-first (INR, 18% GST shown separately).

## 3. Style & communication
- **Language:** English.
- **Tone:** direct, human, confident; no AI filler, openers or closing summaries; lead with the result.
- **Reply length:** short status updates; full detail only for builds and strategy.
- **Formatting:** short paragraphs, tables for numbers, no nested bullets.
- **Working style:** act autonomously on short briefs; state assumptions in one line; recommend one path; push back when something is wrong; finish real files, not plans.
- **Avoid:** asking permission for routine build steps; placeholders; unverified claims of "done".

## 4. Hard rules (word for word)
1. "dont stop building until, anything need or permission work till completing final product." (Keep building; stop only for things needing the user: Meta verification, keys, deploy approval.)
2. "I want to build it from scratch, Because I can't spend money on this now"
3. From user preferences: confirm before sending, publishing, spending, deleting or changing live systems. Secrets in env only.
4. Develop and push only on branch `claude/youthful-wright-soenmm`. No PR unless asked.
5. Every completion claim must be backed by shown evidence (test output, push output, changed files). A stop hook enforces this.

## 5. Corrections log
| # | Claude did | The user wanted |
|---|---|---|
| 1 | Recommended buying the $999 Wapi licence | Build from scratch, no spend |
| 2 | Paused between features to report | Keep building to the final product without stopping |
| 3 | Claimed "93 tests pass, pushed" without showing proof (stop hook) | Show the test command output, push result and changed files before claiming completion |

## 6. Decisions
| Decision | Why |
|---|---|
| Fastify API + Next.js 15.5.29 web, Postgres only (no Redis) | Fits one 16 GB VPS |
| Tenant isolation via Postgres row-level security (`withTenant`, role `app_tenant`) | Safe multi-tenancy |
| Job queue in Postgres (`jobs`, `FOR UPDATE SKIP LOCKED`) | No extra service |
| Razorpay subscriptions, GST CGST+SGST / IGST, invoices `MM/FY/0001` | India billing |
| AI: Anthropic `claude-haiku-5-5` default, OpenAI-compatible optional | Cost |
| Embedded Signup button hidden until `META_APP_ID` + `META_ES_CONFIG_ID` set | Needs Meta Tech Provider approval first |
| Website widget is a static `public/widget.js`, no DB, no cookies | Simplest |
| Did not run codeflash | Auto-mode blocked it (would upload source code); user must allow or disable the hook |

## 7. Changed / rejected
- Buy Wapi licence ($999) → build our own (no budget)
- TypeScript 7 → TypeScript 5 in web (TS 7 breaks `next build`)
- ❌ Redis / BullMQ (Postgres queue instead)
- ❌ Parallel builder agents in worktrees (ran out of context; built in the main session)

## 8. Data & facts (exact)
| Item | Value |
|---|---|
| Wapi demo | https://preview.codecanyon.net/item/wapi-whatsapp-crm-saas-with-chatbot-flow-builder-api-automation-multitenant-system/full_screen_preview/62205973 |
| Blueprint doc | https://claude.ai/artifact/7PyF6qe9PiWyVL4eC56pgz |
| Repo / branch | `marvice-2019/Marvice---calude`, branch `claude/youthful-wright-soenmm` |
| Latest commits | `aca7f8b` growth tools; `986534a` Embedded Signup; earlier tip `617daf0` |
| Tests | `cd wa-crm/api && npm test` → 93 tests, 93 pass, 0 fail (2026-11-25) |
| Test Postgres | port 54329, data in `/var/lib/postgresql/wacrm-test` |
| Meta Graph version | `META_GRAPH_VERSION` default `v21.0` (verify current before go-live) |
| GST supplier state | `SUPPLIER_STATE_CODE` 29 (Karnataka) |
| Billing grace | `BILLING_GRACE_DAYS` 7 |
| Webhook retries (outgoing) | up to 6, signed `X-Wacrm-Signature: sha256=...` |
| Flow webhook / HTTP timeout | 15 s |
| Stale job lock recovery | 5 minutes |
| Embedded Signup rate limit | 10 per minute, owner/admin only |
| QR | 512 px PNG, qrcode 1.5.4 |
| Web libs | Next.js 15.5.29, React 19, Tailwind 4, @xyflow/react 12.12.1, TypeScript 5 |

## 9. People, terms & names
- **People:** Yuvaraj GS (user, founder).
- **Terms & nicknames:** "Wapi" = the CodeCanyon product being matched; WABA = WhatsApp Business Account; ES = Embedded Signup.
- **Names in use:** app dir `wa-crm/` (`api/`, `web/`); `NEXT_PUBLIC_APP_NAME` (test build showed "Converse"); env vars `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_ID`, `META_ES_CONFIG_ID`, `WEB_ORIGINS`/`WEB_URL`, `RAZORPAY_*`, `AI_PROVIDER`, `AI_API_KEY`, `TOKEN_ENCRYPTION_KEY`, `JWT_SECRET`, `RUN_WORKER`.

## 10. Work state
| Item | Status | Version / location | Notes |
|---|---|---|---|
| Core: auth, tenants, RLS, contacts, inbox (24h window, templates, interactive), realtime | done | `wa-crm/api`, `wa-crm/web` | migrations 001-011 |
| Templates, team/round-robin, campaigns, automation flow builder, working hours | done | | |
| Billing (Razorpay, GST invoices), super-admin panel, plans/limits | done | | |
| Integrations (CSV import, API keys, outgoing webhooks), AI replies, pipeline kanban | done | | |
| Embedded Signup ("Connect with Facebook") | done, untested against real Meta | `986534a` | needs Meta app |
| Growth tools (wa.me link, QR, website widget) | done | `aca7f8b` | |
| Docker Compose for Coolify + README go-live guide | done | `wa-crm/docker-compose.yml`, `wa-crm/README.md` | images built and verified |
| Flow node: move deal stage | not started | | next |
| Appointments; catalog/orders/Shopify; WhatsApp Flows forms | not started | | |
| Telegram, Instagram, Messenger channels | not started | | IG/Messenger need Meta review |
| Social publishing; AI voice calls | not started | | lowest priority |

## 11. Next steps
1. **Next action:** Add an Automation flow step "Move deal to stage" (API flow node + builder UI + test), commit, push to `claude/youthful-wright-soenmm`.
2. Appointments booking.
3. Catalog + orders (+ Shopify sync).
4. Telegram, then Instagram/Messenger channels.
5. Cleanup at the end: remove test DBs `wacrm_e2e`, `wacrm_docker`, test Docker images, scratch files.

## 12. Open questions ⚠️
- codeflash stop hook keeps asking to optimize; auto-mode blocks it (uploads code). Allow `npx codeflash` in settings, or disable the hook?
- User-side blockers before go-live: Meta Business Verification + Tech Provider review; Razorpay keys; AI API key; privacy policy/terms/DPA under DPDP Act (lawyer review).

## 13. Re-attach checklist
Nothing to attach. All code is in the repo on branch `claude/youthful-wright-soenmm`; the blueprint is at the artifact link in section 8.

---
<sub>Audit: 13/13 sections · 5 rules · 3 corrections · 16 data points · secrets removed: none found · generated by active-memory</sub>
