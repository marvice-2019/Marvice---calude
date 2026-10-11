"use server";

import { revalidatePath } from "next/cache";
import { store, type EventTypeInUseError, type QuestionDraft } from "@/lib/data";
import { isNamedError } from "@/lib/data/types";
import { SLUG_TAKEN, priceGateError, validateEventType, validateQuestions, type EventTypeErrors, type EventTypeForm, type QuestionErrors } from "@/lib/event-types";
import { requireUser } from "@/lib/auth/session";
import { authEnabled } from "@/lib/auth/auth";
import { hostPlan } from "@/lib/billing/account";
import { getPool } from "@/lib/data/pg-store";
import { razorpayStatus } from "@/lib/payments/host-razorpay";

export type SaveResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; errors: EventTypeErrors; questionErrors: QuestionErrors };

function refresh(userSlug: string, id?: string) {
  revalidatePath("/dashboard/event-types");
  if (id) revalidatePath(`/dashboard/event-types/${id}`);
  revalidatePath(`/${userSlug}`, "layout");
}

/** Why the host can't charge this price, checked here on the server whatever the editor showed. Null when they can. */
async function priceError(userId: string, priceMinor: number | null): Promise<string | null> {
  if (priceMinor === null) return null;
  if (!authEnabled()) return priceGateError({ priceMinor, demo: true, plan: "free", razorpayConnected: false });
  const pool = getPool(process.env.DATABASE_URL as string);
  const [plan, razorpay] = await Promise.all([hostPlan(pool, userId), razorpayStatus(pool, userId)]);
  return priceGateError({ priceMinor, demo: false, plan, razorpayConnected: razorpay !== null });
}

/** Creates the event type when `id` is null, otherwise updates it. Saves details, rules and questions together. */
export async function saveEventType(id: string | null, form: EventTypeForm, questions: QuestionDraft[]): Promise<SaveResult> {
  const user = await requireUser();
  const others = (await store.listEventTypes(user.id)).filter((e) => e.id !== id).map((e) => e.slug);
  const details = validateEventType(form, others);
  const checked = validateQuestions(questions);
  if (!details.ok || !checked.ok) {
    return { ok: false, errors: details.ok ? {} : details.errors, questionErrors: checked.ok ? [] : checked.errors };
  }
  const gate = await priceError(user.id, details.value.priceMinor);
  if (gate) return { ok: false, errors: { price: gate }, questionErrors: [] };
  // A deposit is a payment too: same plan and Razorpay requirement.
  const depositGate = await priceError(user.id, details.value.depositMinor);
  if (depositGate) return { ok: false, errors: { deposit: depositGate }, questionErrors: [] };
  try {
    const saved = id ? await store.updateEventType(user.id, id, details.value) : await store.createEventType(user.id, details.value);
    await store.saveQuestions(user.id, saved.id, checked.value);
    refresh(user.slug, saved.id);
    return { ok: true, id: saved.id, slug: saved.slug };
  } catch (e) {
    if (isNamedError(e, "SlugTakenError")) return { ok: false, errors: { slug: SLUG_TAKEN }, questionErrors: [] };
    throw e;
  }
}

export async function setEventTypeActive(id: string, active: boolean): Promise<void> {
  const user = await requireUser();
  await store.setEventTypeActive(user.id, id, active === true);
  refresh(user.slug, id);
}

/** Returns the reason when the event type can't be deleted. */
export async function deleteEventType(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    await store.deleteEventType(user.id, id);
  } catch (e) {
    if (isNamedError<EventTypeInUseError>(e, "EventTypeInUseError")) return { ok: false, error: e.message };
    throw e;
  }
  refresh(user.slug);
  return { ok: true };
}
