"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled, getAuth, googleEnabled } from "@/lib/auth/auth";
import { clientIp, rateLimiter, SIGN_IN_LIMITS } from "@/lib/rate-limit";

export type SignInState = { status: "idle" | "sent" | "error"; email?: string; error?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestMagicLink(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { status: "error", email, error: "Enter a valid email address." };
  if (!authEnabled()) return { status: "error", email, error: "Sign-in needs the database. Start the app with HOURHAND_DATA=postgres." };
  const requestHeaders = await headers();
  // Server actions call Better Auth directly, past its HTTP rate limiter, so the limits are applied here.
  if (!rateLimiter.take(`ip:${clientIp(requestHeaders)}`, SIGN_IN_LIMITS.perIp) || !rateLimiter.take(`email:${email}`, SIGN_IN_LIMITS.perEmail)) {
    return { status: "error", email, error: "Too many sign-in links asked for. Wait ten minutes, then try again." };
  }
  try {
    await getAuth().api.signInMagicLink({ body: { email, callbackURL: "/dashboard/event-types", errorCallbackURL: "/sign-in?error=link" }, headers: requestHeaders });
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
