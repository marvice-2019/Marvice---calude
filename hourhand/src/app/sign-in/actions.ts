"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled, getAuth, googleEnabled } from "@/lib/auth/auth";

export type SignInState = { status: "idle" | "sent" | "error"; email?: string; error?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestMagicLink(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { status: "error", email, error: "Enter a valid email address." };
  if (!authEnabled()) return { status: "error", email, error: "Sign-in needs the database. Start the app with HOURHAND_DATA=postgres." };
  try {
    await getAuth().api.signInMagicLink({ body: { email, callbackURL: "/dashboard/event-types", errorCallbackURL: "/sign-in?error=link" }, headers: await headers() });
  } catch (error) {
    console.error("magic link request failed", error instanceof Error ? error.message : error);
    return { status: "error", email, error: "We couldn't send the link just now. Try again in a minute." };
  }
  return { status: "sent", email };
}

export async function signInWithGoogle(): Promise<void> {
  if (!authEnabled() || !googleEnabled()) redirect("/sign-in");
  const result = await getAuth().api.signInSocial({ body: { provider: "google", callbackURL: "/dashboard/event-types" }, headers: await headers() });
  if (!result.url) redirect("/sign-in");
  redirect(result.url);
}
