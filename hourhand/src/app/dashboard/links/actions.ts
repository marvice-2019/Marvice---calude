"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireHost } from "@/lib/auth/session";
import { store } from "@/lib/data";
import { isNamedError, LOCATION_KINDS, type InvalidOneOffError, type LocationKind } from "@/lib/data/types";
import { LOCATION_VALUE_LABEL } from "@/lib/event-types";
import { parseLocalTimes } from "@/lib/links-form";

// Each action checks the session itself; every store call takes the signed-in host's id, so another host's link or
// event type is simply not found. The raw link is returned once, here, and never stored.

export type LinkFormState =
  | { status: "idle" }
  | { status: "created"; path: string }
  | { status: "error"; message: string };

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const MAX_LABEL = 100;

export async function createSingleUseLink(_prev: LinkFormState, form: FormData): Promise<LinkFormState> {
  const user = await requireHost();
  const eventTypeId = field(form, "eventTypeId");
  const label = field(form, "label");
  if (!eventTypeId) return { status: "error", message: "Pick the event type the link books." };
  if (label.length > MAX_LABEL) return { status: "error", message: `Keep the note under ${MAX_LABEL} characters.` };
  try {
    const { token } = await store.createBookingLink(user.id, eventTypeId, { label: label || undefined }, new Date());
    revalidatePath("/dashboard/links");
    return { status: "created", path: `/l/${token}` };
  } catch (error) {
    if (isNamedError(error, "NotFoundError")) return { status: "error", message: "That event type isn't available. Turn it on first, or pick another." };
    throw error;
  }
}

export async function createOneOff(_prev: LinkFormState, form: FormData): Promise<LinkFormState> {
  const user = await requireHost();
  const name = field(form, "name");
  const duration = Number(field(form, "durationMinutes"));
  const kind = field(form, "locationKind") as LocationKind;
  const value = field(form, "locationValue");
  const description = field(form, "description");
  if (!LOCATION_KINDS.includes(kind)) return { status: "error", message: "Pick where you'll meet." };
  const valueLabel = LOCATION_VALUE_LABEL[kind];
  if (valueLabel && !value) return { status: "error", message: `Add the ${valueLabel.toLowerCase()} so your guest knows where to go.` };
  if (description.length > 2000) return { status: "error", message: "Keep the description under 2000 characters." };
  const parsed = parseLocalTimes(form.getAll("times").map(String), user.timezone);
  if (!parsed.ok) return { status: "error", message: parsed.error };
  try {
    const { token } = await store.createOneOffMeeting(user.id, {
      name, durationMinutes: Number.isInteger(duration) ? duration : 0, description: description || null,
      location: { kind, value: valueLabel ? value : null }, times: parsed.times,
    }, new Date());
    revalidatePath("/dashboard/links");
    return { status: "created", path: `/l/${token}` };
  } catch (error) {
    if (isNamedError<InvalidOneOffError>(error, "InvalidOneOffError")) return { status: "error", message: error.message };
    throw error;
  }
}

export async function revokeLink(form: FormData): Promise<void> {
  const user = await requireHost();
  let target = "/dashboard/links?done=revoked";
  try {
    await store.revokeBookingLink(user.id, field(form, "linkId"), new Date());
  } catch (error) {
    if (!(isNamedError(error, "NotFoundError"))) throw error;
    target = "/dashboard/links?error=not_revocable";
  }
  revalidatePath("/dashboard/links");
  redirect(target);
}
