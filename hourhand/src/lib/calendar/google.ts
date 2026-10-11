// Google Calendar over plain HTTPS: OAuth (with PKCE), the calendar list, free/busy, and the host's booked events.
// Endpoints are injectable so tests and the end-to-end run can point at a fake Google.

/**
 * The fewest scopes that do the job. `events.owned` only touches calendars the host owns, not shared ones.
 * `events.freebusy` reads availability (never event details) on every calendar the host can see, and is the narrowest
 * scope that also lets Hourhand watch those calendars for changes; `calendar.freebusy` can't watch.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned",
] as const;

/** Scopes the host must grant for the connection to work (Google lets people untick some on the consent screen). */
export const REQUIRED_SCOPES = GOOGLE_CALENDAR_SCOPES.filter((s) => s.startsWith("https://"));

export interface GoogleEndpoints { auth: string; token: string; revoke: string; api: string }

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://www.googleapis.com/calendar/v3",
};

/**
 * A failed Google call. `retryable`: trying later can work (rate limits, outages). `revoked`: the host must reconnect
 * (they removed access, or a permission is missing); retrying never helps.
 */
export class GoogleApiError extends Error {
  readonly status: number | null;
  readonly reason: string | null;
  readonly retryable: boolean;
  readonly revoked: boolean;
  constructor(message: string, opts: { status?: number | null; reason?: string | null; retryable: boolean; revoked?: boolean }) {
    super(message);
    this.name = "GoogleApiError";
    this.status = opts.status ?? null;
    this.reason = opts.reason ?? null;
    this.retryable = opts.retryable;
    this.revoked = opts.revoked ?? false;
  }
}

export interface TokenSet { accessToken: string; refreshToken: string | null; expiresAt: Date; scope: string; email: string | null }
export interface GoogleCalendarEntry { id: string; name: string; primary: boolean; accessRole: string }
export interface BusyRange { start: Date; end: Date }

export interface EventInput {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  location: string | null;
  attendee: { email: string; name: string };
  withMeet: boolean;
  bookingId: string;
}
export interface EventResult { id: string; joinUrl: string | null; conferencePending: boolean }

type Fetch = typeof fetch;
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]);

/** Google event ids use base32hex (0-9, a-v), 5 to 1024 characters. A booking's uuid in hex fits, so an event id is fixed per booking. */
export function eventIdFor(bookingId: string): string {
  return `hh${bookingId.replace(/-/g, "").toLowerCase()}`;
}

/** Reads the email claim from an id token received directly from Google's token endpoint over TLS (no signature check needed then). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string; email_verified?: boolean };
    return payload.email && payload.email_verified !== false ? payload.email : null;
  } catch {
    return null;
  }
}

function joinUrlOf(event: { hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[]; createRequest?: { status?: { statusCode?: string } } } }) {
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
  const joinUrl = event.hangoutLink ?? video ?? null;
  return { joinUrl, conferencePending: !joinUrl && event.conferenceData?.createRequest?.status?.statusCode === "pending" };
}

export function googleClient(opts: { clientId: string; clientSecret: string; endpoints?: GoogleEndpoints; fetchImpl?: Fetch }) {
  const ep = opts.endpoints ?? GOOGLE_ENDPOINTS;
  const f = opts.fetchImpl ?? fetch;

  async function call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new GoogleApiError(`Could not reach Google: ${(error as Error).message}`, { retryable: true });
    }
  }

  async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await call(ep.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const reason = (body.error as string) ?? null;
      // invalid_grant: the refresh token was revoked or expired, or the code was already used. Only a reconnect fixes it.
      throw new GoogleApiError(`Google token endpoint ${res.status} ${reason ?? ""}`.trim(), {
        status: res.status, reason, retryable: res.status === 429 || res.status >= 500, revoked: reason === "invalid_grant",
      });
    }
    return body;
  }

  async function api<T>(accessToken: string, method: string, path: string, opts2: { query?: Record<string, string>; body?: unknown; okStatuses?: number[] } = {}): Promise<{ status: number; body: T }> {
    const url = new URL(`${ep.api}${path}`);
    for (const [k, v] of Object.entries(opts2.query ?? {})) url.searchParams.set(k, v);
    const res = await call(url.toString(), {
      method, headers: { authorization: `Bearer ${accessToken}`, ...(opts2.body ? { "content-type": "application/json" } : {}) },
      body: opts2.body ? JSON.stringify(opts2.body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* an HTML error page from a proxy: classify by status alone */ }
    const body = parsed as T & { error?: { message?: string; errors?: { reason?: string }[] } };
    if (res.ok || opts2.okStatuses?.includes(res.status)) return { status: res.status, body };
    const reason = body.error?.errors?.[0]?.reason ?? null;
    const message = `Google ${method} ${path.split("?")[0]} ${res.status} ${reason ?? ""}: ${body.error?.message ?? ""}`.trim();
    const rate = res.status === 429 || (res.status === 403 && reason !== null && RATE_REASONS.has(reason));
    throw new GoogleApiError(message, {
      status: res.status, reason,
      retryable: rate || res.status >= 500,
      // 401 means the access token is bad (the caller refreshes first); a 403 that isn't a rate limit is a missing permission.
      revoked: res.status === 403 && !rate,
    });
  }

  return {
    authUrl(p: { redirectUri: string; state: string; codeChallenge: string; loginHint?: string }): string {
      const url = new URL(ep.auth);
      url.search = new URLSearchParams({
        client_id: opts.clientId, redirect_uri: p.redirectUri, response_type: "code", scope: GOOGLE_CALENDAR_SCOPES.join(" "),
        access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: p.state,
        code_challenge: p.codeChallenge, code_challenge_method: "S256", ...(p.loginHint ? { login_hint: p.loginHint } : {}),
      }).toString();
      return url.toString();
    },

    async exchangeCode(p: { code: string; redirectUri: string; codeVerifier: string }, now = new Date()): Promise<TokenSet> {
      const body = await tokenRequest({
        code: p.code, client_id: opts.clientId, client_secret: opts.clientSecret, redirect_uri: p.redirectUri,
        grant_type: "authorization_code", code_verifier: p.codeVerifier,
      });
      return {
        accessToken: body.access_token as string, refreshToken: (body.refresh_token as string) ?? null,
        expiresAt: new Date(now.getTime() + Number(body.expires_in ?? 3600) * 1000), scope: (body.scope as string) ?? "",
        email: emailFromIdToken(body.id_token as string | undefined),
      };
    },

    async refresh(refreshToken: string, now = new Date()): Promise<{ accessToken: string; expiresAt: Date }> {
      const body = await tokenRequest({ client_id: opts.clientId, client_secret: opts.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken });
      return { accessToken: body.access_token as string, expiresAt: new Date(now.getTime() + Number(body.expires_in ?? 3600) * 1000) };
    },

    /** Best effort: tells Google to drop the grant. A failure here never blocks a disconnect. */
    async revoke(token: string): Promise<void> {
      await call(ep.revoke, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }).catch(() => undefined);
    },

    async listCalendars(accessToken: string): Promise<GoogleCalendarEntry[]> {
      const out: GoogleCalendarEntry[] = [];
      let pageToken: string | undefined;
      do {
        const { body } = await api<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole: string }[]; nextPageToken?: string }>(
          accessToken, "GET", "/users/me/calendarList", { query: { maxResults: "250", ...(pageToken ? { pageToken } : {}) } });
        for (const c of body.items ?? []) out.push({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id, primary: c.primary === true, accessRole: c.accessRole });
        pageToken = body.nextPageToken;
      } while (pageToken);
      return out;
    },

    /** Busy ranges per calendar id. A calendar Google reports an error for is returned in `errors`, not silently as free. */
    async freeBusy(accessToken: string, calendarIds: string[], timeMin: Date, timeMax: Date): Promise<{ busy: Map<string, BusyRange[]>; errors: Map<string, string> }> {
      const busy = new Map<string, BusyRange[]>();
      const errors = new Map<string, string>();
      for (let i = 0; i < calendarIds.length; i += 50) {
        const ids = calendarIds.slice(i, i + 50);
        const { body } = await api<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> }>(
          accessToken, "POST", "/freeBusy", { body: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: ids.map((id) => ({ id })) } });
        for (const id of ids) {
          const c = body.calendars?.[id];
          if (!c || c.errors?.length) errors.set(id, c?.errors?.[0]?.reason ?? "missing from response");
          else busy.set(id, (c.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })));
        }
      }
      return { busy, errors };
    },

    /** Creates the event with a fixed id per booking: a retry after a lost response gets 409 and reads the existing event. */
    async insertEvent(accessToken: string, calendarId: string, e: EventInput): Promise<EventResult> {
      const id = eventIdFor(e.bookingId);
      const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
      const { status, body } = await api<Record<string, never>>(accessToken, "POST", path, {
        query: { conferenceDataVersion: "1", sendUpdates: "none" }, okStatuses: [409],
        body: {
          id, summary: e.summary, description: e.description,
          start: { dateTime: e.start.toISOString(), timeZone: e.timeZone }, end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
          ...(e.location ? { location: e.location } : {}),
          attendees: [{ email: e.attendee.email, displayName: e.attendee.name, responseStatus: "needsAction" }],
          extendedProperties: { private: { hourhandBookingId: e.bookingId } },
          ...(e.withMeet ? { conferenceData: { createRequest: { requestId: e.bookingId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
        },
      });
      const event = status === 409 ? (await api<Record<string, unknown>>(accessToken, "GET", `${path}/${id}`)).body : body;
      return { id, ...joinUrlOf(event as Parameters<typeof joinUrlOf>[0]) };
    },

    async getEvent(accessToken: string, calendarId: string, eventId: string): Promise<EventResult> {
      const { body } = await api<Record<string, unknown>>(accessToken, "GET", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
      return { id: eventId, ...joinUrlOf(body as Parameters<typeof joinUrlOf>[0]) };
    },

    async moveEvent(accessToken: string, calendarId: string, eventId: string, start: Date, end: Date, timeZone: string, summary: string): Promise<EventResult> {
      const { body } = await api<Record<string, unknown>>(accessToken, "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
        query: { conferenceDataVersion: "1", sendUpdates: "none" },
        body: { summary, start: { dateTime: start.toISOString(), timeZone }, end: { dateTime: end.toISOString(), timeZone } },
      });
      return { id: eventId, ...joinUrlOf(body as Parameters<typeof joinUrlOf>[0]) };
    },

    /**
     * Asks Google to notify `address` when the calendar's events change. The notification carries no details; it only
     * says "look again". Channels expire (a week at most) and must be renewed with a new id.
     */
    async watchEvents(accessToken: string, calendarId: string, ch: { id: string; token: string; address: string; ttlSeconds: number }): Promise<{ resourceId: string; expiresAt: Date | null }> {
      const { body } = await api<{ resourceId?: string; expiration?: string | number }>(accessToken, "POST", `/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
        body: { id: ch.id, token: ch.token, type: "web_hook", address: ch.address, params: { ttl: String(ch.ttlSeconds) } },
      });
      if (!body.resourceId) throw new GoogleApiError("Google returned no resource id for the watch", { retryable: true });
      return { resourceId: body.resourceId, expiresAt: body.expiration ? new Date(Number(body.expiration)) : null };
    },

    /** Stops a notification channel; one already gone counts as stopped. */
    async stopChannel(accessToken: string, id: string, resourceId: string): Promise<void> {
      await api(accessToken, "POST", "/channels/stop", { body: { id, resourceId }, okStatuses: [404, 410] });
    },

    /** Deletes the event; one that is already gone counts as deleted. */
    async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
      await api(accessToken, "DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { query: { sendUpdates: "none" }, okStatuses: [404, 410] });
    },
  };
}

export type GoogleClient = ReturnType<typeof googleClient>;

/**
 * The client from the environment, or null when Google isn't configured. GOOGLE_API_BASE_URL points every endpoint at
 * a fake Google for tests; a production server ignores it unless HOURHAND_E2E=1, so a stray setting can't send hosts'
 * tokens anywhere else.
 */
export function googleClientFromEnv(env: Record<string, string | undefined> = process.env): GoogleClient | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const fakeAllowed = env.NODE_ENV !== "production" || env.HOURHAND_E2E === "1";
  const fake = fakeAllowed ? env.GOOGLE_API_BASE_URL?.replace(/\/+$/, "") : undefined;
  const endpoints = fake ? { auth: `${fake}/o/oauth2/v2/auth`, token: `${fake}/token`, revoke: `${fake}/revoke`, api: `${fake}/calendar/v3` } : GOOGLE_ENDPOINTS;
  return googleClient({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, endpoints });
}
