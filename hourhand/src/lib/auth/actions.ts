"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled, getAuth } from "./auth";
import { requireUser } from "./session";

export async function signOut(): Promise<void> {
  if (authEnabled()) await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}

/** Ends every session this host has, on every device, including this one. */
export async function signOutEverywhere(): Promise<void> {
  await requireUser();
  if (authEnabled()) await getAuth().api.revokeSessions({ headers: await headers() });
  redirect("/sign-in");
}
