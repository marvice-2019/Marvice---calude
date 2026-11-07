import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { leadPayload, sendLead } from "../src/lib/capi";
import { allowsAds, allowsAnalytics, isStrictRegion, parseConsent } from "../src/lib/consent";
import { buildCsp } from "../src/lib/csp";
import { jsonLdString, venueJsonLd } from "../src/lib/seo";
import { settingsSchema } from "../src/lib/settings";

const base = settingsSchema.parse({
  address: "106/A, 4th C Cross, 1st Main Road, KHB Colony, Industrial Area, Koramangala 5th Block, Bengaluru 560095",
  address_block_confirmed: false,
  instagram: "https://www.instagram.com/hydraclubkitchen/",
  cuisines: ["Japanese", "North Indian"],
  cost_for_two_inr: 2000,
  hours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "11:30", close: "01:00" }])),
});

describe("JSON-LD (verified facts only)", () => {
  it("is a NightClub + Restaurant with confirmed hours, and no phone or street line until confirmed", () => {
    const ld = venueJsonLd(base);
    expect(ld["@type"]).toEqual(["NightClub", "Restaurant"]);
    expect(ld.telephone).toBeUndefined();
    expect((ld.address as Record<string, string>).streetAddress).toBeUndefined();
    expect(ld.openingHoursSpecification).toHaveLength(7);
    expect(ld.priceRange).toBe("About ₹2,000 for two");
    const confirmed = venueJsonLd({ ...base, phone: "+917000011111", address_block_confirmed: true });
    expect(confirmed.telephone).toBe("+917000011111");
    expect((confirmed.address as Record<string, string>).streetAddress).toContain("Koramangala 5th Block");
  });

  it("can't break out of its script tag", () => {
    expect(jsonLdString({ name: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});

describe("consent", () => {
  it("reads the choice from cookies and gates analytics and ads separately", () => {
    expect(parseConsent("a=1; hydra_consent=analytics; b=2")).toBe("analytics");
    expect(parseConsent("hydra_consent=evil")).toBeNull();
    expect(parseConsent(null)).toBeNull();
    expect([allowsAnalytics("analytics"), allowsAds("analytics")]).toEqual([true, false]);
    expect([allowsAnalytics("all"), allowsAds("all")]).toEqual([true, true]);
    expect([allowsAnalytics("none"), allowsAds(null)]).toEqual([false, false]);
  });

  it("uses the stricter banner for UK/EU time zones", () => {
    expect(isStrictRegion("Europe/London")).toBe(true);
    expect(isStrictRegion("Europe/Berlin")).toBe(true);
    expect(isStrictRegion("Asia/Kolkata")).toBe(false);
  });
});

describe("Meta Conversions API", () => {
  it("hashes the phone, de-duplicates on the booking ref, and passes fbp/fbc through", () => {
    const p = leadPayload(
      { ref: "HYD-AB23", phoneE164: "+919876543210", ip: "203.0.113.9", userAgent: "UA", cookies: "_fbp=fb.1.1.2; other=x", url: "https://hydra.example/book" },
      1_800_000_000,
    );
    const e = p.data[0]!;
    expect(e).toMatchObject({ event_name: "Lead", event_id: "HYD-AB23", event_time: 1_800_000_000, action_source: "website" });
    expect(e.user_data.ph).toEqual([createHash("sha256").update("919876543210").digest("hex")]);
    expect(JSON.stringify(p)).not.toContain("9876543210\"");
    expect(e.user_data).toMatchObject({ client_ip_address: "203.0.113.9", fbp: "fb.1.1.2" });
    expect(e.user_data.fbc).toBeUndefined();
  });

  it("does nothing without credentials", async () => {
    delete process.env.META_PIXEL_ID;
    let called = false;
    const r = await sendLead({ ref: "HYD-AB23", phoneE164: "+919876543210", ip: "1.1.1.1", userAgent: null, cookies: null, url: "" }, (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch);
    expect([r, called]).toEqual(["skipped", false]);
  });
});

describe("Content-Security-Policy", () => {
  it("allows only nonce'd scripts in production, no eval, no framing", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(buildCsp("x", true)).toContain("'unsafe-eval'");
  });
});

describe("colour contrast (WCAG 2.2 AA, 4.5:1 for text)", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x! + 0.05) / (y! + 0.05);
  };
  it.each([
    ["body text on page", "#EAF2F8", "#03070D"],
    ["muted text on page", "#8DA2B5", "#03070D"],
    ["muted text on cards", "#8DA2B5", "#08111B"],
    ["muted text on inputs", "#8DA2B5", "#0E1B29"],
    ["button text on aqua", "#021015", "#2BB8DC"],
    ["aqua links on page", "#2BB8DC", "#03070D"],
    ["amber labels on page", "#E3B26A", "#03070D"],
    ["error text on cards", "#FF8A8A", "#08111B"],
  ])("%s", (_name, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
