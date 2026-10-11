"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { store } from "@/lib/data";
import { isNamedError, NotFoundError } from "@/lib/data/types";
import { handleHostReschedule } from "@/lib/manage";

// Each action checks the session itself; the store methods only touch bookings whose host_id is the signed-in host.

const MAX_REASON = 500;
const page = (id: string) => `/dashboard/bookings/${encodeURIComponent(id)}`;
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** Runs a change and sends the host to the page it returns. redirect() must stay outside the try. */
async function run(id: string, change: () => Promise<string>): Promise<never> {
  let target: string;
  try {
    target = await change();
  } catch (error) {
    if (!(isNamedError(error, "NotFoundError"))) throw error;
    target = `${page(id)}?error=not_found`;
  }
  revalidatePath("/dashboard/bookings");
  redirect(target);
}

export async function cancelAsHost(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = field(form, "bookingId");
  const reason = field(form, "reason");
  if (reason.length > MAX_REASON) redirect(`${page(id)}?confirm=cancel&error=reason_too_long`);
  await run(id, async () => {
    const booking = await store.getBooking(user.id, id);
    if (!booking) throw new NotFoundError("Booking");
    // The host can cancel any time before the start; there is no guest-style cutoff.
    if (booking.status !== "confirmed" || booking.startAt.getTime() <= Date.now()) return `${page(id)}?error=not_cancellable`;
    await store.cancelBooking(user.id, id, "host", reason || undefined, { laterWeeks: form.get("laterWeeks") === "on" });
    return `${page(id)}?done=cancelled`;
  });
}

export async function rescheduleAsHost(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = field(form, "bookingId");
  await run(id, async () => {
    const result = await handleHostReschedule(store, user.id, id, { start: field(form, "start"), idempotencyKey: field(form, "key") }, new Date());
    const body = result.body as { bookingId?: string; error?: string };
    if (result.status === 404) throw new NotFoundError("Booking");
    if (result.status < 300 && body.bookingId) return `${page(body.bookingId)}?done=rescheduled`;
    const error = body.error === "slot_taken" ? "slot_taken" : result.status === 400 ? "bad_time" : "not_movable";
    return `${page(id)}?reschedule=1&error=${error}`;
  });
}

export async function setNoShow(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = field(form, "bookingId");
  const on = field(form, "on") === "1";
  await run(id, async () => {
    const booking = await store.getBooking(user.id, id);
    if (!booking) throw new NotFoundError("Booking");
    const now = new Date();
    if (booking.status !== "confirmed" || booking.startAt > now) return `${page(id)}?error=not_started`;
    await store.setNoShow(user.id, id, on, now);
    return `${page(id)}?done=${on ? "no_show" : "no_show_undone"}`;
  });
}
