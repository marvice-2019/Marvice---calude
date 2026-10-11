import type pg from "pg";
import { planForPriceId, type Provider } from "./plans";
import type { BillingProvider, ProviderSubscription } from "./providers";
import type { WebhookEvent } from "./webhooks";

// Saving a subscription's state. Webhooks only say "subscription X changed"; Hourhand re-reads X from the provider under
// a per-subscription lock and saves what it finds, so events arriving late, twice or out of order still end correct.

type Env = Record<string, string | undefined>;
type Db = Pick<pg.PoolClient, "query">;

export type SyncOutcome =
  | { saved: true; userId: string }
  | { saved: false; reason: "no_user" | "unknown_price" | "not_started" | "older_subscription" };

/**
 * Writes one provider subscription onto the host's plan row (one row per host). A different subscription than the one
 * on file replaces it only if it is live, or if the one on file no longer is: a late "cancelled" for an old
 * subscription must not take away the plan a newer one pays for.
 */
export async function saveSubscription(db: Db, sub: ProviderSubscription, env: Env = process.env, now = new Date()): Promise<SyncOutcome> {
  if (!sub.userId || !/^[0-9a-f-]{36}$/i.test(sub.userId)) return { saved: false, reason: "no_user" };
  const user = await db.query("select 1 from users where id = $1", [sub.userId]);
  if (!user.rowCount) return { saved: false, reason: "no_user" };
  const price = sub.priceId ? planForPriceId(sub.provider, sub.priceId, env) : null;
  if (!price) return { saved: false, reason: "unknown_price" };
  if (!sub.status) return { saved: false, reason: "not_started" };

  const { rows } = await db.query<{ provider_subscription_id: string | null; status: string; plan: string; cancel_at_period_end: boolean; current_period_end: Date | null }>(
    "select provider_subscription_id, status, plan, cancel_at_period_end, current_period_end from subscriptions where user_id = $1 for update", [sub.userId]);
  const current = rows[0];
  const sameSub = current?.provider_subscription_id === sub.id;
  if (current && !sameSub && current.provider_subscription_id) {
    const currentLive = current.plan !== "free" && (current.status === "active" || current.status === "past_due");
    const incomingLive = sub.status === "active" || sub.status === "past_due" || sub.status === "paused";
    if (currentLive && !incomingLive) return { saved: false, reason: "older_subscription" };
    if (currentLive && incomingLive) {
      // Two paying subscriptions for one host: the checkout guard should prevent it, so a person must refund one.
      console.error(`[billing] host ${sub.userId} has two live subscriptions: ${current.provider_subscription_id} and ${sub.id}. Cancel and refund one.`);
    }
  }

  // Razorpay doesn't report "cancels at period end"; keep what Hourhand recorded when the host cancelled.
  const cancelAtPeriodEnd = sub.status === "cancelled" ? false : sub.cancelAtPeriodEnd ?? (sameSub ? current.cancel_at_period_end : false);
  const periodChanged = (current?.current_period_end?.getTime() ?? null) !== (sub.currentPeriodEnd?.getTime() ?? null);
  await db.query(
    `insert into subscriptions (user_id, plan, interval, provider, provider_subscription_id, provider_customer_id, provider_status, status,
       current_period_end, cancel_at_period_end, synced_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     on conflict (user_id) do update set plan = excluded.plan, interval = excluded.interval, provider = excluded.provider,
       provider_subscription_id = excluded.provider_subscription_id, provider_customer_id = coalesce(excluded.provider_customer_id, subscriptions.provider_customer_id),
       provider_status = excluded.provider_status, status = excluded.status, current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end, synced_at = excluded.synced_at, updated_at = excluded.updated_at,
       renewal_reminder_sent_at = case when $12 then null else subscriptions.renewal_reminder_sent_at end`,
    [sub.userId, price.plan, price.interval, sub.provider, sub.id, sub.customerId, sub.providerStatus, sub.status,
      sub.currentPeriodEnd, cancelAtPeriodEnd, now, periodChanged || !sameSub],
  );
  return { saved: true, userId: sub.userId };
}

/** Re-reads a subscription from its provider and saves it, holding a lock so two events for it can't interleave. */
export async function syncSubscription(pool: pg.Pool, provider: BillingProvider, subscriptionId: string, env: Env = process.env, now = new Date()): Promise<SyncOutcome> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`billing:${provider.provider}:${subscriptionId}`]);
    // Read inside the lock: whichever event goes second reads the newer state.
    const sub = await provider.getSubscription(subscriptionId);
    const outcome = await saveSubscription(client, sub, env, now);
    await client.query("commit");
    return outcome;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

/**
 * Records a verified event and acts on it once. An event that failed before is processed again when the provider
 * retries it; one already processed is acknowledged without doing anything. Errors propagate so the route answers
 * 500 and the provider retries.
 */
export async function handleWebhook(pool: pg.Pool, provider: BillingProvider, event: WebhookEvent, payload: unknown, env: Env = process.env, now = new Date()): Promise<WebhookOutcome> {
  const providerName: Provider = event.provider;
  const ins = await pool.query<{ processed_at: Date | null }>(
    `insert into webhook_events (provider, external_id, payload) values ($1, $2, $3)
     on conflict (provider, external_id) do update set provider = excluded.provider
     returning processed_at`,
    [providerName, event.eventId, JSON.stringify(payload)]);
  if (ins.rows[0]?.processed_at) return "duplicate";
  try {
    let outcome: WebhookOutcome = "ignored";
    if (event.subscriptionId) {
      const r = await syncSubscription(pool, provider, event.subscriptionId, env, now);
      if (r.saved) outcome = "processed";
      else console.warn(`[billing] ${providerName} event ${event.eventId} (${event.type}) not applied: ${r.reason}`);
    }
    await pool.query("update webhook_events set processed_at = $3, error = null where provider = $1 and external_id = $2", [providerName, event.eventId, now]);
    return outcome;
  } catch (error) {
    await pool.query("update webhook_events set error = $3 where provider = $1 and external_id = $2", [providerName, event.eventId, String((error as Error).message).slice(0, 500)]);
    throw error;
  }
}
