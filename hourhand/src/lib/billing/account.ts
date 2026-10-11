import type pg from "pg";
import { billingFor } from "./env";
import { effectivePlan, LIMITS, PROVIDER_FOR, providerPriceId, type BillingInterval, type Currency, type PaidPlan, type Plan, type Provider, type SubscriptionStatus } from "./plans";
import { BillingApiError } from "./providers";
import { syncSubscription } from "./sync";

// What a host can do with their plan. Every change goes to the provider first, then Hourhand re-reads the
// subscription from it: the plan row only ever holds what the provider confirmed.

type Env = Record<string, string | undefined>;
type Db = Pick<pg.Pool, "query">;

export interface HostSubscription {
  plan: Plan;
  interval: BillingInterval | null;
  provider: Provider | null;
  subscriptionId: string | null;
  customerId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export async function getHostSubscription(db: Db, userId: string): Promise<HostSubscription | null> {
  const { rows } = await db.query(
    `select plan, interval, provider, provider_subscription_id, provider_customer_id, status, current_period_end, cancel_at_period_end
       from subscriptions where user_id = $1`, [userId]);
  const r = rows[0];
  if (!r) return null;
  return {
    plan: r.plan, interval: r.interval, provider: r.provider, subscriptionId: r.provider_subscription_id, customerId: r.provider_customer_id,
    status: r.status, currentPeriodEnd: r.current_period_end, cancelAtPeriodEnd: r.cancel_at_period_end,
  };
}

/** The plan the host gets right now: Free unless a paid subscription is active or retrying a payment. */
export async function hostPlan(db: Db, userId: string): Promise<Plan> {
  const s = await getHostSubscription(db, userId);
  const own = effectivePlan(s && s.plan !== "free" ? { plan: s.plan, status: s.status } : null);
  if (own !== "free") return own;
  // The second person on someone's Duo plan gets Duo too, while that plan is paid (the owner's own subscription only).
  const { rows: [seat] } = await db.query(
    `select o.plan, o.status from seats s join users u on u.id = s.owner_id join subscriptions o on o.user_id = s.owner_id
     where s.member_id = $1 and s.accepted_at is not null and u.deleted_at is null`, [userId]);
  return seat && effectivePlan({ plan: seat.plan, status: seat.status }) === "duo" ? "duo" : "free";
}

/** How many calendars the host's plan checks for conflicts at once. */
export async function checkedCalendarLimit(db: Db, userId: string): Promise<number> {
  return LIMITS[await hostPlan(db, userId)].checkedCalendars;
}

export type BillingError = "already_subscribed" | "not_configured" | "no_subscription" | "cannot_pause" | "provider";

export class BillingActionError extends Error {
  constructor(readonly code: BillingError, message: string) {
    super(message);
    this.name = "BillingActionError";
  }
}

/** A subscription the host still has to deal with before starting another: live, retrying, or paused. */
const holdsPlan = (s: HostSubscription | null) => Boolean(s?.subscriptionId) && s!.plan !== "free" && s!.status !== "cancelled";

/** Starts a checkout for a paid plan. Refuses while the host already has a subscription, so nobody pays twice. */
export async function startCheckout(db: Db, user: { id: string; email: string }, choice: { plan: PaidPlan; interval: BillingInterval; currency: Currency }, baseUrl: string, env: Env = process.env, now = new Date()): Promise<string> {
  const current = await getHostSubscription(db, user.id);
  if (holdsPlan(current)) throw new BillingActionError("already_subscribed", "This account already has a subscription.");
  const provider = PROVIDER_FOR[choice.currency];
  const billing = billingFor(provider, env);
  const priceId = providerPriceId(provider, choice.plan, choice.interval, env);
  if (!billing || !priceId) throw new BillingActionError("not_configured", `${provider} isn't set up for ${choice.plan} ${choice.interval}.`);
  try {
    const { url } = await billing.api.startCheckout({
      priceId, interval: choice.interval, userId: user.id, email: user.email, customerId: current?.customerId ?? null,
      successUrl: `${baseUrl}/dashboard/plan?checkout=done`, cancelUrl: `${baseUrl}/dashboard/plan?checkout=cancelled`,
      // A double click within the same minute opens the same Stripe checkout instead of two.
      idempotencyKey: `checkout:${user.id}:${priceId}:${Math.floor(now.getTime() / 60_000)}`,
    });
    return url;
  } catch (error) {
    throw asActionError(error);
  }
}

function asActionError(error: unknown): BillingActionError {
  if (error instanceof BillingActionError) return error;
  console.error("[billing] provider call failed", error);
  const retry = error instanceof BillingApiError && error.retryable;
  return new BillingActionError("provider", retry ? "The payment provider didn't respond. Try again in a minute." : "The payment provider refused that change.");
}

async function liveSubscription(db: Db, userId: string, env: Env) {
  const s = await getHostSubscription(db, userId);
  if (!holdsPlan(s) || !s!.provider) throw new BillingActionError("no_subscription", "There's no subscription to change.");
  const billing = billingFor(s!.provider, env);
  if (!billing) throw new BillingActionError("not_configured", `${s!.provider} isn't set up on this server.`);
  return { s: s!, api: billing.api };
}

/** Stops renewal; the host keeps the plan until the end of the period they paid for. */
export async function cancelPlan(pool: pg.Pool, userId: string, env: Env = process.env): Promise<void> {
  const { s, api } = await liveSubscription(pool, userId, env);
  try {
    await api.cancelAtPeriodEnd(s.subscriptionId!);
  } catch (error) {
    throw asActionError(error);
  }
  // Razorpay doesn't report "cancels at period end" when the subscription is re-read, so record it here.
  await pool.query("update subscriptions set cancel_at_period_end = true, updated_at = now() where user_id = $1 and provider_subscription_id = $2", [userId, s.subscriptionId]);
  await resync(pool, api, s.subscriptionId!, env);
}

/** Pauses billing. Paid features stop until the host resumes. */
export async function pausePlan(pool: pg.Pool, userId: string, env: Env = process.env): Promise<void> {
  const { s, api } = await liveSubscription(pool, userId, env);
  if (s.status !== "active") throw new BillingActionError("cannot_pause", "Only an active subscription can be paused.");
  try {
    await api.pause(s.subscriptionId!);
  } catch (error) {
    throw asActionError(error);
  }
  await resync(pool, api, s.subscriptionId!, env);
}

export async function resumePlan(pool: pg.Pool, userId: string, env: Env = process.env): Promise<void> {
  const { s, api } = await liveSubscription(pool, userId, env);
  if (s.status !== "paused") throw new BillingActionError("cannot_pause", "Only a paused subscription can be resumed.");
  try {
    await api.resume(s.subscriptionId!);
  } catch (error) {
    throw asActionError(error);
  }
  await resync(pool, api, s.subscriptionId!, env);
}

/** The change went through at the provider; if re-reading fails now, the webhook that follows will catch it up. */
async function resync(pool: pg.Pool, api: Parameters<typeof syncSubscription>[1], id: string, env: Env) {
  try {
    await syncSubscription(pool, api, id, env);
  } catch (error) {
    console.warn(`[billing] re-reading ${id} after a change failed; the provider's webhook will update it`, error);
  }
}

/** Stripe's own billing page: card, invoices and receipts. */
export async function billingPortalUrl(db: Db, userId: string, returnUrl: string, env: Env = process.env): Promise<string> {
  const s = await getHostSubscription(db, userId);
  if (s?.provider !== "stripe" || !s.customerId) throw new BillingActionError("no_subscription", "There's no Stripe billing account for this host.");
  const billing = billingFor("stripe", env);
  if (!billing?.api.portalUrl) throw new BillingActionError("not_configured", "Stripe isn't set up on this server.");
  try {
    return await billing.api.portalUrl(s.customerId, returnUrl);
  } catch (error) {
    throw asActionError(error);
  }
}
