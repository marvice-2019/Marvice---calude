// Hourhand's plans, prices and limits (replica/launch/pricing.md). The provider-side ids of each price live in the
// environment: Razorpay Plans for INR, Stripe Prices for USD. Prices here are for display; what is charged is
// whatever the Razorpay Plan or Stripe Price says, so keep the two in step.

export type PaidPlan = "solo" | "duo";
export type Plan = "free" | PaidPlan;
export type BillingInterval = "month" | "year";
export type Currency = "INR" | "USD";
export type Provider = "razorpay" | "stripe";

export const PLAN_NAMES: Record<Plan, string> = { free: "Free", solo: "Solo", duo: "Duo" };

/** Prices before tax, in minor units (paise, cents). INR is charged through Razorpay, USD through Stripe. */
export const PRICES: Record<PaidPlan, Record<BillingInterval, Record<Currency, number>>> = {
  solo: { month: { INR: 39_900, USD: 700 }, year: { INR: 399_000, USD: 7_000 } },
  duo: { month: { INR: 59_900, USD: 1_100 }, year: { INR: 599_000, USD: 11_000 } },
};

/** GST on INR prices, shown separately (18%). USD prices have no Indian GST. */
export const GST_RATE = 0.18;

export const PROVIDER_FOR: Record<Currency, Provider> = { INR: "razorpay", USD: "stripe" };

export interface PlanLimits {
  /** Calendars checked for conflicts at once. */
  checkedCalendars: number;
  /** "Booked with Hourhand" footer on the booking pages. */
  footer: boolean;
}

export const LIMITS: Record<Plan, PlanLimits> = {
  free: { checkedCalendars: 2, footer: true },
  solo: { checkedCalendars: Infinity, footer: false },
  duo: { checkedCalendars: Infinity, footer: false },
};

const ENV_NAMES: Record<Provider, Record<PaidPlan, Record<BillingInterval, string>>> = {
  razorpay: {
    solo: { month: "RAZORPAY_PLAN_SOLO_MONTH", year: "RAZORPAY_PLAN_SOLO_YEAR" },
    duo: { month: "RAZORPAY_PLAN_DUO_MONTH", year: "RAZORPAY_PLAN_DUO_YEAR" },
  },
  stripe: {
    solo: { month: "STRIPE_PRICE_SOLO_MONTH", year: "STRIPE_PRICE_SOLO_YEAR" },
    duo: { month: "STRIPE_PRICE_DUO_MONTH", year: "STRIPE_PRICE_DUO_YEAR" },
  },
};

type Env = Record<string, string | undefined>;

/** The Razorpay Plan id or Stripe Price id for a plan, or null when it isn't configured. */
export function providerPriceId(provider: Provider, plan: PaidPlan, interval: BillingInterval, env: Env = process.env): string | null {
  return env[ENV_NAMES[provider][plan][interval]] || null;
}

/** Which plan and interval a provider-side id stands for. Null for an id Hourhand doesn't know, which is never granted. */
export function planForPriceId(provider: Provider, id: string, env: Env = process.env): { plan: PaidPlan; interval: BillingInterval } | null {
  for (const plan of ["solo", "duo"] as const) {
    for (const interval of ["month", "year"] as const) {
      if (providerPriceId(provider, plan, interval, env) === id) return { plan, interval };
    }
  }
  return null;
}

export type SubscriptionStatus = "active" | "paused" | "past_due" | "cancelled";

/**
 * The plan a host gets right now. A paid plan counts while active or while a renewal payment is being retried; a
 * paused or cancelled subscription falls back to Free (pausing stops billing, so it stops paid features too).
 */
export function effectivePlan(sub: { plan: Plan; status: SubscriptionStatus } | null): Plan {
  if (!sub) return "free";
  return sub.status === "active" || sub.status === "past_due" ? sub.plan : "free";
}

/** "₹399" or "$7". */
export function formatMoney(minor: number, currency: Currency): string {
  const major = minor / 100;
  const digits = Number.isInteger(major) ? 0 : 2;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(major);
}

/** The price line shown for a plan: "₹399 + 18% GST = ₹470.82 a month" or "$7 a month". */
export function priceLine(plan: PaidPlan, interval: BillingInterval, currency: Currency): string {
  const base = PRICES[plan][interval][currency];
  const per = interval === "month" ? "a month" : "a year";
  if (currency === "USD") return `${formatMoney(base, currency)} ${per}`;
  const total = Math.round(base * (1 + GST_RATE));
  return `${formatMoney(base, currency)} + 18% GST = ${formatMoney(total, currency)} ${per}`;
}
