import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows max attempts per window, then refuses until the window passes", () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    const limit = { max: 3, windowMs: 1000 };
    expect([1, 2, 3, 4].map(() => limiter.take("a", limit))).toEqual([true, true, true, false]);
    expect(limiter.take("b", limit)).toBe(true); // keys are separate
    t = 999;
    expect(limiter.take("a", limit)).toBe(false);
    t = 1000;
    expect(limiter.take("a", limit)).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the address the proxy appended, ignoring forged ones to its left", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
