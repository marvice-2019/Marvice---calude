// The host's page details and photo. The Postgres part runs only with TEST_DATABASE_URL, on its own database <name>_prof.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { getProfile, photoBySlug, PHOTO_MAX_BYTES, profileJsonLd, removePhoto, saveProfile, savePhoto, sniffImage, validateProfile } from "./profile";

const BASE = process.env.TEST_DATABASE_URL;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("profile form", () => {
  const errors = (input: Record<string, string>) => { const v = validateProfile(input); return v.ok ? {} : v.errors; };

  it("cleans up what hosts type", () => {
    const v = validateProfile({ headline: "  Career coach ", bio: "Line one\r\nLine two", whatsapp: "98765 43210", instagram: "https://www.instagram.com/priya.coach/",
      reviewsUrl: "https://maps.app.goo.gl/AbC123", area: "" });
    expect(v).toEqual({ ok: true, value: { headline: "Career coach", bio: "Line one\nLine two", area: null, whatsapp: "+919876543210", instagram: "priya.coach", reviewsUrl: "https://maps.app.goo.gl/AbC123" } });
    expect(validateProfile({ whatsapp: "+44 7700 900123", instagram: "@priya_c" })).toMatchObject({ ok: true, value: { whatsapp: "+447700900123", instagram: "priya_c" } });
  });

  it("points the reviews button only at Google", () => {
    for (const ok of ["https://g.page/r/abc/review", "https://www.google.com/maps/place/X", "https://www.google.co.in/search?q=x", "https://search.google.com/local/reviews?placeid=1"]) {
      expect(errors({ reviewsUrl: ok })).toEqual({});
    }
    for (const bad of ["http://g.page/r/abc", "https://evil.example/google.com", "https://google.com.evil.example/x", "javascript:alert(1)", "g.page/r/abc"]) {
      expect(errors({ reviewsUrl: bad })).toHaveProperty("reviewsUrl");
    }
  });

  it("refuses what the page can't show", () => {
    expect(errors({ headline: "x".repeat(121), bio: "x".repeat(2001), whatsapp: "12345", instagram: "has space" }))
      .toEqual({ headline: expect.any(String), bio: expect.any(String), whatsapp: expect.any(String), instagram: expect.any(String) });
  });

  it("knows an image by its first bytes", () => {
    expect([sniffImage(PNG), sniffImage(JPEG), sniffImage(WEBP)]).toEqual(["image/png", "image/jpeg", "image/webp"]);
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull(); // GIF: not offered
  });
});

describe("schema.org markup", () => {
  it("names the host, their services with prices, and where else they are", () => {
    const profile = { headline: "Coach </script><script>alert(1)</script>", bio: null, area: "Bengaluru", whatsapp: "+919876543210", instagram: "priya.c", reviewsUrl: "https://g.page/r/x", hasPhoto: true, photoVersion: 1 };
    const json = profileJsonLd({ baseUrl: "https://hourhand.cloud", slug: "priya", name: "Priya", profile,
      services: [{ name: "Coaching", slug: "coaching", description: null, priceMinor: 150000 }, { name: "Intro", slug: "intro", description: "A first chat", priceMinor: null }] });
    expect(json).not.toContain("</script>");
    const d = JSON.parse(json);
    expect(d).toMatchObject({ "@type": "ProfessionalService", name: "Priya", url: "https://hourhand.cloud/priya", image: "https://hourhand.cloud/api/photo/priya",
      areaServed: "Bengaluru", telephone: "+919876543210", sameAs: ["https://www.instagram.com/priya.c/", "https://g.page/r/x"] });
    expect(d.description).toContain("</script>"); // intact once parsed
    expect(d.makesOffer).toEqual([
      { "@type": "Offer", url: "https://hourhand.cloud/priya/coaching", itemOffered: { "@type": "Service", name: "Coaching" }, price: "1500.00", priceCurrency: "INR" },
      { "@type": "Offer", url: "https://hourhand.cloud/priya/intro", itemOffered: { "@type": "Service", name: "Intro", description: "A first chat" } },
    ]);
  });
});

describe.skipIf(!BASE)("profile (Postgres)", () => {
  let pool: pg.Pool;
  let host: string;

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_prof`;
    if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`TEST_DATABASE_URL must name a test database, got "${name}"`);
    u.pathname = `/${name}`;
    const admin = new URL(BASE!);
    admin.pathname = "/postgres";
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      await c.query(`drop database if exists ${name} with (force)`);
      await c.query(`create database ${name}`);
    } finally {
      await c.end();
    }
    await migrate(u.toString());
    pool = new pg.Pool({ connectionString: u.toString() });
    host = (await pool.query("insert into users (email, name, slug) values ('p@example.com', 'Priya', 'priya-c') returning id")).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("saves, reads back and clears the details", async () => {
    expect(await getProfile(pool, host)).toMatchObject({ headline: null, hasPhoto: false });
    const v = validateProfile({ headline: "Career coach", bio: "Ten years of it.", whatsapp: "9876543210", reviewsUrl: "https://g.page/r/abc" });
    if (!v.ok) throw new Error("invalid");
    await saveProfile(pool, host, v.value);
    expect(await getProfile(pool, host)).toMatchObject({ headline: "Career coach", bio: "Ten years of it.", whatsapp: "+919876543210", reviewsUrl: "https://g.page/r/abc" });
    await saveProfile(pool, host, { ...v.value, headline: null });
    expect((await getProfile(pool, host)).headline).toBeNull();
  });

  it("keeps one photo, typed by its bytes, and none for a closed account", async () => {
    await savePhoto(pool, host, PNG);
    await savePhoto(pool, host, JPEG);
    const p = await getProfile(pool, host);
    expect(p.hasPhoto).toBe(true);
    expect(p.photoVersion).toBeGreaterThan(0);
    expect((await photoBySlug(pool, "priya-c"))?.mime).toBe("image/jpeg");
    await expect(savePhoto(pool, host, new TextEncoder().encode("<svg/>"))).rejects.toMatchObject({ name: "PhotoRejectedError", reason: "not_an_image" });
    const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
    big.set(PNG);
    await expect(savePhoto(pool, host, big)).rejects.toMatchObject({ reason: "too_big" });

    await pool.query("update users set deleted_at = now() where id = $1", [host]);
    expect(await photoBySlug(pool, "priya-c")).toBeNull();
    await pool.query("update users set deleted_at = null where id = $1", [host]);
    await removePhoto(pool, host);
    expect(await photoBySlug(pool, "priya-c")).toBeNull();
  });
});
