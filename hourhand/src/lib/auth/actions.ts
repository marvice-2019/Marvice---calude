"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled, getAuth } from "./auth";
import { store } from "@/lib/data";
import { requireUser } from "./session";

export async function signOut(): Promise<void> {
  if (authEnabled()) await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}

export type DeleteAccountState = { error?: string };

/**
 * Closes the signed-in host's account after they type their email to confirm. Their links stop working at once,
 * upcoming bookings are cancelled, every session ends, and the data is purged 30 days later.
 */
export async function deleteMyAccount(_prev: DeleteAccountState, form: FormData): Promise<DeleteAccountState> {
  const user = await requireUser();
  if (!authEnabled()) return { error: "The demo data can't be deleted." };
  const typed = String(form.get("confirm-email") ?? "").trim().toLowerCase();
  if (typed !== user.email.toLowerCase()) return { error: "Type your email exactly as shown to confirm." };
  await store.deleteAccount(user.id);
  redirect("/sign-in?closed=1");
}

/** Ends every session this host has, on every device, including this one. */
export async function signOutEverywhere(): Promise<void> {
  await requireUser();
  if (authEnabled()) await getAuth().api.revokeSessions({ headers: await headers() });
  redirect("/sign-in");
}
