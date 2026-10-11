import { describe, expect, it } from "vitest";
import { calendarConfigError, calendarDeps, calendarRedirectUri } from "./env";

const base = { HOURHAND_DATA: "postgres", TOKEN_ENCRYPTION_KEY: "ab".repeat(32) };
const google = { GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs" };
const microsoft = { MICROSOFT_CLIENT_ID: "m", MICROSOFT_CLIENT_SECRET: "ms" };

describe("calendar providers from the environment", () => {
  it("puts each configured provider in the map, and works with either one alone", () => {
    expect(Object.keys(calendarDeps({ ...base, ...google })!.providers)).toEqual(["google"]);
    expect(Object.keys(calendarDeps({ ...base, ...microsoft })!.providers)).toEqual(["microsoft"]);
    expect(Object.keys(calendarDeps({ ...base, ...google, ...microsoft })!.providers).sort()).toEqual(["google", "microsoft"]);
    expect(calendarDeps(base)).toBeNull();
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

  it("sends each provider back to its own callback", () => {
    const env = { BETTER_AUTH_URL: "https://hourhand.example/" };
    expect(calendarRedirectUri("http://localhost:3000", env)).toBe("https://hourhand.example/api/calendars/google/callback");
    expect(calendarRedirectUri("http://localhost:3000", env, "microsoft")).toBe("https://hourhand.example/api/calendars/microsoft/callback");
  });
});
