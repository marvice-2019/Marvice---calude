import { resolveBaseUrl } from "../auth/auth";
import { parseKey } from "../crypto/seal";
import { googleClientFromEnv, type GoogleClient } from "./google";
import { ICLOUD_CALDAV_URL, icloudClient } from "./icloud";
import { microsoftClientFromEnv } from "./microsoft";
import type { CalendarProviders, OAuthProviderId } from "./provider";

type Env = Record<string, string | undefined>;

/** The calendar providers with an OAuth client in the environment. Each works without the other. */
function configuredProviders(env: Env): { providers: CalendarProviders; google: GoogleClient | undefined } {
  const google = googleClientFromEnv(env) ?? undefined;
  const microsoft = microsoftClientFromEnv(env) ?? undefined;
  return { providers: { ...(google ? { google } : {}), ...(microsoft ? { microsoft } : {}) }, google };
}

/** Why calendars are configured but can't run, or null. The job runner refuses to start on this; pages just say "not set up". */
export function calendarConfigError(env: Env = process.env): string | null {
  if (env.HOURHAND_DATA !== "postgres") return null;
  const ids = Object.keys(configuredProviders(env).providers);
  if (ids.length === 0) return null;
  try {
    parseKey(env.TOKEN_ENCRYPTION_KEY);
    return null;
  } catch (error) {
    const what = ids.map((id) => (id === "google" ? "Google Calendar" : "Outlook")).join(" and ");
    return `${what} ${ids.length > 1 ? "are" : "is"} configured but ${(error as Error).message}`;
  }
}

/** iCloud needs no OAuth client. ICLOUD_CALDAV_URL points it at a fake CalDAV server, outside production only (as Microsoft's URLs). */
function icloudFromEnv(env: Env) {
  const fakeAllowed = env.NODE_ENV !== "production" || env.HOURHAND_E2E === "1";
  return icloudClient({ baseUrl: (fakeAllowed && env.ICLOUD_CALDAV_URL?.replace(/\/+$/, "")) || ICLOUD_CALDAV_URL });
}

/**
 * Calendars need the Postgres store and a valid TOKEN_ENCRYPTION_KEY. Null when either is missing. Google and Microsoft
 * also need their OAuth client; iCloud is always there, since hosts bring their own app-specific password.
 * `google` is the Google client when configured, for watch channels.
 */
export function calendarDeps(env: Env = process.env): { providers: CalendarProviders; google: GoogleClient | undefined; key: Buffer } | null {
  if (env.HOURHAND_DATA !== "postgres") return null;
  const { providers, google } = configuredProviders(env);
  let key: Buffer;
  try {
    key = parseKey(env.TOKEN_ENCRYPTION_KEY);
  } catch {
    return null; // calendarConfigError says why, when an OAuth provider is configured
  }
  return { providers: { ...providers, icloud: icloudFromEnv(env) }, google, key };
}

/** Where the provider sends the host back. Add exactly this URL to that provider's OAuth client as a redirect URI. */
export function calendarRedirectUri(fallbackOrigin: string, env: Env = process.env, provider: OAuthProviderId = "google"): string {
  return `${(resolveBaseUrl(env) ?? fallbackOrigin).replace(/\/+$/, "")}/api/calendars/${provider}/callback`;
}
