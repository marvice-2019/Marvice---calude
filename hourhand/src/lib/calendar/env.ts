import { resolveBaseUrl } from "../auth/auth";
import { parseKey } from "../crypto/seal";
import { googleClientFromEnv, type GoogleClient } from "./google";

/** Why Google Calendar is configured but can't run, or null. The job runner refuses to start on this; pages just say "not set up". */
export function calendarConfigError(env: Record<string, string | undefined> = process.env): string | null {
  if (env.HOURHAND_DATA !== "postgres" || !googleClientFromEnv(env)) return null;
  try {
    parseKey(env.TOKEN_ENCRYPTION_KEY);
    return null;
  } catch (error) {
    return `Google Calendar is configured but ${(error as Error).message}`;
  }
}

/** Google Calendar needs the Postgres store, a Google OAuth client and a valid TOKEN_ENCRYPTION_KEY. Null when any is missing. */
export function calendarDeps(env: Record<string, string | undefined> = process.env): { google: GoogleClient; key: Buffer } | null {
  if (env.HOURHAND_DATA !== "postgres") return null;
  const google = googleClientFromEnv(env);
  if (!google || calendarConfigError(env)) return null;
  return { google, key: parseKey(env.TOKEN_ENCRYPTION_KEY) };
}

/** Where Google sends the host back. Add exactly this URL to the OAuth client's authorized redirect URIs. */
export function calendarRedirectUri(fallbackOrigin: string, env: Record<string, string | undefined> = process.env): string {
  return `${(resolveBaseUrl(env) ?? fallbackOrigin).replace(/\/+$/, "")}/api/calendars/google/callback`;
}
