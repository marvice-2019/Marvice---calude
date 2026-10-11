import { resolveBaseUrl } from "../auth/auth";
import { tokenKey } from "../crypto/seal";
import { googleClientFromEnv, type GoogleClient } from "./google";

/** Google Calendar needs the Postgres store, a Google OAuth client and TOKEN_ENCRYPTION_KEY. Null when any is missing. */
export function calendarDeps(env: Record<string, string | undefined> = process.env): { google: GoogleClient; key: Buffer } | null {
  if (env.HOURHAND_DATA !== "postgres") return null;
  const google = googleClientFromEnv(env);
  if (!google) return null;
  return { google, key: tokenKey() };
}

/** Where Google sends the host back. Add exactly this URL to the OAuth client's authorized redirect URIs. */
export function calendarRedirectUri(fallbackOrigin: string, env: Record<string, string | undefined> = process.env): string {
  return `${(resolveBaseUrl(env) ?? fallbackOrigin).replace(/\/+$/, "")}/api/calendars/google/callback`;
}
