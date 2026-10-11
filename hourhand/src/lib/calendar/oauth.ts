import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { seal, unseal } from "../crypto/seal";
import type { OAuthProviderId } from "./provider";

// The "connect a calendar" handshake (Google, Outlook). Before sending the host to Google we put a sealed, short-lived cookie in
// their browser holding a random state and the PKCE verifier, tied to their user id. The callback only goes ahead when
// Google returns that same state to the same signed-in host, so nobody can attach their own Google account to someone
// else's Hourhand (login CSRF) or replay a stolen code.

// One cookie per provider, so a Google and an Outlook handshake don't overwrite each other. Google's name, path and
// sealing context are unchanged, so a Google handshake in flight across a deploy still finishes.
export const OAUTH_COOKIES: Record<OAuthProviderId, { name: string; path: string; aad: string }> = {
  google: { name: "hh_gcal_oauth", path: "/api/calendars/google", aad: "google-calendar-oauth" },
  microsoft: { name: "hh_mcal_oauth", path: "/api/calendars/microsoft", aad: "microsoft-calendar-oauth" },
};
export const OAUTH_COOKIE = OAUTH_COOKIES.google.name;
export const OAUTH_COOKIE_PATH = OAUTH_COOKIES.google.path;
const TTL_MS = 10 * 60_000;

interface Pending { state: string; verifier: string; userId: string; expiresAt: number }

export function startOAuth(key: Buffer, userId: string, now = new Date(), provider: OAuthProviderId = "google"): { cookie: string; state: string; codeChallenge: string } {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const pending: Pending = { state, verifier, userId, expiresAt: now.getTime() + TTL_MS };
  return {
    cookie: seal(key, pending, OAUTH_COOKIES[provider].aad).toString("base64url"),
    state,
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export type CallbackCheck = { ok: true; verifier: string } | { ok: false; error: "expired" | "state_mismatch" | "wrong_user" };

export function checkOAuthCallback(key: Buffer, cookie: string | undefined, state: string | null, userId: string, now = new Date(), provider: OAuthProviderId = "google"): CallbackCheck {
  if (!cookie || !state) return { ok: false, error: "state_mismatch" };
  let pending: Pending;
  try {
    pending = unseal<Pending>(key, Buffer.from(cookie, "base64url"), OAUTH_COOKIES[provider].aad);
  } catch {
    return { ok: false, error: "state_mismatch" };
  }
  if (now.getTime() > pending.expiresAt) return { ok: false, error: "expired" };
  const a = Buffer.from(pending.state);
  const b = Buffer.from(state);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "state_mismatch" };
  if (pending.userId !== userId) return { ok: false, error: "wrong_user" };
  return { ok: true, verifier: pending.verifier };
}

/** Moved to the Google client; re-exported for existing callers. */
export { missingScopes } from "./google";
