import { describe, expect, it } from "vitest";
import { emailFromIdToken, eventIdFor, GOOGLE_CALENDAR_SCOPES, googleClient, googleClientFromEnv, GoogleApiError } from "./google";

type Call = { url: URL; init: RequestInit };

/** A fetch that answers from a list of [status, body] in order and records each request. */
function fake(responses: [number, unknown][]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), init });
    const [status, body] = responses.shift() ?? [500, {}];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, client: googleClient({ clientId: "cid", clientSecret: "csec", fetchImpl: impl }) };
}

const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

describe("google client", () => {
  it("asks for the narrow scopes, offline access, consent and PKCE", () => {
    const url = new URL(fake([]).client.authUrl({ redirectUri: "https://h.test/cb", state: "st", codeChallenge: "ch", loginHint: "p@x.in" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_CALENDAR_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).not.toMatch(/auth\/calendar(\s|$)/); // never the full-access scope
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ access_type: "offline", prompt: "consent", state: "st", code_challenge: "ch", code_challenge_method: "S256", login_hint: "p@x.in" });
  });

  it("exchanges a code with the verifier and reads the account email from the id token", async () => {
    const f = fake([[200, { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "a b", id_token: idToken({ email: "p@gmail.com", email_verified: true }) }]]);
    const t = await f.client.exchangeCode({ code: "c", redirectUri: "https://h.test/cb", codeVerifier: "v" }, new Date("2026-10-11T00:00:00Z"));
    expect(t).toMatchObject({ accessToken: "at", refreshToken: "rt", scope: "a b", email: "p@gmail.com" });
    expect(t.expiresAt.toISOString()).toBe("2026-10-11T01:00:00.000Z");
    const body = new URLSearchParams(f.calls[0].init.body as URLSearchParams);
    expect(Object.fromEntries(body)).toMatchObject({ grant_type: "authorization_code", code_verifier: "v", code: "c", client_id: "cid" });
  });

  it("treats invalid_grant on refresh as revoked, and a token-endpoint outage as retryable", async () => {
    const revoked = await fake([[400, { error: "invalid_grant" }]]).client.refresh("rt").catch((e) => e);
    expect(revoked).toBeInstanceOf(GoogleApiError);
    expect(revoked).toMatchObject({ revoked: true, retryable: false });
    const down = await fake([[503, "<html>"]]).client.refresh("rt").catch((e) => e);
    expect(down).toMatchObject({ revoked: false, retryable: true });
  });

  it("classifies API errors: rate limits retry, a missing permission means reconnect", async () => {
    const rate = await fake([[403, { error: { errors: [{ reason: "rateLimitExceeded" }], message: "slow down" } }]]).client.listCalendars("at").catch((e) => e);
    expect(rate).toMatchObject({ retryable: true, revoked: false });
    const perm = await fake([[403, { error: { errors: [{ reason: "insufficientPermissions" }] } }]]).client.listCalendars("at").catch((e) => e);
    expect(perm).toMatchObject({ retryable: false, revoked: true });
    const proxy = await fake([[502, "<html>Bad gateway</html>"]]).client.listCalendars("at").catch((e) => e);
    expect(proxy).toMatchObject({ retryable: true });
  });

  it("pages through the calendar list", async () => {
    const f = fake([
      [200, { items: [{ id: "p@gmail.com", summary: "Priya", primary: true, accessRole: "owner" }], nextPageToken: "n2" }],
      [200, { items: [{ id: "team@group", summary: "Team", accessRole: "reader" }] }],
    ]);
    const list = await f.client.listCalendars("at");
    expect(list).toEqual([{ id: "p@gmail.com", name: "Priya", primary: true, accessRole: "owner" }, { id: "team@group", name: "Team", primary: false, accessRole: "reader" }]);
    expect(f.calls[1].url.searchParams.get("pageToken")).toBe("n2");
  });

  it("reports a calendar Google couldn't read as an error, never as free", async () => {
    const f = fake([[200, { calendars: { a: { busy: [{ start: "2026-10-12T04:00:00Z", end: "2026-10-12T05:00:00Z" }] }, b: { errors: [{ reason: "notFound" }] } } }]]);
    const r = await f.client.busy("at", ["a", "b"], new Date("2026-10-11T00:00:00Z"), new Date("2026-10-20T00:00:00Z"));
    expect(r.busy.get("a")).toEqual([{ start: new Date("2026-10-12T04:00:00Z"), end: new Date("2026-10-12T05:00:00Z") }]);
    expect(r.busy.has("b")).toBe(false);
    expect(r.errors.get("b")).toBe("notFound");
  });

  it("creates the event with a fixed id, no Google emails, and a Meet request; a retry that hits 409 reads the existing event", async () => {
    const input = { summary: "Coaching with Kiran", description: "d", start: new Date("2026-11-03T04:30:00Z"), end: new Date("2026-11-03T05:15:00Z"), timeZone: "Asia/Kolkata",
      location: null, attendee: { email: "k@x.com", name: "Kiran" }, conference: "google_meet", bookingId: "0b7c2d1e-0000-4000-8000-00000000abcd" };
    const f = fake([[200, { id: eventIdFor(input.bookingId), hangoutLink: "https://meet.google.com/aaa-bbbb-ccc" }]]);
    const r = await f.client.insertEvent("at", "p@gmail.com", input);
    expect(r).toEqual({ id: "hh0b7c2d1e000040008000" + "00000000abcd", joinUrl: "https://meet.google.com/aaa-bbbb-ccc", conferencePending: false });
    expect(f.calls[0].url.searchParams.get("sendUpdates")).toBe("none");
    expect(f.calls[0].url.searchParams.get("conferenceDataVersion")).toBe("1");
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(body.conferenceData.createRequest).toEqual({ requestId: input.bookingId, conferenceSolutionKey: { type: "hangoutsMeet" } });

    const retry = fake([[409, { error: { errors: [{ reason: "duplicate" }] } }], [200, { id: r.id, conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/x" }] } }]]);
    expect((await retry.client.insertEvent("at", "p@gmail.com", input)).joinUrl).toBe("https://meet.google.com/x");
    expect(retry.calls[1].init.method).toBe("GET");
  });

  it("treats deleting an event that is already gone as done", async () => {
    await expect(fake([[410, {}]]).client.deleteEvent("at", "c", "e")).resolves.toBeUndefined();
    await expect(fake([[404, {}]]).client.deleteEvent("at", "c", "e")).resolves.toBeUndefined();
  });

  it("reads an email only from a verified id token", () => {
    expect(emailFromIdToken(idToken({ email: "a@b.c", email_verified: true }))).toBe("a@b.c");
    expect(emailFromIdToken(idToken({ email: "a@b.c", email_verified: false }))).toBeNull();
    expect(emailFromIdToken("garbage")).toBeNull();
  });

  it("ignores a fake-Google URL on a production server unless it is an end-to-end run", async () => {
    const env = { GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s", GOOGLE_API_BASE_URL: "http://127.0.0.1:9999", NODE_ENV: "production" };
    const prod = googleClientFromEnv(env)!;
    expect(prod.authUrl({ redirectUri: "r", state: "s", codeChallenge: "c" })).toMatch(/^https:\/\/accounts\.google\.com\//);
    const e2e = googleClientFromEnv({ ...env, HOURHAND_E2E: "1" })!;
    expect(e2e.authUrl({ redirectUri: "r", state: "s", codeChallenge: "c" })).toMatch(/^http:\/\/127\.0\.0\.1:9999\//);
  });
});
