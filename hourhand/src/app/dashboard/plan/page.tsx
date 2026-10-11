import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { focusRing } from "@/components/ui/focus";
import { authEnabled } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { getHostSubscription, type HostSubscription } from "@/lib/billing/account";
import { billingFor } from "@/lib/billing/env";
import { effectivePlan, LIMITS, PLAN_NAMES, PROVIDER_FOR, priceLine, providerPriceId, type BillingInterval, type Currency, type PaidPlan } from "@/lib/billing/plans";
import { getPool } from "@/lib/data/pg-store";
import { SeatForm } from "@/components/SeatForm";
import { seatFor } from "@/lib/seats";
import { cancelSubscription, choosePlan, openBillingPortal, pauseSubscription, resumeSubscription } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  already_subscribed: "You already have a subscription. Cancel it first, or wait for it to end, before choosing another plan.",
  not_configured: "Payments for that plan aren't set up on this server yet.",
  no_subscription: "There's no subscription to change.",
  cannot_pause: "That change isn't possible in the subscription's current state.",
  provider: "The payment provider didn't accept that. Try again in a minute; nothing was charged.",
  demo: "The demo data can't take payments. Sign in with the database set up to choose a plan.",
};
const DONE: Record<string, string> = {
  cancelled: "Renewal cancelled. You keep your plan until the end of the period you paid for.",
  paused: "Subscription paused. You won't be charged, and paid features are off until you resume.",
  resumed: "Subscription resumed.",
};

const FEATURES: Record<PaidPlan, string[]> = {
  solo: ["Everything in Free", "Unlimited calendars checked for conflicts", "No Hourhand footer on your booking pages"],
  duo: ["Everything in Solo", "A second person at no extra cost: an assistant who manages your bookings, or a co-host with their own page"],
};

function statusLine(s: HostSubscription, fmt: (d: Date) => string): string {
  const end = s.currentPeriodEnd ? fmt(s.currentPeriodEnd) : null;
  if (s.status === "paused") return "Paused. Paid features are off and you aren't being charged.";
  if (s.status === "unpaid") return `${PLAN_NAMES[s.plan]} is on hold: the renewal payment failed and the provider stopped retrying. Paid features are off until the card is updated.`;
  if (s.status === "past_due") return "Your last payment didn't go through. The provider is retrying; update your card to keep the plan.";
  if (s.status === "cancelled") return end ? `Ended ${end}.` : "Ended.";
  if (s.cancelAtPeriodEnd) return end ? `Cancelled. Your plan stays on until ${end}, then you move to Free.` : "Cancelled. Your plan stays on until the end of this period.";
  return end ? `Renews ${end}. We email you 7 days before.` : "Active.";
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const live = authEnabled();
  const sub = live ? await getHostSubscription(getPool(process.env.DATABASE_URL as string), user.id) : null;
  const seat = live ? await seatFor(getPool(process.env.DATABASE_URL as string), user.id) : null;
  const holding = Boolean(sub?.subscriptionId) && sub!.plan !== "free" && sub!.status !== "cancelled";
  const currency: Currency = params.currency === "USD" ? "USD" : "INR";
  const interval: BillingInterval = params.interval === "year" ? "year" : "month";
  const provider = PROVIDER_FOR[currency];
  const providerReady = live && billingFor(provider) !== null;
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: user.timezone }).format(d);
  const toggle = (key: "currency" | "interval", value: string, label: string, on: boolean) => (
    <Link
      href={`/dashboard/plan?${new URLSearchParams({ currency, interval, [key]: value })}`}
      aria-current={on ? "true" : undefined}
      className={`inline-flex min-h-11 items-center rounded-pill px-4 text-sm ${on ? "bg-accent text-on-accent" : "text-text-muted hover:text-text"} ${focusRing}`}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <h1 className="font-display text-xl text-text">Plan</h1>
      <p className="mt-2 max-w-xl text-text-muted">
        Free covers one host with {LIMITS.free.checkedCalendars} calendars checked for conflicts. Paid plans remove the limits and the footer.
      </p>

      {params.checkout === "done" && (
        <p role="status" className="mt-4 max-w-xl text-success">Checkout finished. Your plan switches on as soon as the payment provider confirms the payment, usually within a minute. Refresh to see it.</p>
      )}
      {params.checkout === "cancelled" && <p role="status" className="mt-4 text-text-muted">Checkout closed. Nothing was charged.</p>}
      {params.done && Object.hasOwn(DONE, params.done) && <p role="status" className="mt-4 max-w-xl text-success">{DONE[params.done]}</p>}
      {params.error && <p role="alert" className="mt-4 max-w-xl text-danger">{(Object.hasOwn(ERRORS, params.error) && ERRORS[params.error]) || ERRORS.provider}</p>}

      <Card className="mt-6 max-w-2xl">
        <h2 className="font-semibold text-text">Current plan: {PLAN_NAMES[effectivePlan(sub && sub.plan !== "free" ? { plan: sub.plan, status: sub.status } : null)]}</h2>
        {sub && sub.plan !== "free" && <p className="mt-1 text-text-muted">{statusLine(sub, fmt)}</p>}
        {holding && (
          <div className="mt-4 flex flex-wrap gap-2">
            {(sub!.status === "active" || sub!.status === "past_due" || sub!.status === "unpaid") && !sub!.cancelAtPeriodEnd && (
              <form action={cancelSubscription}>
                <Button type="submit" variant="secondary" size="sm">Cancel renewal</Button>
              </form>
            )}
            {sub!.status === "active" && (
              <form action={pauseSubscription}>
                <Button type="submit" variant="ghost" size="sm">Pause billing</Button>
              </form>
            )}
            {sub!.status === "paused" && (
              <form action={resumeSubscription}>
                <Button type="submit" size="sm">Resume</Button>
              </form>
            )}
            {sub!.provider === "stripe" && sub!.customerId && (
              <form action={openBillingPortal}>
                <Button type="submit" variant="ghost" size="sm">Card and invoices</Button>
              </form>
            )}
          </div>
        )}
      </Card>

      {live && sub && effectivePlan(sub.plan !== "free" ? { plan: sub.plan, status: sub.status } : null) === "duo" && (
        <Card className="mt-6 max-w-2xl">
          <h2 className="font-semibold text-text">Your second person</h2>
          <p className="mt-1 mb-4 max-w-xl text-text-muted">
            They sign in with their own email. They get Duo on their own booking page, and can switch to yours to manage bookings, availability,
            event types, links, clients and packages. Billing, settings, integrations, calendar connections, earnings and invoices stay yours alone.
          </p>
          <SeatForm seat={seat} />
        </Card>
      )}

      {!holding && (
        <>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <div role="group" aria-label="Currency" className="flex rounded-pill border border-border p-1">
              {toggle("currency", "INR", "₹ INR", currency === "INR")}
              {toggle("currency", "USD", "$ USD", currency === "USD")}
            </div>
            <div role="group" aria-label="Billing period" className="flex rounded-pill border border-border p-1">
              {toggle("interval", "month", "Monthly", interval === "month")}
              {toggle("interval", "year", "Yearly · 2 months free", interval === "year")}
            </div>
          </div>
          <div className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-2">
            {(["solo", "duo"] as const).map((plan) => {
              const ready = providerReady && providerPriceId(provider, plan, interval) !== null;
              return (
                <Card key={plan}>
                  <h2 className="font-display text-lg text-text">{PLAN_NAMES[plan]}</h2>
                  <p className="mt-1 text-text">{priceLine(plan, interval, currency)}</p>
                  <ul className="mt-3 grid gap-1 text-sm text-text-muted">
                    {FEATURES[plan].map((f) => <li key={f}>{f}</li>)}
                  </ul>
                  {ready ? (
                    <form action={choosePlan} className="mt-4">
                      <input type="hidden" name="plan" value={plan} />
                      <input type="hidden" name="interval" value={interval} />
                      <input type="hidden" name="currency" value={currency} />
                      <Button type="submit" className="w-full">Choose {PLAN_NAMES[plan]}</Button>
                    </form>
                  ) : (
                    <p className="mt-4 text-sm text-text-muted">{live ? ERRORS.not_configured : ERRORS.demo}</p>
                  )}
                </Card>
              );
            })}
          </div>
          <p className="mt-4 max-w-xl text-sm text-text-muted">
            {currency === "INR"
              ? "Paid in rupees through Razorpay, by UPI AutoPay or card. Prices are shown before 18% GST."
              : "Paid in US dollars through Stripe, by card. Cancel or pause any time from this page."}
          </p>
        </>
      )}
    </div>
  );
}
