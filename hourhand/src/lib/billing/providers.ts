import type { Provider, SubscriptionStatus } from "./plans";

// Razorpay (INR) and Stripe (USD) over plain HTTPS. Both expose the same small surface to the rest of the app.
// Base URLs are injectable so tests and the end-to-end run can point at fakes.

/** A failed provider call. `retryable`: trying later can work (rate limits, outages). */
export class BillingApiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "BillingApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

/** A subscription as the provider reports it, reduced to what Hourhand stores. */
export interface ProviderSubscription {
  provider: Provider;
  id: string;
  customerId: string | null;
  /** The Hourhand user it belongs to, from the notes/metadata Hourhand set when creating it. */
  userId: string | null;
  priceId: string | null;
  providerStatus: string;
  /** Hourhand's status, or null for a subscription that hasn't started (nothing to grant or take away yet). */
  status: SubscriptionStatus | null;
  currentPeriodEnd: Date | null;
  /** Null when the provider doesn't say (Razorpay); Hourhand then keeps what it recorded when the host cancelled. */
  cancelAtPeriodEnd: boolean | null;
}

export interface BillingProvider {
  provider: Provider;
  /** Starts a checkout and returns the page to send the host to. */
  startCheckout(p: { priceId: string; interval: "month" | "year"; userId: string; email: string; customerId: string | null; successUrl: string; cancelUrl: string; idempotencyKey: string }): Promise<{ url: string }>;
  getSubscription(id: string): Promise<ProviderSubscription>;
  /** Stops renewal at the end of the paid period. */
  cancelAtPeriodEnd(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  /** The provider's own billing page (card, invoices, plan switch), where it has one. */
  portalUrl?(customerId: string, returnUrl: string): Promise<string>;
}

type Fetch = typeof fetch;
const retryableStatus = (s: number) => s === 429 || s >= 500;

async function send(f: Fetch, url: string, init: RequestInit, what: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new BillingApiError(`Could not reach ${what}: ${(error as Error).message}`, null, true);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* a proxy's HTML error page: classify by status */ }
  if (!res.ok) {
    const err = body.error as { description?: string; message?: string; code?: string; type?: string } | undefined;
    // Provider error bodies describe the problem; they never echo the API key.
    throw new BillingApiError(`${what} ${res.status} ${err?.code ?? err?.type ?? ""}: ${err?.description ?? err?.message ?? "no message"}`.trim(), res.status, retryableStatus(res.status));
  }
  return body;
}

// ---------- Razorpay ----------

const RAZORPAY_STATUS: Record<string, SubscriptionStatus | null> = {
  created: null, authenticated: null, active: "active", pending: "past_due", halted: "unpaid",
  paused: "paused", cancelled: "cancelled", completed: "cancelled", expired: "cancelled",
};

export function razorpayProvider(opts: { keyId: string; keySecret: string; baseUrl?: string; fetchImpl?: Fetch }): BillingProvider {
  const base = (opts.baseUrl ?? "https://api.razorpay.com").replace(/\/+$/, "");
  const f = opts.fetchImpl ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString("base64")}`;
  const call = (method: string, path: string, body?: unknown) =>
    send(f, `${base}/v1${path}`, { method, headers: { authorization: auth, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }, "Razorpay");

  return {
    provider: "razorpay",
    async startCheckout(p) {
      // Razorpay needs a fixed number of charges: 10 years either way. The host can cancel at any time.
      const sub = await call("POST", "/subscriptions", {
        plan_id: p.priceId, total_count: p.interval === "month" ? 120 : 10, quantity: 1, customer_notify: true,
        notes: { user_id: p.userId, email: p.email },
      });
      if (typeof sub.short_url !== "string") throw new BillingApiError("Razorpay returned no payment link", null, false);
      return { url: sub.short_url };
    },
    async getSubscription(id) {
      const s = await call("GET", `/subscriptions/${encodeURIComponent(id)}`);
      const notes = (s.notes ?? {}) as Record<string, string>;
      return {
        provider: "razorpay", id: s.id as string, customerId: (s.customer_id as string) ?? null, userId: notes.user_id ?? null,
        priceId: (s.plan_id as string) ?? null, providerStatus: s.status as string, status: RAZORPAY_STATUS[s.status as string] ?? null,
        currentPeriodEnd: typeof s.current_end === "number" ? new Date(s.current_end * 1000) : null, cancelAtPeriodEnd: null,
      };
    },
    async cancelAtPeriodEnd(id) { await call("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: true }); },
    async pause(id) { await call("POST", `/subscriptions/${encodeURIComponent(id)}/pause`, { pause_at: "now" }); },
    async resume(id) { await call("POST", `/subscriptions/${encodeURIComponent(id)}/resume`, { resume_at: "now" }); },
  };
}

// ---------- Stripe ----------

/** Stripe's form encoding: nested keys as a[b][c]=v. */
export function formEncode(params: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") parts.push(formEncode(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join("&");
}

const STRIPE_STATUS: Record<string, SubscriptionStatus | null> = {
  active: "active", trialing: "active", past_due: "past_due", unpaid: "unpaid", paused: "paused",
  canceled: "cancelled", incomplete_expired: "cancelled", incomplete: null,
};

export function stripeProvider(opts: { secretKey: string; baseUrl?: string; fetchImpl?: Fetch }): BillingProvider {
  const base = (opts.baseUrl ?? "https://api.stripe.com").replace(/\/+$/, "");
  const f = opts.fetchImpl ?? fetch;
  const call = (method: string, path: string, params?: Record<string, unknown>, idempotencyKey?: string) =>
    send(f, `${base}/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${opts.secretKey}`,
        ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: params ? formEncode(params) : undefined,
    }, "Stripe");

  return {
    provider: "stripe",
    async startCheckout(p) {
      const session = await call("POST", "/checkout/sessions", {
        mode: "subscription",
        line_items: { 0: { price: p.priceId, quantity: 1 } },
        success_url: p.successUrl, cancel_url: p.cancelUrl,
        client_reference_id: p.userId,
        ...(p.customerId ? { customer: p.customerId } : { customer_email: p.email }),
        subscription_data: { metadata: { user_id: p.userId } },
        metadata: { user_id: p.userId },
      }, p.idempotencyKey);
      if (typeof session.url !== "string") throw new BillingApiError("Stripe returned no checkout page", null, false);
      return { url: session.url };
    },
    async getSubscription(id) {
      const s = await call("GET", `/subscriptions/${encodeURIComponent(id)}`);
      const item = ((s.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0];
      // Newer API versions keep the period end on each item; older ones on the subscription.
      const periodEnd = (item?.current_period_end ?? s.current_period_end) as number | undefined;
      const paused = s.pause_collection !== null && s.pause_collection !== undefined;
      const status = paused && s.status === "active" ? "paused" : STRIPE_STATUS[s.status as string] ?? null;
      return {
        provider: "stripe", id: s.id as string, customerId: (s.customer as string) ?? null,
        userId: ((s.metadata ?? {}) as Record<string, string>).user_id ?? null,
        priceId: ((item?.price as { id?: string } | undefined)?.id) ?? null, providerStatus: s.status as string, status,
        currentPeriodEnd: typeof periodEnd === "number" ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: s.cancel_at_period_end === true || (s.cancel_at !== null && s.cancel_at !== undefined),
      };
    },
    async cancelAtPeriodEnd(id) { await call("POST", `/subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: "true" }); },
    // "void": no invoices while paused, so pausing stops charges.
    async pause(id) { await call("POST", `/subscriptions/${encodeURIComponent(id)}`, { pause_collection: { behavior: "void" } }); },
    async resume(id) { await call("POST", `/subscriptions/${encodeURIComponent(id)}`, { pause_collection: "" }); },
    async portalUrl(customerId, returnUrl) {
      const session = await call("POST", "/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
      return session.url as string;
    },
  };
}

type Env = Record<string, string | undefined>;

/** Test-only base URLs are honoured outside production, or in an end-to-end run (HOURHAND_E2E=1). */
const fakeBase = (env: Env, name: string) => (env.NODE_ENV !== "production" || env.HOURHAND_E2E === "1" ? env[name] : undefined);

export function billingProviderFromEnv(provider: Provider, env: Env = process.env): BillingProvider | null {
  if (provider === "razorpay") {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
    return razorpayProvider({ keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, baseUrl: fakeBase(env, "RAZORPAY_API_BASE_URL") });
  }
  if (!env.STRIPE_SECRET_KEY) return null;
  return stripeProvider({ secretKey: env.STRIPE_SECRET_KEY, baseUrl: fakeBase(env, "STRIPE_API_BASE_URL") });
}
