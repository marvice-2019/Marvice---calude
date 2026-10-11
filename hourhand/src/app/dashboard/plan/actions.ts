"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authEnabled, resolveBaseUrl } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { BillingActionError, billingPortalUrl, cancelPlan, pausePlan, resumePlan, startCheckout } from "@/lib/billing/account";
import type { BillingInterval, Currency, PaidPlan } from "@/lib/billing/plans";
import { getPool } from "@/lib/data/pg-store";

// Each action checks the session itself and only touches the signed-in host's own subscription.

const pool = () => getPool(process.env.DATABASE_URL as string);
const baseUrl = () => (resolveBaseUrl() ?? "http://localhost:3000").replace(/\/+$/, "");

const PLANS: PaidPlan[] = ["solo", "duo"];
const INTERVALS: BillingInterval[] = ["month", "year"];
const CURRENCIES: Currency[] = ["INR", "USD"];
const pick = <T extends string>(allowed: T[], v: FormDataEntryValue | null): T | null => (allowed.includes(v as T) ? (v as T) : null);

/** Runs a change and sends the host back to the plan page with its outcome. redirect() must stay outside the try. */
async function run(change: () => Promise<string | void>, done: string): Promise<never> {
  let target = `/dashboard/plan?done=${done}`;
  try {
    const url = await change();
    if (url) target = url;
  } catch (error) {
    if (!(error instanceof BillingActionError)) throw error;
    target = `/dashboard/plan?error=${error.code}`;
  }
  revalidatePath("/dashboard/plan");
  redirect(target);
}

export async function choosePlan(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) redirect("/dashboard/plan?error=demo");
  const plan = pick(PLANS, form.get("plan"));
  const interval = pick(INTERVALS, form.get("interval"));
  const currency = pick(CURRENCIES, form.get("currency"));
  if (!plan || !interval || !currency) redirect("/dashboard/plan?error=not_configured");
  await run(() => startCheckout(pool(), user, { plan, interval, currency }, baseUrl()), "checkout");
}

export async function cancelSubscription(): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) redirect("/dashboard/plan?error=demo");
  await run(() => cancelPlan(pool(), user.id), "cancelled");
}

export async function pauseSubscription(): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) redirect("/dashboard/plan?error=demo");
  await run(() => pausePlan(pool(), user.id), "paused");
}

export async function resumeSubscription(): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) redirect("/dashboard/plan?error=demo");
  await run(() => resumePlan(pool(), user.id), "resumed");
}

export async function openBillingPortal(): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) redirect("/dashboard/plan?error=demo");
  await run(() => billingPortalUrl(pool(), user.id, `${baseUrl()}/dashboard/plan`), "portal");
}
