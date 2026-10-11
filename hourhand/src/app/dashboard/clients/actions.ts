"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { clientKey } from "@/lib/clients";
import { store } from "@/lib/data";

const MAX_NOTE = 5000;

/** Saves the signed-in host's note about one of their own clients (someone who has booked them). */
export async function saveClientNoteAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const key = String(form.get("key") ?? "");
  const note = String(form.get("note") ?? "");
  // The email comes from the host's own bookings, never from the form, so a note can only be about their own client.
  const email = (await store.listBookings(user.id)).map((b) => b.invitee.email).find((e) => clientKey(e) === key);
  if (!email) redirect("/dashboard/clients?error=not_found");
  if (note.length > MAX_NOTE) redirect(`/dashboard/clients/${key}?error=too_long`);
  await store.saveClientNote(user.id, email, note);
  revalidatePath(`/dashboard/clients/${key}`);
  redirect(`/dashboard/clients/${key}?saved=1`);
}
