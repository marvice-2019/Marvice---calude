import { describe, expect, it } from "vitest";
import { microsoftEmailVerified, refuseUnverifiedSignUp, socialProvidersFromEnv } from "./auth";

const MS = { MICROSOFT_CLIENT_ID: "m", MICROSOFT_CLIENT_SECRET: "ms" };
const PERSONAL = "9188040d-6c67-4c5b-b112-36a304b66dad";

describe("social sign-in providers", () => {
  it("offers only the providers whose id and secret are both set", () => {
    expect(socialProvidersFromEnv({})).toEqual({});
    expect(Object.keys(socialProvidersFromEnv({ MICROSOFT_CLIENT_ID: "m" }))).toEqual([]);
    expect(Object.keys(socialProvidersFromEnv({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs" }))).toEqual(["google"]);
    expect(Object.keys(socialProvidersFromEnv(MS))).toEqual(["microsoft"]);
  });

  it("signs in any Microsoft account (common tenant) without storing a profile photo, and maps emailVerified from Microsoft's claims", () => {
    const { microsoft } = socialProvidersFromEnv(MS) as { microsoft: Record<string, unknown> & { mapProfileToUser: (p: object) => object } };
    // No trustedProviders anywhere: auth.ts sets no accountLinking, so Microsoft can't link to an existing account by an unverified email.
    expect(Object.keys(microsoft).sort()).toEqual(["clientId", "clientSecret", "disableProfilePhoto", "mapProfileToUser", "tenantId"]);
    expect(microsoft).toMatchObject({ clientId: "m", clientSecret: "ms", tenantId: "common", disableProfilePhoto: true });
    expect(microsoft.mapProfileToUser({ tid: "work-tenant" })).toEqual({ emailVerified: false });
    expect(microsoft.mapProfileToUser({ tid: PERSONAL })).toEqual({ emailVerified: true });
  });
});

describe("Microsoft email trust", () => {
  it("trusts the email only when Microsoft vouches for it", () => {
    expect(microsoftEmailVerified({ email_verified: true, tid: "t" })).toBe(true);
    expect(microsoftEmailVerified({ xms_edov: true, tid: "t" })).toBe(true);
    expect(microsoftEmailVerified({ xms_edov: "1", tid: "t" })).toBe(true);
    expect(microsoftEmailVerified({ tid: PERSONAL })).toBe(true);
    expect(microsoftEmailVerified({ tid: "some-work-tenant" })).toBe(false);
    expect(microsoftEmailVerified({ xms_edov: false, email_verified: false, tid: "t" })).toBe(false);
  });

  it("refuses to create an account from a Microsoft sign-in with an unverified email, and nothing else", () => {
    const callback = { params: { id: "microsoft" }, path: "/callback/:id" };
    expect(refuseUnverifiedSignUp({ emailVerified: false }, callback)).toBe(true);
    expect(refuseUnverifiedSignUp({ emailVerified: null }, callback)).toBe(true);
    expect(refuseUnverifiedSignUp({ emailVerified: false }, { path: "/sign-in/social", body: { provider: "microsoft" } })).toBe(true);
    expect(refuseUnverifiedSignUp({ emailVerified: true }, callback)).toBe(false);
    // Google and magic-link sign-ups aren't affected.
    expect(refuseUnverifiedSignUp({ emailVerified: false }, { params: { id: "google" }, path: "/callback/:id" })).toBe(false);
    expect(refuseUnverifiedSignUp({ emailVerified: false }, { path: "/magic-link/verify" })).toBe(false);
    expect(refuseUnverifiedSignUp({ emailVerified: false }, undefined)).toBe(false);
  });
});
