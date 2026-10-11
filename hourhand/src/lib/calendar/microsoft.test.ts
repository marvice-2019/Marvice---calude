import { describe, expect, it } from "vitest";
import { emailFromMicrosoftIdToken, MICROSOFT_CALENDAR_SCOPES, microsoftClient, microsoftClientFromEnv, MicrosoftApiError } from "./microsoft";
import { CalendarApiError, type EventInput } from "./provider";

type Call = { url: URL; init: RequestInit };
const GRAPH = "https://graph.microsoft.com/v1.0";

/** A fetch that answers from a list of [status, body] in order and records each request. */
function fake(responses: [number, unknown][]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), init });
    const [status, body] = responses.shift() ?? [500, {}];
    return new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, client: microsoftClient({ clientId: "cid", clientSecret: "csec", fetchImpl: impl }) };
}

const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
const form = (c: Call) => Object.fromEntries(new URLSearchParams(c.init.body as URLSearchParams));
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

const input: EventInput = {
  summary: "Coaching with Kiran", description: "Notes", start: new Date("2026-11-03T04:30:00Z"), end: new Date("2026-11-03T05:15:00Z"),
  timeZone: "Asia/Kolkata", location: null, attendee: { email: "k@x.com", name: "Kiran" }, conference: "teams", bookingId: "0b7c2d1e-0000-4000-8000-00000000abcd",
};

describe("microsoft client: OAuth", () => {
  it("builds the authorize URL on the common tenant with PKCE, account picker and login hint", () => {
    const url = new URL(fake([]).client.authUrl({ redirectUri: "https://h.test/cb", state: "st", codeChallenge: "ch", loginHint: "p@x.in" }));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid", redirect_uri: "https://h.test/cb", response_type: "code", response_mode: "query",
      scope: "openid email offline_access User.Read Calendars.ReadWrite", state: "st", prompt: "select_account",
      code_challenge: "ch", code_challenge_method: "S256", login_hint: "p@x.in",
    });
    expect(new URL(fake([]).client.authUrl({ redirectUri: "r", state: "s", codeChallenge: "c" })).searchParams.has("login_hint")).toBe(false);
  });

  it("exchanges a code with the verifier and scope, and reads the email from the id token", async () => {
    const f = fake([[200, { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read", id_token: idToken({ email: "p@contoso.com", preferred_username: "other@contoso.com" }) }]]);
    const t = await f.client.exchangeCode({ code: "c", redirectUri: "https://h.test/cb", codeVerifier: "v" }, new Date("2026-10-11T00:00:00Z"));
    expect(t).toMatchObject({ accessToken: "at", refreshToken: "rt", email: "p@contoso.com" });
    expect(t.expiresAt.toISOString()).toBe("2026-10-11T01:00:00.000Z");
    // Microsoft never lists offline_access in the token response; the refresh token is the proof, so it's recorded.
    expect(t.scope).toBe("https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access");
    expect(f.client.missingScopes(t.scope)).toEqual([]);
    expect(f.calls[0].url.toString()).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(form(f.calls[0])).toEqual({
      client_id: "cid", client_secret: "csec", grant_type: "authorization_code", code: "c", redirect_uri: "https://h.test/cb",
      code_verifier: "v", scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    });
  });

  it("falls back to preferred_username for the email, and to null", () => {
    expect(emailFromMicrosoftIdToken(idToken({ preferred_username: "p@outlook.com" }))).toBe("p@outlook.com");
    expect(emailFromMicrosoftIdToken(idToken({ name: "P" }))).toBeNull();
    expect(emailFromMicrosoftIdToken("garbage")).toBeNull();
    expect(emailFromMicrosoftIdToken(undefined)).toBeNull();
  });

  it("returns the rotated refresh token from a refresh, and none when Microsoft didn't send one", async () => {
    const f = fake([[200, { access_token: "at2", refresh_token: "rt2", expires_in: 4000 }], [200, { access_token: "at3", expires_in: 3600 }]]);
    const r = await f.client.refresh("rt1", new Date("2026-10-11T00:00:00Z"));
    expect(r).toEqual({ accessToken: "at2", refreshToken: "rt2", expiresAt: new Date("2026-10-11T01:06:40Z") });
    expect(form(f.calls[0])).toEqual({ client_id: "cid", client_secret: "csec", grant_type: "refresh_token", refresh_token: "rt1", scope: MICROSOFT_CALENDAR_SCOPES.join(" ") });
    expect((await f.client.refresh("rt2")).refreshToken).toBeUndefined();
  });

  it("treats invalid_grant and the revoked AADSTS codes as revoked, an outage as retryable, and keeps secrets out of messages", async () => {
    const grant = await fake([[400, { error: "invalid_grant", error_description: "AADSTS50173: The provided grant has expired. Trace ID: abc" }]]).client.refresh("secret-rt").catch((e) => e);
    expect(grant).toBeInstanceOf(MicrosoftApiError);
    expect(grant).toBeInstanceOf(CalendarApiError);
    expect(grant).toMatchObject({ revoked: true, retryable: false, status: 400, reason: "invalid_grant" });
    expect(grant.message).not.toMatch(/secret|csec|Trace/);
    const aadsts = await fake([[400, { error: "invalid_request", error_description: "AADSTS700082: The refresh token has expired due to inactivity." }]]).client.refresh("rt").catch((e) => e);
    expect(aadsts).toMatchObject({ revoked: true });
    const aadsts2 = await fake([[400, { error: "invalid_request", error_description: "AADSTS70000: The provided value for the 'code' parameter is not valid." }]]).client.exchangeCode({ code: "c", redirectUri: "r", codeVerifier: "v" }).catch((e) => e);
    expect(aadsts2).toMatchObject({ revoked: true });
    const down = await fake([[503, "<html>"]]).client.refresh("rt").catch((e) => e);
    expect(down).toMatchObject({ revoked: false, retryable: true });
  });

  it("checks only Calendars.ReadWrite and offline_access, with or without the Graph prefix, case-insensitively", () => {
    const c = fake([]).client;
    expect(c.missingScopes("https://graph.microsoft.com/calendars.readwrite offline_access https://graph.microsoft.com/User.Read")).toEqual([]);
    expect(c.missingScopes("Calendars.Read offline_access")).toEqual(["Calendars.ReadWrite"]);
    expect(c.missingScopes("https://graph.microsoft.com/Calendars.ReadWrite")).toEqual(["offline_access"]);
    expect(c.missingScopes("")).toEqual(["Calendars.ReadWrite", "offline_access"]);
  });

  it("revokes without making a request", async () => {
    const f = fake([]);
    await expect(f.client.revoke("at")).resolves.toBeUndefined();
    expect(f.calls).toHaveLength(0);
  });
});

describe("microsoft client: Graph", () => {
  it("pages through the calendar list and normalises role, primary and the Teams flag", async () => {
    const f = fake([
      [200, { value: [{ id: "A", name: "Calendar", isDefaultCalendar: true, canEdit: true, allowedOnlineMeetingProviders: ["teamsForBusiness"] }], "@odata.nextLink": `${GRAPH}/me/calendars?$skiptoken=n2` }],
      [200, { value: [{ id: "B", name: "Holidays", isDefaultCalendar: false, canEdit: false, allowedOnlineMeetingProviders: [] }] }],
    ]);
    expect(await f.client.listCalendars("at")).toEqual([
      { id: "A", name: "Calendar", primary: true, accessRole: "owner", teams: true },
      { id: "B", name: "Holidays", primary: false, accessRole: "reader", teams: false },
    ]);
    expect(f.calls[0].url.pathname).toBe("/v1.0/me/calendars");
    expect(f.calls[0].url.searchParams.get("$select")).toBe("id,name,isDefaultCalendar,canEdit,allowedOnlineMeetingProviders,owner");
    expect(f.calls[1].url.searchParams.get("$skiptoken")).toBe("n2");
    expect(header(f.calls[1], "authorization")).toBe("Bearer at");
  });

  it("won't send the token to a next page outside Graph", async () => {
    const f = fake([[200, { value: [], "@odata.nextLink": "https://evil.test/steal" }]]);
    await expect(f.client.listCalendars("at")).rejects.toBeInstanceOf(MicrosoftApiError);
    expect(f.calls).toHaveLength(1);
  });

  it("reads busy times in UTC, skips free, working-elsewhere and cancelled events, and pages", async () => {
    const f = fake([
      [200, { value: [
        { start: { dateTime: "2026-10-12T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-12T10:00:00.0000000", timeZone: "UTC" }, showAs: "busy", isCancelled: false },
        { start: { dateTime: "2026-10-12T11:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-12T12:00:00.0000000", timeZone: "UTC" }, showAs: "free", isCancelled: false },
        { start: { dateTime: "2026-10-12T13:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-12T14:00:00.0000000", timeZone: "UTC" }, showAs: "busy", isCancelled: true },
        { start: { dateTime: "2026-10-12T15:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-12T16:00:00.0000000", timeZone: "UTC" }, showAs: "workingElsewhere", isCancelled: false },
      ], "@odata.nextLink": `${GRAPH}/me/calendars/A/calendarView?$skiptoken=p2` }],
      [200, { value: [{ start: { dateTime: "2026-10-13T08:30:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-13T09:00:00.0000000", timeZone: "UTC" }, showAs: "tentative" }] }],
    ]);
    const r = await f.client.busy("at", ["A"], new Date("2026-10-11T00:00:00Z"), new Date("2026-10-20T00:00:00Z"));
    expect(r.busy.get("A")).toEqual([
      { start: new Date("2026-10-12T09:00:00Z"), end: new Date("2026-10-12T10:00:00Z") },
      { start: new Date("2026-10-13T08:30:00Z"), end: new Date("2026-10-13T09:00:00Z") },
    ]);
    expect(r.errors.size).toBe(0);
    const q = f.calls[0].url.searchParams;
    expect(f.calls[0].url.pathname).toBe("/v1.0/me/calendars/A/calendarView");
    expect(Object.fromEntries(q)).toEqual({ startDateTime: "2026-10-11T00:00:00.000Z", endDateTime: "2026-10-20T00:00:00.000Z", $select: "start,end,showAs,isCancelled", $top: "200" });
    expect(header(f.calls[0], "prefer")).toBe('outlook.timezone="UTC"');
    expect(header(f.calls[1], "prefer")).toBe('outlook.timezone="UTC"');
    expect(f.calls[1].url.searchParams.get("$skiptoken")).toBe("p2");
  });

  it("reports a calendar Graph won't let us read as an error while the others still return", async () => {
    const f = fake([
      [403, { error: { code: "ErrorAccessDenied", message: "Access is denied." } }],
      [200, { value: [{ start: { dateTime: "2026-10-12T09:00:00.0000000" }, end: { dateTime: "2026-10-12T10:00:00.0000000" }, showAs: "oof" }] }],
      [404, { error: { code: "ErrorItemNotFound" } }],
    ]);
    const r = await f.client.busy("at", ["shared", "mine", "gone"], new Date("2026-10-11T00:00:00Z"), new Date("2026-10-20T00:00:00Z"));
    expect(r.busy.has("shared")).toBe(false);
    expect(r.errors.get("shared")).toBe("ErrorAccessDenied");
    expect(r.busy.get("mine")).toEqual([{ start: new Date("2026-10-12T09:00:00Z"), end: new Date("2026-10-12T10:00:00Z") }]);
    expect(r.errors.get("gone")).toBe("ErrorItemNotFound");
  });

  it("fails the whole busy call on a rate limit (retryable) or an expired grant (revoked)", async () => {
    const window = [new Date("2026-10-11T00:00:00Z"), new Date("2026-10-20T00:00:00Z")] as const;
    const rate = await fake([[200, { value: [] }], [429, { error: { code: "TooManyRequests" } }]]).client.busy("at", ["A", "B"], ...window).catch((e) => e);
    expect(rate).toBeInstanceOf(MicrosoftApiError);
    expect(rate).toMatchObject({ retryable: true, revoked: false, status: 429 });
    const auth = await fake([[401, { error: { code: "InvalidAuthenticationToken", message: "Access token has expired." } }]]).client.busy("at", ["A"], ...window).catch((e) => e);
    expect(auth).toMatchObject({ revoked: true, retryable: false });
    const outage = await fake([[503, "<html>"]]).client.busy("at", ["A"], ...window).catch((e) => e);
    expect(outage).toMatchObject({ retryable: true });
  });

  it("classifies Graph errors outside busy: access denied means reconnect, a gateway timeout retries", async () => {
    expect(await fake([[403, { error: { code: "ErrorAccessDenied" } }]]).client.listCalendars("at").catch((e) => e)).toMatchObject({ revoked: true, retryable: false });
    expect(await fake([[504, {}]]).client.listCalendars("at").catch((e) => e)).toMatchObject({ revoked: false, retryable: true });
  });

  it("creates a Teams event in UTC with the booking id as transactionId and returns the join link", async () => {
    const f = fake([[201, { id: "AAMk1", isOnlineMeeting: true, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x" } }]]);
    const r = await f.client.insertEvent("at", "A", { ...input, location: "Room 4" });
    expect(r).toEqual({ id: "AAMk1", joinUrl: "https://teams.microsoft.com/l/meetup-join/x", conferencePending: false });
    expect(f.calls[0].init.method).toBe("POST");
    expect(f.calls[0].url.pathname).toBe("/v1.0/me/calendars/A/events");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
      subject: "Coaching with Kiran", body: { contentType: "text", content: "Notes" },
      start: { dateTime: "2026-11-03T04:30:00.000", timeZone: "UTC" }, end: { dateTime: "2026-11-03T05:15:00.000", timeZone: "UTC" },
      location: { displayName: "Room 4" },
      attendees: [{ emailAddress: { address: "k@x.com", name: "Kiran" }, type: "required" }],
      transactionId: input.bookingId, isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness",
    });
  });

  it("marks the Teams link pending until Graph has one, and getEvent keeps reporting pending until it arrives", async () => {
    const f = fake([
      [201, { id: "AAMk1", isOnlineMeeting: true, onlineMeeting: null }],
      [200, { id: "AAMk1", isOnlineMeeting: true, onlineMeeting: null }],
      [200, { id: "AAMk1", isOnlineMeeting: true, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/j" } }],
    ]);
    expect(await f.client.insertEvent("at", "A", input)).toEqual({ id: "AAMk1", joinUrl: null, conferencePending: true });
    expect(await f.client.getEvent("at", "A", "AAMk1")).toEqual({ id: "AAMk1", joinUrl: null, conferencePending: true });
    expect(await f.client.getEvent("at", "A", "AAMk1")).toEqual({ id: "AAMk1", joinUrl: "https://teams.microsoft.com/l/j", conferencePending: false });
    expect(f.calls[1].url.searchParams.get("$select")).toBe("id,onlineMeeting,isOnlineMeeting");
  });

  it("creates an event without Teams: no online-meeting fields, no location, nothing pending", async () => {
    const f = fake([[201, { id: "AAMk2", isOnlineMeeting: false, onlineMeeting: null }]]);
    expect(await f.client.insertEvent("at", "A", { ...input, conference: null })).toEqual({ id: "AAMk2", joinUrl: null, conferencePending: false });
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body).not.toHaveProperty("isOnlineMeeting");
    expect(body).not.toHaveProperty("onlineMeetingProvider");
    expect(body).not.toHaveProperty("location");
    expect(body.transactionId).toBe(input.bookingId);
  });

  it("moves an event with a PATCH of subject, start and end in UTC", async () => {
    const f = fake([[200, { id: "AAMk1", isOnlineMeeting: true, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/j" } }]]);
    const r = await f.client.moveEvent("at", "A", "AAMk1", new Date("2026-11-04T04:30:00Z"), new Date("2026-11-04T05:00:00Z"), "Asia/Kolkata", "Moved");
    expect(r).toEqual({ id: "AAMk1", joinUrl: "https://teams.microsoft.com/l/j", conferencePending: false });
    expect(f.calls[0].init.method).toBe("PATCH");
    expect(f.calls[0].url.pathname).toBe("/v1.0/me/calendars/A/events/AAMk1");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
      subject: "Moved", start: { dateTime: "2026-11-04T04:30:00.000", timeZone: "UTC" }, end: { dateTime: "2026-11-04T05:00:00.000", timeZone: "UTC" },
    });
  });

  it("treats deleting an event that is already gone as done", async () => {
    const f = fake([[204, null], [404, { error: { code: "ErrorItemNotFound" } }], [410, {}]]);
    await expect(f.client.deleteEvent("at", "A", "e1")).resolves.toBeUndefined();
    await expect(f.client.deleteEvent("at", "A", "e2")).resolves.toBeUndefined();
    await expect(f.client.deleteEvent("at", "A", "e3")).resolves.toBeUndefined();
    expect(f.calls[0].init.method).toBe("DELETE");
  });

  it("turns a network failure into a retryable error", async () => {
    const impl = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const c = microsoftClient({ clientId: "cid", clientSecret: "csec", fetchImpl: impl });
    expect(await c.listCalendars("at").catch((e) => e)).toMatchObject({ name: "MicrosoftApiError", retryable: true, revoked: false });
    expect(await c.refresh("rt").catch((e) => e)).toMatchObject({ retryable: true });
  });
});

describe("microsoftClientFromEnv", () => {
  const env = { MICROSOFT_CLIENT_ID: "c", MICROSOFT_CLIENT_SECRET: "s", MICROSOFT_LOGIN_BASE_URL: "http://127.0.0.1:9999/", MICROSOFT_GRAPH_BASE_URL: "http://127.0.0.1:9998" };

  it("is null unless both the client id and secret are set", () => {
    expect(microsoftClientFromEnv({})).toBeNull();
    expect(microsoftClientFromEnv({ MICROSOFT_CLIENT_ID: "c" })).toBeNull();
    expect(microsoftClientFromEnv({ MICROSOFT_CLIENT_SECRET: "s" })).toBeNull();
    expect(microsoftClientFromEnv({ MICROSOFT_CLIENT_ID: "c", MICROSOFT_CLIENT_SECRET: "s" })?.id).toBe("microsoft");
  });

  it("ignores fake-Microsoft URLs on a production server unless it is an end-to-end run", () => {
    const authUrl = (e: Record<string, string>) => microsoftClientFromEnv(e)!.authUrl({ redirectUri: "r", state: "s", codeChallenge: "c" });
    expect(authUrl({ ...env, NODE_ENV: "production" })).toMatch(/^https:\/\/login\.microsoftonline\.com\/common\//);
    expect(authUrl({ ...env, NODE_ENV: "production", HOURHAND_E2E: "1" })).toMatch(/^http:\/\/127\.0\.0\.1:9999\/common\/oauth2\/v2\.0\/authorize\?/);
    expect(authUrl({ ...env, NODE_ENV: "development" })).toMatch(/^http:\/\/127\.0\.0\.1:9999\//);
  });

  it("points Graph calls at the fake Graph only when allowed", async () => {
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ value: [] }), { status: 200 }); }) as unknown as typeof fetch;
    try {
      await microsoftClientFromEnv({ ...env, NODE_ENV: "test" })!.listCalendars("at");
      await microsoftClientFromEnv({ ...env, NODE_ENV: "production" })!.listCalendars("at");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:9998\/v1\.0\/me\/calendars\?/);
    expect(urls[1]).toMatch(/^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/calendars\?/);
  });
});
