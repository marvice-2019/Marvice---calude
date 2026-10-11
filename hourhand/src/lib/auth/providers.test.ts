import { describe, expect, it } from "vitest";
import { socialProvidersFromEnv } from "./auth";

const MS = { MICROSOFT_CLIENT_ID: "m", MICROSOFT_CLIENT_SECRET: "ms" };

describe("social sign-in providers", () => {
  it("offers only the providers whose id and secret are both set", () => {
    expect(socialProvidersFromEnv({})).toEqual({});
    expect(Object.keys(socialProvidersFromEnv({ MICROSOFT_CLIENT_ID: "m" }))).toEqual([]);
    expect(Object.keys(socialProvidersFromEnv({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs" }))).toEqual(["google"]);
    expect(Object.keys(socialProvidersFromEnv(MS))).toEqual(["microsoft"]);
  });

  it("signs in any Microsoft account (common tenant) without storing a profile photo, and never marks Microsoft as trusted", () => {
    const providers = socialProvidersFromEnv(MS) as Record<string, Record<string, unknown>>;
    // Exact match: no extra options. auth.ts sets no accountLinking.trustedProviders, so Microsoft stays untrusted.
    expect(providers.microsoft).toEqual({ clientId: "m", clientSecret: "ms", tenantId: "common", disableProfilePhoto: true });
  });
});
