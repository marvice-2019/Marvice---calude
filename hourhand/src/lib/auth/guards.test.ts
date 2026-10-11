import { describe, expect, it } from "vitest";
import { assertMemoryAllowed } from "@/lib/data";
import { resolveBaseUrl } from "./auth";

describe("resolveBaseUrl", () => {
  it("refuses to run in production without a fixed public URL", () => {
    expect(() => resolveBaseUrl({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_URL/);
  });
  it("uses the configured URL in production", () => {
    expect(resolveBaseUrl({ NODE_ENV: "production", BETTER_AUTH_URL: "https://hourhand.app" })).toBe("https://hourhand.app");
  });
  it("allows it to be unset in development", () => {
    expect(resolveBaseUrl({ NODE_ENV: "development" })).toBeUndefined();
  });
});

describe("assertMemoryAllowed", () => {
  it("refuses demo data on a production server", () => {
    expect(() => assertMemoryAllowed({ NODE_ENV: "production" })).toThrow(/HOURHAND_DATA=postgres/);
  });
  it("allows the production build step and an explicit demo", () => {
    expect(() => assertMemoryAllowed({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
    expect(() => assertMemoryAllowed({ NODE_ENV: "production", HOURHAND_ALLOW_MEMORY: "1" })).not.toThrow();
  });
  it("allows development and tests", () => {
    expect(() => assertMemoryAllowed({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertMemoryAllowed({ NODE_ENV: "test" })).not.toThrow();
  });
});
