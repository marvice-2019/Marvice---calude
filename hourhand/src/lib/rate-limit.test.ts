import { describe, expect, it } from "vitest";
import { addressKey, clientIp, createRateLimiter } from "./rate-limit";

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

describe("createRateLimiter memory", () => {
  it("drops expired windows and never holds more than 50,000 keys", () => {
    let t = 0;
    const limiter = createRateLimiter(() => t);
    const limit = { max: 1, windowMs: 60_000 };
    for (let i = 0; i < 50_010; i++) limiter.take(`k${i}`, limit);
    expect(limiter.size()).toBe(50_000);
    t = 11 * 60_000; // past the longest window and the sweep interval
    limiter.take("fresh", limit);
    expect(limiter.size()).toBe(1);
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

describe("addressKey", () => {
  it("groups IPv6 addresses by /64 and leaves IPv4 alone", () => {
    expect(addressKey("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1234:5678::/64");
    expect(addressKey("2001:db8:1234:5678::1")).toBe(addressKey("2001:0db8:1234:5678:ffff::9"));
    expect(addressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressKey("203.0.113.7")).toBe("203.0.113.7");
  });
});
