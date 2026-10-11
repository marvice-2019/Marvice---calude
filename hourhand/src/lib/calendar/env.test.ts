import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarConfigError, calendarDeps, calendarRedirectUri } from "./env";

const base = { HOURHAND_DATA: "postgres", TOKEN_ENCRYPTION_KEY: "ab".repeat(32) };
const google = { GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs" };
const microsoft = { MICROSOFT_CLIENT_ID: "m", MICROSOFT_CLIENT_SECRET: "ms" };

describe("calendar providers from the environment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts each configured provider in the map, and works with either one alone", () => {
    expect(Object.keys(calendarDeps({ ...base, ...google })!.providers)).toEqual(["google", "icloud"]);
    expect(Object.keys(calendarDeps({ ...base, ...microsoft })!.providers)).toEqual(["microsoft", "icloud"]);
    expect(Object.keys(calendarDeps({ ...base, ...google, ...microsoft })!.providers).sort()).toEqual(["google", "icloud", "microsoft"]);
    // iCloud needs no OAuth client, only the key that seals the host's app-specific password.
    expect(Object.keys(calendarDeps(base)!.providers)).toEqual(["icloud"]);
    expect(calendarDeps({ HOURHAND_DATA: "postgres" })).toBeNull();
    expect(calendarConfigError({ HOURHAND_DATA: "postgres" })).toBeNull();
    expect(calendarDeps({ ...base, ...microsoft })!.google).toBeUndefined();
    expect(calendarDeps({ ...base, ...google, ...microsoft })!.providers.microsoft!.id).toBe("microsoft");
  });

  it("needs TOKEN_ENCRYPTION_KEY when Microsoft is configured, just like Google", () => {
    const env = { HOURHAND_DATA: "postgres", ...microsoft };
    expect(calendarDeps(env)).toBeNull();
    expect(calendarConfigError(env)).toMatch(/^Outlook is configured but .*TOKEN_ENCRYPTION_KEY/);
    expect(calendarConfigError({ HOURHAND_DATA: "postgres", ...google, ...microsoft })).toMatch(/^Google Calendar and Outlook are configured/);
    expect(calendarConfigError({ ...env, TOKEN_ENCRYPTION_KEY: "ab".repeat(32) })).toBeNull();
  });

  it("points iCloud at ICLOUD_CALDAV_URL outside production only", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { urls.push(url); return new Response("", { status: 401 }); });
    const verify = (env: Record<string, string>) => calendarDeps({ ...base, ICLOUD_CALDAV_URL: "http://localhost:5299", ...env })!.providers.icloud!.listCalendars("a@b.c:pw").catch(() => undefined);
    await verify({ NODE_ENV: "test" });
    await verify({ NODE_ENV: "production" });
    await verify({ NODE_ENV: "production", HOURHAND_E2E: "1" });
    expect(urls.map((u) => new URL(u).origin)).toEqual(["http://localhost:5299", "https://caldav.icloud.com", "http://localhost:5299"]);
  });

  it("sends each provider back to its own callback", () => {
    const env = { BETTER_AUTH_URL: "https://hourhand.example/" };
    expect(calendarRedirectUri("http://localhost:3000", env)).toBe("https://hourhand.example/api/calendars/google/callback");
    expect(calendarRedirectUri("http://localhost:3000", env, "microsoft")).toBe("https://hourhand.example/api/calendars/microsoft/callback");
  });
});
