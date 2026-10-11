import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseKey, seal, unseal } from "./seal";

const key = randomBytes(32);

describe("seal", () => {
  it("round-trips a value and never stores it in the clear", () => {
    const tokens = { refresh: "1//refresh-value", access: "ya29.access" };
    const sealed = seal(key, tokens, "conn-1");
    expect(sealed.toString("latin1")).not.toContain("refresh-value");
    expect(unseal(key, sealed, "conn-1")).toEqual(tokens);
  });

  it("refuses a tampered value, a wrong key, or a value moved to another row", () => {
    const sealed = seal(key, { a: 1 }, "conn-1");
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] ^= 1;
    expect(() => unseal(key, flipped, "conn-1")).toThrow();
    expect(() => unseal(randomBytes(32), sealed, "conn-1")).toThrow();
    expect(() => unseal(key, sealed, "conn-2")).toThrow();
  });

  it("accepts a hex or base64 key of 32 bytes and nothing else", () => {
    expect(parseKey("ab".repeat(32))).toHaveLength(32);
    expect(parseKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(() => parseKey(undefined)).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => parseKey("short")).toThrow(/32 bytes/);
  });
});
