import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMenuForAdmin, menuChange, nightChange, unconfirmedWarnings, updateSetting, updateZone } from "../src/admin/content";
import { auditLog, menuItems, nights, settings, users, zones } from "../src/db/schema";
import { getSettings } from "../src/lib/settings";
import { freshDb } from "./db-helpers";

let conn: Awaited<ReturnType<typeof freshDb>>;
let uid: string;
beforeAll(async () => {
  conn = await freshDb();
  const [u] = await conn.db.insert(users).values({ email: "m@hydra.test", name: "M", passwordHash: "x", role: "manager" }).returning();
  uid = u!.id;
});
afterAll(async () => conn?.sql.end());

describe("menu", () => {
  it("adds sections and dishes, stores rupees as paise, leaves an empty price blank", async () => {
    expect(await menuChange(conn.db, uid, "POST", { kind: "category", name: "Small plates" })).toEqual({ ok: true });
    expect(await menuChange(conn.db, uid, "POST", { kind: "category", name: "Small plates" })).toMatchObject({ ok: false, status: 409 });
    const [cat] = await getMenuForAdmin(conn.db);
    expect(await menuChange(conn.db, uid, "POST", { kind: "item", categoryId: cat!.id, name: "Paneer tikka", priceRupees: "420", veg: true })).toEqual({ ok: true });
    expect(await menuChange(conn.db, uid, "POST", { kind: "item", categoryId: cat!.id, name: "Chef's special", priceRupees: "", veg: false })).toEqual({ ok: true });
    const items = await conn.db.select().from(menuItems).orderBy(menuItems.id);
    expect(items.map((i) => [i.name, i.pricePaise, i.veg])).toEqual([
      ["Paneer tikka", 42000, true],
      ["Chef's special", null, false],
    ]);
    expect(await menuChange(conn.db, uid, "PATCH", { kind: "item", id: items[0]!.id, available: false })).toEqual({ ok: true });
    expect(await menuChange(conn.db, uid, "POST", { kind: "item", categoryId: cat!.id, name: "", veg: true })).toMatchObject({ ok: false, message: "Name the dish." });
    expect(await menuChange(conn.db, uid, "DELETE", { kind: "category", id: cat!.id })).toEqual({ ok: true });
    expect(await conn.db.select().from(menuItems)).toEqual([]); // dishes go with their section
  });
});

describe("nights", () => {
  it("validates the pre-fill weekday rule", async () => {
    expect(await nightChange(conn.db, uid, "POST", { title: "Techno Fridays", days: "Every Friday", blurb: "Lights low, bass up.", accent: "aqua", ctaDateRule: "5" })).toEqual({ ok: true });
    expect(await nightChange(conn.db, uid, "POST", { title: "Bad", days: "x", blurb: "x", accent: "aqua", ctaDateRule: "8" })).toMatchObject({ ok: false, status: 400 });
    expect((await conn.db.select().from(nights)).map((n) => n.ctaDateRule)).toEqual(["5"]);
  });
});

describe("settings and zones", () => {
  it("normalises the WhatsApp number, refuses bad values and audits the change", async () => {
    expect(await updateSetting(conn.db, uid, { key: "whatsapp", value: "+91 70000-00000" })).toEqual({ ok: true });
    expect((await getSettings(conn.db)).whatsapp).toBe("+917000000000");
    expect(await updateSetting(conn.db, uid, { key: "whatsapp", value: "70000" })).toMatchObject({ ok: false });
    expect(await updateSetting(conn.db, uid, { key: "instagram", value: "http://insecure.example" })).toMatchObject({ ok: false });
    expect(await updateSetting(conn.db, uid, { key: "hours", value: { mon: { open: "25:00", close: "01:00" } } })).toMatchObject({ ok: false });
    expect(await updateSetting(conn.db, uid, { key: "no_such_key", value: 1 })).toMatchObject({ ok: false, message: "Unknown setting." });
    const audit = await conn.db.select().from(auditLog).where(eq(auditLog.action, "setting.update"));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.diff).toEqual({ from: "", to: "+917000000000" });
  });

  it("won't switch on the captcha before the server has a Turnstile key", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(await updateSetting(conn.db, uid, { key: "captcha_enabled", value: true })).toMatchObject({ ok: false, status: 409 });
  });

  it("stores zone capacity and minimum spend, and the warnings shrink as facts are confirmed", async () => {
    const s0 = Object.fromEntries((await conn.db.select().from(settings)).map((r) => [r.key, r.value]));
    const before = unconfirmedWarnings(s0, await conn.db.select().from(zones));
    expect(before.some((w) => w.includes("VIP/VVIP"))).toBe(true);
    for (const key of ["vip", "vvip"] as const) expect(await updateZone(conn.db, uid, { key, seats: 8, minSpendRupees: "15000", note: "" })).toEqual({ ok: true });
    const [vip] = await conn.db.select().from(zones).where(eq(zones.key, "vip"));
    expect(vip).toMatchObject({ seats: 8, minSpendPaise: 1_500_000, note: null });
    const after = unconfirmedWarnings(s0, await conn.db.select().from(zones));
    expect(after.some((w) => w.includes("VIP/VVIP"))).toBe(false);
    await conn.db.execute(sql`select 1`);
  });
});
