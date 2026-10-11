"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth/auth";
import { ACTING_COOKIE, requireUser } from "@/lib/auth/session";
import { kickJobs } from "@/lib/jobs/kick";
import { getPool } from "@/lib/data/pg-store";
import { isNamedError } from "@/lib/data/types";
import { acceptSeat, inviteSeat, leaveSeat, removeSeat, seatOwner, type SeatActionError } from "@/lib/seats";

// Every action works from the signed-in person's own account (requireUser, never requireHost): a second person can't
// invite, remove or accept on the owner's behalf.

export type SeatFormState = { status: "idle" } | { status: "invited" } | { status: "error"; error: string };

const MESSAGES: Record<string, string> = {
  not_duo: "Adding a second person comes with the Duo plan.",
  invalid_email: "Enter a valid email address.",
  own_email: "That's your own email. Enter the other person's.",
  taken: "That person is already the second person on another Duo plan.",
};
const db = () => getPool(process.env.DATABASE_URL as string);

export async function inviteSeatAction(_prev: SeatFormState, form: FormData): Promise<SeatFormState> {
  const user = await requireUser();
  if (!authEnabled()) return { status: "error", error: "The demo copy can't add people." };
  try {
    await inviteSeat(db(), user, String(form.get("email") ?? ""), new Date());
  } catch (error) {
    if (isNamedError<SeatActionError>(error, "SeatActionError")) return { status: "error", error: MESSAGES[error.code] };
    throw error;
  }
  kickJobs();
  revalidatePath("/dashboard/plan");
  return { status: "invited" };
}

export async function removeSeatAction(): Promise<void> {
  const user = await requireUser();
  if (authEnabled()) await removeSeat(db(), user.id);
  revalidatePath("/dashboard/plan");
}

export async function acceptSeatAction(): Promise<void> {
  const user = await requireUser();
  if (authEnabled()) await acceptSeat(db(), user);
  revalidatePath("/dashboard", "layout");
}

export async function leaveSeatAction(): Promise<void> {
  const user = await requireUser();
  if (authEnabled()) await leaveSeat(db(), user);
  (await cookies()).delete(ACTING_COOKIE);
  revalidatePath("/dashboard", "layout");
}

/** Switch to managing the owner's account. The cookie only names the owner; each request checks the seat again. */
export async function startActingAction(): Promise<void> {
  const user = await requireUser();
  const owner = authEnabled() ? await seatOwner(db(), user.id) : null;
  if (!owner) redirect("/dashboard/event-types");
  (await cookies()).set(ACTING_COOKIE, owner.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  redirect("/dashboard/bookings");
}

export async function stopActingAction(): Promise<void> {
  await requireUser();
  (await cookies()).delete(ACTING_COOKIE);
  redirect("/dashboard/event-types");
}
