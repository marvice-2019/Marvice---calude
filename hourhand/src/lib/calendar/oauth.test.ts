import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REQUIRED_SCOPES } from "./google";
import { checkOAuthCallback, missingScopes, OAUTH_COOKIES, startOAuth } from "./oauth";

const key = randomBytes(32);
const now = new Date("2026-10-11T10:00:00Z");

describe("calendar OAuth handshake", () => {
  it("accepts Google's return with the same state for the same host, and hands back the PKCE verifier", () => {
    const s = startOAuth(key, "user-1", now);
    const check = checkOAuthCallback(key, s.cookie, s.state, "user-1", now);
    expect(check.ok).toBe(true);
    if (check.ok) expect(createHash("sha256").update(check.verifier).digest("base64url")).toBe(s.codeChallenge);
  });

  it("refuses a different state, a missing cookie, a forged cookie, another host or an old handshake", () => {
    const s = startOAuth(key, "user-1", now);
    expect(checkOAuthCallback(key, s.cookie, "other-state", "user-1", now)).toEqual({ ok: false, error: "state_mismatch" });
    expect(checkOAuthCallback(key, undefined, s.state, "user-1", now)).toEqual({ ok: false, error: "state_mismatch" });
    expect(checkOAuthCallback(key, startOAuth(randomBytes(32), "user-1", now).cookie, s.state, "user-1", now)).toEqual({ ok: false, error: "state_mismatch" });
    expect(checkOAuthCallback(key, s.cookie, s.state, "user-2", now)).toEqual({ ok: false, error: "wrong_user" });
    expect(checkOAuthCallback(key, s.cookie, s.state, "user-1", new Date(now.getTime() + 11 * 60_000))).toEqual({ ok: false, error: "expired" });
  });

  it("keeps Google's cookie as it was and gives Outlook its own, which can't stand in for Google's", () => {
    expect(OAUTH_COOKIES.google).toMatchObject({ name: "hh_gcal_oauth", path: "/api/calendars/google" });
    expect(OAUTH_COOKIES.microsoft).toMatchObject({ name: "hh_mcal_oauth", path: "/api/calendars/microsoft" });
    const s = startOAuth(key, "user-1", now, "microsoft");
    expect(checkOAuthCallback(key, s.cookie, s.state, "user-1", now, "microsoft").ok).toBe(true);
    expect(checkOAuthCallback(key, s.cookie, s.state, "user-1", now, "google")).toEqual({ ok: false, error: "state_mismatch" });
    expect(checkOAuthCallback(key, s.cookie, s.state, "user-2", now, "microsoft")).toEqual({ ok: false, error: "wrong_user" });
    expect(checkOAuthCallback(key, s.cookie, s.state, "user-1", new Date(now.getTime() + 11 * 60_000), "microsoft")).toEqual({ ok: false, error: "expired" });
  });

  it("notices when the host unticked a calendar permission", () => {
    expect(missingScopes(["openid", "email", ...REQUIRED_SCOPES].join(" "))).toEqual([]);
    expect(missingScopes(`openid email ${REQUIRED_SCOPES[0]}`)).toHaveLength(2);
  });
});
