// Microsoft 365 / Outlook calendars over Microsoft Graph: OAuth (with PKCE) on the `common` tenant, so both work or
// school and personal Microsoft accounts can connect. Endpoints are injectable so tests and the end-to-end run can
// point at a fake Microsoft.

import { TZDate } from "@date-fns/tz";
import {
  CalendarApiError, type BusyRange, type CalendarEntry, type CalendarProvider, type EventInput, type EventResult, type RefreshedToken, type TokenSet,
} from "./provider";

/** `offline_access` gets a refresh token; `User.Read` is what Graph needs to resolve `/me`. */
export const MICROSOFT_CALENDAR_SCOPES = ["openid", "email", "offline_access", "User.Read", "Calendars.ReadWrite"] as const;

/** Scopes the host must grant for the connection to work. */
export const MICROSOFT_REQUIRED_SCOPES = ["Calendars.ReadWrite", "offline_access"] as const;

export interface MicrosoftEndpoints { authorize: string; token: string; graph: string }

export const MICROSOFT_ENDPOINTS: MicrosoftEndpoints = {
  authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  graph: "https://graph.microsoft.com/v1.0",
};

/** A failed Microsoft call. Same meaning as every provider's error: `retryable` try later, `revoked` reconnect. */
export class MicrosoftApiError extends CalendarApiError {
  constructor(message: string, opts: { status?: number | null; reason?: string | null; retryable?: boolean; revoked?: boolean } = {}) {
    super(message, opts);
    this.name = "MicrosoftApiError";
  }
}

type Fetch = typeof fetch;

/** The refresh token was revoked or expired, or the code was already used: only a reconnect fixes these. */
const REVOKED_AADSTS = ["AADSTS70000", "AADSTS700082"];

/** "https://graph.microsoft.com/Calendars.ReadWrite" and "calendars.readwrite" are the same scope. */
function normaliseScope(scope: string): string {
  return scope.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase();
}

/**
 * Reads the account's address from an id token received directly from Microsoft's token endpoint over TLS (no
 * signature check needed then). Personal accounts often carry no `email` claim; `preferred_username` is the sign-in address.
 */
export function emailFromMicrosoftIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string; preferred_username?: string };
    return payload.email || payload.preferred_username || null;
  } catch {
    return null;
  }
}

/**
 * Graph wants a wall-clock time plus a zone. Hourhand always sends UTC: "2026-11-03T04:30:00.000" with timeZone "UTC".
 * Outlook shows the event in each viewer's own zone either way, and there's no zone-name mapping to get wrong.
 */
function graphTime(d: Date): { dateTime: string; timeZone: "UTC" } {
  return { dateTime: d.toISOString().replace(/Z$/, ""), timeZone: "UTC" };
}

/** Reads a Graph time that came back in UTC (we ask for it with `Prefer: outlook.timezone="UTC"`). */
function parseGraphUtc(t: { dateTime: string }): Date {
  return new Date(/(Z|[+-]\d\d:\d\d)$/.test(t.dateTime) ? t.dateTime : `${t.dateTime}Z`);
}

type GraphEvent = { id?: string; isOnlineMeeting?: boolean; onlineMeeting?: { joinUrl?: string } | null };

export function microsoftClient(opts: { clientId: string; clientSecret: string; endpoints?: MicrosoftEndpoints; fetchImpl?: Fetch }): CalendarProvider {
  const ep = opts.endpoints ?? MICROSOFT_ENDPOINTS;
  const f = opts.fetchImpl ?? fetch;

  async function call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new MicrosoftApiError(`Could not reach Microsoft: ${(error as Error).message}`, { retryable: true });
    }
  }

  async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await call(ep.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const reason = typeof body.error === "string" ? body.error : null;
      const description = typeof body.error_description === "string" ? body.error_description : "";
      // The description can carry trace ids and user hints; only the AADSTS code goes in the message.
      const aadsts = description.match(/AADSTS\d+/)?.[0] ?? null;
      throw new MicrosoftApiError(`Microsoft token endpoint ${res.status} ${reason ?? ""} ${aadsts ?? ""}`.replace(/\s+/g, " ").trim(), {
        status: res.status, reason, retryable: res.status === 429 || res.status >= 500,
        revoked: reason === "invalid_grant" || (aadsts !== null && REVOKED_AADSTS.includes(aadsts)),
      });
    }
    return body;
  }

  async function api<T>(accessToken: string, method: string, pathOrUrl: string, o: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string>; okStatuses?: number[] } = {}): Promise<{ status: number; body: T }> {
    // `@odata.nextLink` is absolute; anything else is a path under the Graph base. The token only ever goes to Graph.
    const absolute = /^https?:\/\//.test(pathOrUrl);
    if (absolute && !pathOrUrl.startsWith(`${ep.graph}/`)) throw new MicrosoftApiError("Microsoft returned a next page outside Graph", { retryable: false });
    const url = new URL(absolute ? pathOrUrl : `${ep.graph}${pathOrUrl}`);
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
    const res = await call(url.toString(), {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(o.body ? { "content-type": "application/json" } : {}), ...o.headers },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* an HTML error page from a proxy: classify by status alone */ }
    const body = parsed as T & { error?: { code?: string; message?: string } };
    if (res.ok || o.okStatuses?.includes(res.status)) return { status: res.status, body };
    const code = body.error?.code ?? null;
    const message = `Microsoft ${method} ${url.pathname} ${res.status} ${code ?? ""}: ${body.error?.message ?? ""}`.trim();
    // A 401 can be transient (clock skew near expiry, a CAE claims challenge, replication lag), so it retries with a
    // fresh token. Only a removed permission is final here; a dead grant shows up as invalid_grant at the token endpoint.
    throw new MicrosoftApiError(message, {
      status: res.status, reason: code,
      retryable: res.status === 401 || res.status === 429 || res.status >= 500,
      revoked: res.status === 403 && code === "ErrorAccessDenied",
    });
  }

  function tokenScope(body: Record<string, unknown>): string {
    // Microsoft lists the Graph scopes the access token is valid for, never `offline_access`: the refresh token is the proof of that one.
    const scope = typeof body.scope === "string" ? body.scope : MICROSOFT_CALENDAR_SCOPES.join(" ");
    const hasOffline = scope.split(/\s+/).some((s) => normaliseScope(s) === "offline_access");
    return body.refresh_token && !hasOffline ? `${scope} offline_access`.trim() : scope;
  }

  function eventResult(e: GraphEvent, id: string, teamsRequested: boolean): EventResult {
    const joinUrl = e.onlineMeeting?.joinUrl ?? null;
    return { id: e.id ?? id, joinUrl, conferencePending: teamsRequested && !joinUrl };
  }

  const eventPath = (calendarId: string, eventId?: string) =>
    `/me/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;

  return {
    id: "microsoft",

    authUrl(p) {
      const url = new URL(ep.authorize);
      url.search = new URLSearchParams({
        client_id: opts.clientId, redirect_uri: p.redirectUri, response_type: "code", response_mode: "query",
        scope: MICROSOFT_CALENDAR_SCOPES.join(" "), state: p.state, prompt: "select_account",
        code_challenge: p.codeChallenge, code_challenge_method: "S256", ...(p.loginHint ? { login_hint: p.loginHint } : {}),
      }).toString();
      return url.toString();
    },

    async exchangeCode(p, now = new Date()): Promise<TokenSet> {
      const body = await tokenRequest({
        client_id: opts.clientId, client_secret: opts.clientSecret, grant_type: "authorization_code", code: p.code,
        redirect_uri: p.redirectUri, code_verifier: p.codeVerifier, scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
      });
      return {
        accessToken: body.access_token as string, refreshToken: (body.refresh_token as string) ?? null,
        expiresAt: new Date(now.getTime() + Number(body.expires_in ?? 3600) * 1000), scope: tokenScope(body),
        email: emailFromMicrosoftIdToken(body.id_token as string | undefined),
      };
    },

    /** Microsoft rotates refresh tokens: a new one comes back with most refreshes and replaces the stored one. */
    async refresh(refreshToken, now = new Date()): Promise<RefreshedToken> {
      const body = await tokenRequest({
        client_id: opts.clientId, client_secret: opts.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken,
        scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
      });
      return {
        accessToken: body.access_token as string, expiresAt: new Date(now.getTime() + Number(body.expires_in ?? 3600) * 1000),
        ...(typeof body.refresh_token === "string" && body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      };
    },

    /** Microsoft has no per-token revoke for delegated grants; the host removes the app from their account settings. */
    async revoke(): Promise<void> {},

    missingScopes(granted) {
      const have = new Set(granted.split(/\s+/).filter(Boolean).map(normaliseScope));
      return MICROSOFT_REQUIRED_SCOPES.filter((s) => !have.has(normaliseScope(s)));
    },

    async listCalendars(accessToken): Promise<CalendarEntry[]> {
      type Cal = { id: string; name?: string; isDefaultCalendar?: boolean; canEdit?: boolean; allowedOnlineMeetingProviders?: string[]; owner?: { address?: string } };
      const cals: Cal[] = [];
      let next: string | undefined = "/me/calendars";
      let query: Record<string, string> | undefined = { $select: "id,name,isDefaultCalendar,canEdit,allowedOnlineMeetingProviders,owner" };
      while (next) {
        const { body }: { body: { value?: Cal[]; "@odata.nextLink"?: string } } = await api(accessToken, "GET", next, { query });
        cals.push(...(body.value ?? []));
        next = body["@odata.nextLink"];
        query = undefined; // the next link already carries the query
      }
      // canEdit is also true for a calendar someone shared with edit rights; only the host's own calendars take bookings.
      const me = cals.find((c) => c.isDefaultCalendar)?.owner?.address?.toLowerCase();
      const own = (c: Cal) => c.isDefaultCalendar === true || (!!me && c.owner?.address?.toLowerCase() === me);
      return cals.map((c) => ({
        id: c.id, name: c.name ?? c.id, primary: c.isDefaultCalendar === true,
        accessRole: c.canEdit ? (own(c) ? "owner" : "writer") : "reader",
        teams: (c.allowedOnlineMeetingProviders ?? []).includes("teamsForBusiness"),
      }));
    },

    /**
     * Busy ranges per calendar, from each calendar's view (getSchedule doesn't work for personal accounts). A calendar
     * Graph won't let us read goes in `errors`; an expired token, a rate limit or an outage fails the whole call.
     */
    async busy(accessToken, calendarIds, timeMin, timeMax, busyOpts) {
      type Ev = { start: { dateTime: string }; end: { dateTime: string }; showAs?: string; isCancelled?: boolean; isAllDay?: boolean };
      // An all-day event is a date, not an instant: with the UTC Prefer header Graph returns it as UTC midnight to
      // midnight. It blocks the host's own day, so its dates are read as midnight in the host's zone.
      const zone = busyOpts?.timeZone;
      const at = (t: { dateTime: string }, allDay: boolean) => {
        if (!allDay || !zone) return parseGraphUtc(t);
        const [y, m, d] = t.dateTime.slice(0, 10).split("-").map(Number);
        return new Date(new TZDate(y, m - 1, d, zone).getTime());
      };
      const busy = new Map<string, BusyRange[]>();
      const errors = new Map<string, string>();
      for (const id of calendarIds) {
        const ranges: BusyRange[] = [];
        let next: string | undefined = `/me/calendars/${encodeURIComponent(id)}/calendarView`;
        let query: Record<string, string> | undefined = {
          startDateTime: timeMin.toISOString(), endDateTime: timeMax.toISOString(), $select: "start,end,showAs,isCancelled,isAllDay", $top: "200",
        };
        try {
          while (next) {
            const { body }: { body: { value?: Ev[]; "@odata.nextLink"?: string } } =
              await api(accessToken, "GET", next, { query, headers: { prefer: 'outlook.timezone="UTC"' } });
            for (const e of body.value ?? []) {
              if (e.isCancelled || e.showAs === "free") continue;
              const allDay = e.isAllDay === true;
              ranges.push({ start: at(e.start, allDay), end: at(e.end, allDay) });
            }
            next = body["@odata.nextLink"];
            query = undefined;
          }
          busy.set(id, ranges);
        } catch (error) {
          if (error instanceof MicrosoftApiError && (error.status === 403 || error.status === 404)) errors.set(id, error.reason ?? String(error.status));
          else throw error;
        }
      }
      return { busy, errors };
    },

    /**
     * `transactionId` = the booking id: Graph won't create a second event for a retried create with the same one.
     * No `attendees`: Graph can't create, move or delete an event without mailing them, and that invitation would carry
     * the host-only description. Hourhand emails the guest itself; the guest's name and email go in the body instead.
     */
    async insertEvent(accessToken, calendarId, e: EventInput): Promise<EventResult> {
      const teams = e.conference === "teams";
      const content = e.description.includes(e.attendee.email) ? e.description : `Guest: ${e.attendee.name} <${e.attendee.email}>\n\n${e.description}`;
      const { body } = await api<GraphEvent>(accessToken, "POST", eventPath(calendarId), {
        body: {
          subject: e.summary, body: { contentType: "text", content },
          start: graphTime(e.start), end: graphTime(e.end),
          ...(e.location ? { location: { displayName: e.location } } : {}),
          transactionId: e.bookingId,
          ...(teams ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
        },
      });
      return eventResult(body, "", teams);
    },

    /** Pending while the event is an online meeting with no join link yet; the caller bounds how often it looks again. */
    async getEvent(accessToken, calendarId, eventId) {
      const { body } = await api<GraphEvent>(accessToken, "GET", eventPath(calendarId, eventId), { query: { $select: "id,onlineMeeting,isOnlineMeeting" } });
      return eventResult(body, eventId, body.isOnlineMeeting === true);
    },

    async moveEvent(accessToken, calendarId, eventId, start, end, _timeZone, summary) {
      const { body } = await api<GraphEvent>(accessToken, "PATCH", eventPath(calendarId, eventId), {
        body: { subject: summary, start: graphTime(start), end: graphTime(end) },
      });
      return eventResult(body, eventId, body.isOnlineMeeting === true);
    },

    /** Deletes the event; one that is already gone counts as deleted. */
    async deleteEvent(accessToken, calendarId, eventId) {
      await api(accessToken, "DELETE", eventPath(calendarId, eventId), { okStatuses: [404, 410] });
    },
  };
}

export type MicrosoftClient = ReturnType<typeof microsoftClient>;

/**
 * The client from the environment, or null when Microsoft isn't configured. MICROSOFT_LOGIN_BASE_URL and
 * MICROSOFT_GRAPH_BASE_URL point the endpoints at a fake Microsoft for tests; a production server ignores them unless
 * HOURHAND_E2E=1, so a stray setting can't send hosts' tokens anywhere else.
 */
export function microsoftClientFromEnv(env: Record<string, string | undefined> = process.env): MicrosoftClient | null {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) return null;
  const fakeAllowed = env.NODE_ENV !== "production" || env.HOURHAND_E2E === "1";
  const login = fakeAllowed ? env.MICROSOFT_LOGIN_BASE_URL?.replace(/\/+$/, "") : undefined;
  const graph = fakeAllowed ? env.MICROSOFT_GRAPH_BASE_URL?.replace(/\/+$/, "") : undefined;
  const endpoints: MicrosoftEndpoints = {
    authorize: login ? `${login}/common/oauth2/v2.0/authorize` : MICROSOFT_ENDPOINTS.authorize,
    token: login ? `${login}/common/oauth2/v2.0/token` : MICROSOFT_ENDPOINTS.token,
    graph: graph ? `${graph}/v1.0` : MICROSOFT_ENDPOINTS.graph,
  };
  return microsoftClient({ clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, endpoints });
}
