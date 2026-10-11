// Billing: provider clients against a fake fetch, webhook signatures, and saving subscriptions against real Postgres
// (only with TEST_DATABASE_URL; uses its own database <name>_bill, dropped and recreated on every run).
import { createHmac } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { createPgStore } from "../data/pg-store";
import type { User } from "../data/types";
import { BillingApiError, formEncode, razorpayProvider, stripeProvider, type BillingProvider, type ProviderSubscription } from "./providers";
import { handleWebhook, saveSubscription, syncSubscription } from "./sync";
import { cancelPlan, hostPlan, startCheckout } from "./account";
import { queueRenewalReminders } from "./reminders";
import { saveConnection, setCheckConflicts } from "../calendar/connections";
import { processDueNotifications } from "../jobs/worker";
import type { Mail, Mailer } from "../mail/mailer";
import { parseRazorpayEvent, parseStripeEvent, verifyRazorpaySignature, verifyStripeSignature } from "./webhooks";

const env = {
  RAZORPAY_PLAN_SOLO_MONTH: "plan_solo_m", RAZORPAY_PLAN_DUO_MONTH: "plan_duo_m",
  STRIPE_PRICE_SOLO_MONTH: "price_solo_m", STRIPE_PRICE_DUO_YEAR: "price_duo_y",
};

interface Call { method: string; url: string; headers: Record<string, string>; body: string }
function fakeFetch(respond: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c = { method: init.method ?? "GET", url, headers: init.headers as Record<string, string>, body: String(init.body ?? "") };
    calls.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("provider clients", () => {
  it("Razorpay: creates a subscription with the host in its notes and returns the payment link", async () => {
    const { f, calls } = fakeFetch(() => ({ body: { id: "sub_1", short_url: "https://rzp.io/i/abc" } }));
    const rp = razorpayProvider({ keyId: "rzp_test_k", keySecret: "s", baseUrl: "https://rp.fake", fetchImpl: f });
    const r = await rp.startCheckout({ priceId: "plan_solo_m", interval: "month", userId: "u1", email: "a@b.in", customerId: null, successUrl: "", cancelUrl: "", idempotencyKey: "k" });
    expect(r.url).toBe("https://rzp.io/i/abc");
    expect(calls[0].url).toBe("https://rp.fake/v1/subscriptions");
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from("rzp_test_k:s").toString("base64")}`);
    expect(JSON.parse(calls[0].body)).toMatchObject({ plan_id: "plan_solo_m", total_count: 120, notes: { user_id: "u1" } });
  });

  it("Razorpay: maps statuses; halted (retries given up) is unpaid, not still retrying", async () => {
    const statuses: Record<string, string | null> = { created: null, authenticated: null, active: "active", pending: "past_due", halted: "unpaid", paused: "paused", cancelled: "cancelled", completed: "cancelled" };
    for (const [rz, ours] of Object.entries(statuses)) {
      const { f } = fakeFetch(() => ({ body: { id: "sub_1", plan_id: "plan_solo_m", status: rz, current_end: 1_900_000_000, customer_id: "cust_1", notes: { user_id: "u1" } } }));
      const s = await razorpayProvider({ keyId: "k", keySecret: "s", fetchImpl: f }).getSubscription("sub_1");
      expect(s.status).toBe(ours);
      expect(s.currentPeriodEnd?.getTime()).toBe(1_900_000_000_000);
      expect(s.cancelAtPeriodEnd).toBeNull();
    }
  });

  it("Stripe: form-encodes checkout with the host as metadata and an idempotency key", async () => {
    expect(formEncode({ a: { 0: { b: "x y" } }, c: undefined, d: "" })).toBe("a%5B0%5D%5Bb%5D=x%20y&d=");
    const { f, calls } = fakeFetch(() => ({ body: { id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" } }));
    const sp = stripeProvider({ secretKey: "sk_test_x", baseUrl: "https://st.fake", fetchImpl: f });
    const r = await sp.startCheckout({ priceId: "price_solo_m", interval: "month", userId: "u1", email: "a@b.in", customerId: null, successUrl: "https://h/ok", cancelUrl: "https://h/no", idempotencyKey: "idem-1" });
    expect(r.url).toContain("checkout.stripe.com");
    expect(calls[0].headers["idempotency-key"]).toBe("idem-1");
    const params = new URLSearchParams(calls[0].body);
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][price]")).toBe("price_solo_m");
    expect(params.get("subscription_data[metadata][user_id]")).toBe("u1");
    expect(params.get("customer_email")).toBe("a@b.in");
  });

  it("Stripe: reads the period end from the item, and shows a collection pause as paused", async () => {
    const { f } = fakeFetch(() => ({ body: {
      id: "sub_s", status: "active", customer: "cus_1", metadata: { user_id: "u1" }, cancel_at_period_end: true, pause_collection: { behavior: "void" },
      items: { data: [{ price: { id: "price_duo_y" }, current_period_end: 1_900_000_000 }] },
    } }));
    const s = await stripeProvider({ secretKey: "sk", fetchImpl: f }).getSubscription("sub_s");
    expect(s).toMatchObject({ status: "paused", priceId: "price_duo_y", cancelAtPeriodEnd: true, userId: "u1", customerId: "cus_1" });
    expect(s.currentPeriodEnd?.getTime()).toBe(1_900_000_000_000);
  });

  it("classifies provider errors: rate limits and outages are retryable, bad requests are not", async () => {
    for (const [status, retryable] of [[429, true], [503, true], [400, false]] as const) {
      const { f } = fakeFetch(() => ({ status, body: { error: { code: "X", description: "nope" } } }));
      await expect(razorpayProvider({ keyId: "k", keySecret: "s", fetchImpl: f }).getSubscription("sub_1")).rejects.toMatchObject({ retryable, status });
    }
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ event: "subscription.activated" });
  const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

  it("Razorpay: accepts the right signature, refuses a wrong secret, a changed body or a missing header", () => {
    expect(verifyRazorpaySignature(body, hmac("whsec", body), "whsec")).toBe(true);
    expect(verifyRazorpaySignature(body, hmac("other", body), "whsec")).toBe(false);
    expect(verifyRazorpaySignature(body + " ", hmac("whsec", body), "whsec")).toBe(false);
    expect(verifyRazorpaySignature(body, null, "whsec")).toBe(false);
    expect(verifyRazorpaySignature(body, "zz", "whsec")).toBe(false);
  });

  it("Stripe: accepts any matching v1 within 5 minutes, refuses old, future, unsigned or tampered events", () => {
    const now = new Date(1_800_000_000_000);
    const t = 1_800_000_000;
    const good = hmac("whsec", `${t}.${body}`);
    expect(verifyStripeSignature(body, `t=${t},v1=${"0".repeat(64)},v1=${good}`, "whsec", now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${t - 301},v1=${hmac("whsec", `${t - 301}.${body}`)}`, "whsec", now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t + 301},v1=${hmac("whsec", `${t + 301}.${body}`)}`, "whsec", now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v0=${good}`, "whsec", now)).toBe(false);
    expect(verifyStripeSignature(body.replace("activated", "cancelled"), `t=${t},v1=${good}`, "whsec", now)).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec", now)).toBe(false);
  });

  it("finds the subscription each kind of event is about", () => {
    expect(parseRazorpayEvent({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_r" } } } }, "evt_1"))
      .toEqual({ provider: "razorpay", eventId: "evt_1", type: "subscription.charged", subscriptionId: "sub_r" });
    expect(parseRazorpayEvent({ event: "payment.captured", payload: {} }, "evt_2")?.subscriptionId).toBeNull();
    expect(parseStripeEvent({ id: "evt_s", type: "customer.subscription.updated", data: { object: { id: "sub_s" } } })?.subscriptionId).toBe("sub_s");
    expect(parseStripeEvent({ id: "e", type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_c" } } })?.subscriptionId).toBe("sub_c");
    expect(parseStripeEvent({ id: "e", type: "invoice.paid", data: { object: { parent: { subscription_details: { subscription: "sub_i" } } } } })?.subscriptionId).toBe("sub_i");
    expect(parseStripeEvent({ id: "e", type: "checkout.session.completed", data: { object: { mode: "payment" } } })?.subscriptionId).toBeNull();
  });
});

const BASE = process.env.TEST_DATABASE_URL;

describe.skipIf(!BASE)("saving subscriptions (TEST_DATABASE_URL)", () => {
  let pool: pg.Pool;
  let priya: User;
  const at = (iso: string) => new Date(iso);

  /** A provider whose subscriptions are whatever the test puts in the map. */
  function fakeProvider(subs: Map<string, ProviderSubscription>, name: "razorpay" | "stripe" = "razorpay"): BillingProvider & { reads: number } {
    const p = {
      provider: name, reads: 0,
      async startCheckout() { return { url: "" }; },
      async getSubscription(id: string) { p.reads++; const s = subs.get(id); if (!s) throw new Error(`no ${id}`); return s; },
      async cancelAtPeriodEnd() {}, async pause() {}, async resume() {},
    };
    return p;
  }
  const sub = (o: Partial<ProviderSubscription> = {}): ProviderSubscription => ({
    provider: "razorpay", id: "sub_a", customerId: "cust_1", userId: priya.id, priceId: "plan_solo_m", providerStatus: "active",
    status: "active", currentPeriodEnd: at("2032-02-01T00:00:00Z"), cancelAtPeriodEnd: null, ...o,
  });
  const row = async () => (await pool.query("select * from subscriptions where user_id = $1", [priya.id])).rows[0];
  const save = (s: ProviderSubscription) => saveSubscription(pool, s, env);

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_bill`;
    if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`TEST_DATABASE_URL must name a test database, got "${name}"`);
    u.pathname = `/${name}`;
    const admin = new URL(BASE!);
    admin.pathname = "/postgres";
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      await c.query(`drop database if exists ${name} with (force)`);
      await c.query(`create database ${name}`);
    } finally {
      await c.end();
    }
    await migrate(u.toString());
    await seed(u.toString());
    pool = new pg.Pool({ connectionString: u.toString() });
    priya = (await createPgStore(pool).getUserBySlug("priya"))!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("delete from subscriptions");
    await pool.query("delete from webhook_events");
  });

  it("saves an active subscription as the host's plan", async () => {
    expect(await save(sub())).toEqual({ saved: true, userId: priya.id });
    expect(await row()).toMatchObject({ plan: "solo", interval: "month", provider: "razorpay", provider_subscription_id: "sub_a", status: "active", provider_customer_id: "cust_1", cancel_at_period_end: false });
  });

  it("never grants a plan for a price Hourhand doesn't sell, an unknown host, or a subscription that hasn't started", async () => {
    expect(await save(sub({ priceId: "plan_someone_else" }))).toEqual({ saved: false, reason: "unknown_price" });
    expect(await save(sub({ userId: "00000000-0000-4000-8000-000000000000" }))).toEqual({ saved: false, reason: "no_user" });
    expect(await save(sub({ userId: "not-a-uuid" }))).toEqual({ saved: false, reason: "no_user" });
    expect(await save(sub({ status: null, providerStatus: "created" }))).toEqual({ saved: false, reason: "not_started" });
    expect(await row()).toBeUndefined();
  });

  it("a late cancellation of an old subscription doesn't take away the plan a newer one pays for", async () => {
    await save(sub({ id: "sub_old" }));
    await save(sub({ id: "sub_new", priceId: "plan_duo_m" }));
    expect(await save(sub({ id: "sub_old", status: "cancelled", providerStatus: "cancelled" }))).toEqual({ saved: false, reason: "older_subscription" });
    expect(await row()).toMatchObject({ provider_subscription_id: "sub_new", plan: "duo", status: "active" });
  });

  it("a late cancellation of an old subscription doesn't replace a newer one that is paused", async () => {
    await save(sub({ id: "sub_old" }));
    await save(sub({ id: "sub_new" }));
    await save(sub({ id: "sub_new", status: "paused", providerStatus: "paused" }));
    expect(await save(sub({ id: "sub_old", status: "cancelled", providerStatus: "cancelled" }))).toEqual({ saved: false, reason: "older_subscription" });
    expect(await row()).toMatchObject({ provider_subscription_id: "sub_new", status: "paused" });
  });

  it("a webhook for a subscription the provider says doesn't exist is recorded and dropped, not retried forever", async () => {
    const p = fakeProvider(new Map());
    p.getSubscription = async () => { throw new BillingApiError("Razorpay 400 BAD_REQUEST_ERROR: not found", 400, false); };
    const event = { provider: "razorpay" as const, eventId: "evt_gone", type: "subscription.charged", subscriptionId: "sub_other_account" };
    expect(await handleWebhook(pool, p, event, {}, env)).toBe("ignored");
    const r = (await pool.query("select processed_at, error from webhook_events where external_id = 'evt_gone'")).rows[0];
    expect(r.processed_at).not.toBeNull();
    expect(r.error).toContain("not found");
    p.getSubscription = async () => { throw new BillingApiError("Razorpay 503", 503, true); };
    await expect(handleWebhook(pool, p, { ...event, eventId: "evt_outage" }, {}, env)).rejects.toThrow("503");
  });

  it("a new subscription replaces a cancelled one", async () => {
    await save(sub({ id: "sub_old", status: "cancelled", providerStatus: "cancelled" }));
    await save(sub({ id: "sub_new" }));
    expect(await row()).toMatchObject({ provider_subscription_id: "sub_new", status: "active" });
  });

  it("keeps Razorpay's cancel-at-period-end as recorded, and clears the renewal reminder when a new period starts", async () => {
    await save(sub());
    await pool.query("update subscriptions set cancel_at_period_end = true, renewal_reminder_sent_at = now() where user_id = $1", [priya.id]);
    await save(sub());
    expect(await row()).toMatchObject({ cancel_at_period_end: true });
    expect((await row()).renewal_reminder_sent_at).not.toBeNull();
    await save(sub({ currentPeriodEnd: at("2032-03-01T00:00:00Z") }));
    expect((await row()).renewal_reminder_sent_at).toBeNull();
  });

  it("processes each webhook event once, and processes a failed one again when the provider retries", async () => {
    const subs = new Map([["sub_a", sub()]]);
    const p = fakeProvider(subs);
    const event = { provider: "razorpay" as const, eventId: "evt_1", type: "subscription.activated", subscriptionId: "sub_a" };
    expect(await handleWebhook(pool, p, event, { x: 1 }, env)).toBe("processed");
    expect(await handleWebhook(pool, p, event, { x: 1 }, env)).toBe("duplicate");
    expect(p.reads).toBe(1);

    const failing = { ...event, eventId: "evt_2", subscriptionId: "sub_missing" };
    await expect(handleWebhook(pool, p, failing, {}, env)).rejects.toThrow("no sub_missing");
    expect((await pool.query("select processed_at, error from webhook_events where external_id = 'evt_2'")).rows[0]).toMatchObject({ processed_at: null, error: "no sub_missing" });
    subs.set("sub_missing", sub({ id: "sub_missing" }));
    expect(await handleWebhook(pool, p, failing, {}, env)).toBe("processed");
  });

  it("events arriving out of order still leave the latest state: the subscription is re-read, not taken from the event", async () => {
    const subs = new Map([["sub_a", sub({ status: "cancelled", providerStatus: "cancelled" })]]);
    const p = fakeProvider(subs);
    // The "activated" event arrives after the subscription was already cancelled at the provider.
    await handleWebhook(pool, p, { provider: "razorpay", eventId: "evt_act", type: "subscription.activated", subscriptionId: "sub_a" }, {}, env);
    expect(await row()).toMatchObject({ status: "cancelled" });
  });

  it("two events for one subscription at once are applied one after the other", async () => {
    const subs = new Map([["sub_a", sub()]]);
    const p = fakeProvider(subs);
    let inFlight = 0;
    let maxInFlight = 0;
    const get = p.getSubscription.bind(p);
    p.getSubscription = async (id: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 50));
      inFlight--;
      return get(id);
    };
    await Promise.all([syncSubscription(pool, p, "sub_a", env), syncSubscription(pool, p, "sub_a", env)]);
    expect(maxInFlight).toBe(1);
  });
  describe("host actions, limits and reminders", () => {
    const rpEnv = { ...env, RAZORPAY_KEY_ID: "rzp_test_k", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w", RAZORPAY_API_BASE_URL: "https://rp.fake" };

    beforeEach(async () => {
      await pool.query("delete from calendar_connections where user_id = $1", [priya.id]);
      await pool.query("update notifications set status = 'skipped' where status = 'queued'");
    });

    it("refuses a second checkout while the host has a subscription, live or paused", async () => {
      for (const status of ["active", "past_due", "paused"] as const) {
        await save(sub({ status }));
        await expect(startCheckout(pool, priya, { plan: "duo", interval: "month", currency: "INR" }, "https://h", rpEnv))
          .rejects.toMatchObject({ code: "already_subscribed" });
      }
      await save(sub({ status: "cancelled", providerStatus: "cancelled" }));
      await expect(startCheckout(pool, priya, { plan: "duo", interval: "year", currency: "INR" }, "https://h", rpEnv))
        .rejects.toMatchObject({ code: "not_configured" }); // past the guard; no Razorpay plan id for duo/year in this env
    });

    it("grants paid features only while the subscription is active or retrying", async () => {
      expect(await hostPlan(pool, priya.id)).toBe("free");
      await save(sub());
      expect(await hostPlan(pool, priya.id)).toBe("solo");
      await save(sub({ status: "paused", providerStatus: "paused" }));
      expect(await hostPlan(pool, priya.id)).toBe("free");
    });

    it("cancelling a Razorpay plan records cancel-at-period-end, which Razorpay itself doesn't report", async () => {
      await save(sub());
      const calls: string[] = [];
      const f = (async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify({ id: "sub_a", plan_id: "plan_solo_m", status: "active", current_end: 1_959_000_000, notes: { user_id: priya.id } }));
      }) as unknown as typeof fetch;
      const real = globalThis.fetch;
      globalThis.fetch = f;
      try {
        await cancelPlan(pool, priya.id, rpEnv);
      } finally {
        globalThis.fetch = real;
      }
      expect(calls[0]).toBe("https://rp.fake/v1/subscriptions/sub_a/cancel");
      expect(await row()).toMatchObject({ cancel_at_period_end: true, status: "active" });
    });

    it("Free checks at most 2 calendars; a paid plan checks any number; turning one off always works", async () => {
      const cals = ["a", "b", "c"].map((x, i) => ({ id: `${x}@x.com`, name: x, primary: i === 0, accessRole: "owner" as const }));
      const tokens = (email: string) => ({ accessToken: "at", refreshToken: "rt", expiresAt: new Date(Date.now() + 3600_000), scope: "", email });
      const key = Buffer.alloc(32, 1);
      await saveConnection(pool, key, priya.id, "google", tokens("one@x.com"), cals, new Date());
      const ids = async () => (await pool.query("select id, check_conflicts from calendars where user_id = $1 order by name", [priya.id])).rows;
      const [a, b, c] = await ids();
      expect(a.check_conflicts).toBe(true);
      expect(await setCheckConflicts(pool, priya.id, b.id, true)).toBe(true);
      expect(await setCheckConflicts(pool, priya.id, c.id, true)).toBe(false);
      // A second Google account's primary calendar isn't checked while Free is at its limit.
      await saveConnection(pool, key, priya.id, "google", tokens("two@x.com"), [{ id: "two@x.com", name: "z", primary: true, accessRole: "owner" as const }], new Date());
      expect((await ids()).filter((r) => r.check_conflicts)).toHaveLength(2);
      expect(await setCheckConflicts(pool, priya.id, b.id, false)).toBe(true);
      // Several "on" toggles at the same moment: only as many as fit under the limit go through.
      await pool.query("update calendars set check_conflicts = false where user_id = $1", [priya.id]);
      const all = await ids();
      const results = await Promise.all(all.map((r) => setCheckConflicts(pool, priya.id, r.id, true)));
      expect(results.filter(Boolean)).toHaveLength(2);
      expect((await ids()).filter((r) => r.check_conflicts)).toHaveLength(2);
      await pool.query("update calendars set check_conflicts = (id = $2) where user_id = $1", [priya.id, a.id]);
      await save(sub());
      expect(await setCheckConflicts(pool, priya.id, b.id, true)).toBe(true);
      expect(await setCheckConflicts(pool, priya.id, c.id, true)).toBe(true);
    });

    it("queues one renewal reminder 7 days ahead, and sends it only if that period is still renewing", async () => {
      const now = at("2032-01-25T00:00:00Z");
      await save(sub({ currentPeriodEnd: at("2032-02-05T00:00:00Z") }));
      expect(await queueRenewalReminders(pool, now)).toBe(0); // 11 days out: not yet
      await save(sub({ currentPeriodEnd: at("2032-01-31T00:00:00Z") }));
      expect(await queueRenewalReminders(pool, now)).toBe(1);
      expect(await queueRenewalReminders(pool, now)).toBe(0); // once per period

      const sent: Mail[] = [];
      const mailer: Mailer = { async send(m) { sent.push(m); return { id: `m${sent.length}` }; } };
      await processDueNotifications(pool, mailer, { baseUrl: "https://h", now });
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toContain("Solo plan renews");
      expect(sent[0].to).toBe(priya.email);

      // Next period: a new reminder, but the host cancels before it goes out, so it is skipped.
      await save(sub({ currentPeriodEnd: at("2032-02-29T00:00:00Z") }));
      expect(await queueRenewalReminders(pool, at("2032-02-23T00:00:00Z"))).toBe(1);
      await pool.query("update subscriptions set cancel_at_period_end = true where user_id = $1", [priya.id]);
      const r = await processDueNotifications(pool, mailer, { baseUrl: "https://h", now: at("2032-02-23T00:00:00Z") });
      expect(r.skipped).toBe(1);
      expect(sent).toHaveLength(1);
    });
  });
});
