import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, baseSlug, uniqueSlug } from "./slug";

describe("baseSlug", () => {
  it("uses the name when there is one", () => {
    expect(baseSlug("x@example.com", "Meera Iyer")).toBe("meera-iyer");
  });
  it("falls back to the email's local part and strips odd characters", () => {
    expect(baseSlug("Ravi.K+test@example.com")).toBe("ravi-k-test");
  });
  it("drops accents", () => {
    expect(baseSlug("x@example.com", "Zoë Müller")).toBe("zoe-muller");
  });
  it("pads slugs that would be too short", () => {
    expect(baseSlug("ab@example.com")).toBe("host-ab");
    expect(baseSlug("@example.com", "!!")).toBe("host-new");
  });
  it("keeps long names within the limit and never ends with a hyphen", () => {
    const slug = baseSlug("x@example.com", "a".repeat(32) + " bbbb");
    expect(slug.length).toBeLessThanOrEqual(33);
    expect(slug.endsWith("-")).toBe(false);
  });
  it("always produces a slug the database accepts", () => {
    for (const [email, name] of [["a@b.c", ""], ["___@b.c", null], ["x@b.c", "Ā Ē Ī"], ["x@b.c", "日本語"], ["x@b.c", "a".repeat(80)]] as const) {
      expect(baseSlug(email, name)).toMatch(SLUG_PATTERN);
    }
  });
});

describe("uniqueSlug", () => {
  it("never hands out a path the app owns", async () => {
    expect(await uniqueSlug("x@example.com", "Dashboard", async () => false)).toBe("dashboard-2");
    expect(await uniqueSlug("sign-in@example.com", null, async () => false)).toBe("sign-in-2");
    expect(await uniqueSlug("login@example.com", null, async () => false)).toBe("login-2");
  });
  it("adds a number when the base is taken", async () => {
    const taken = new Set(["meera", "meera-2"]);
    expect(await uniqueSlug("meera@example.com", null, async (s) => taken.has(s))).toBe("meera-3");
  });
  it("returns the base when it is free", async () => {
    expect(await uniqueSlug("meera@example.com", null, async () => false)).toBe("meera");
  });
  it("falls back to a random suffix that still matches the pattern", async () => {
    const slug = await uniqueSlug("meera@example.com", null, async (s) => !/-[a-z0-9]{6}$/.test(s) || s === "meera");
    expect(slug).toMatch(/^meera-[a-z0-9]{6}$/);
    expect(slug).toMatch(SLUG_PATTERN);
  });
});
