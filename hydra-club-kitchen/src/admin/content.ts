import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { isHHmm, WEEKDAYS } from "@/booking/time";
import type { Db } from "@/db/client";
import { auditLog, menuCategories, menuItems, nights, photos, settings, zones } from "@/db/schema";
import { keyFromUrl, PHOTO_TAGS, removeFiles } from "@/media/photos";

/**
 * Content editing for admin (menu, nights, photos, settings, zones). Strict
 * validation (unlike the read-side settings parser, nothing falls back here),
 * and every change writes one audit row.
 */
type Ok<T extends object = object> = { ok: true } & T;
type Fail = { ok: false; status: number; message: string };
const fail = (status: number, message: string): Fail => ({ ok: false, status, message });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form.";
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const audit = (db: Db | Tx, userId: string, action: string, entity: string, entityId: string, diff: unknown) =>
  db.insert(auditLog).values({ userId, action, entity, entityId, diff });

// ---------- Photos ----------
const photoPatch = z.object({
  id: z.coerce.number().int().positive(),
  tag: z.enum(PHOTO_TAGS).optional(),
  alt: z.string().trim().min(3).max(200).optional(),
  heroScene: z.enum(PHOTO_TAGS).nullable().optional(),
  sort: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
});

export async function updatePhoto(db: Db, userId: string, raw: unknown): Promise<Ok | Fail> {
  const p = photoPatch.safeParse(raw);
  if (!p.success) return fail(400, firstIssue(p.error));
  const { id, heroScene, ...rest } = p.data;
  return db.transaction(async (tx) => {
    if (heroScene) await tx.update(photos).set({ heroScene: null }).where(eq(photos.heroScene, heroScene));
    const patch = { ...rest, ...(heroScene !== undefined ? { heroScene, hero: heroScene !== null } : {}) };
    const [row] = await tx.update(photos).set(patch).where(eq(photos.id, id)).returning({ id: photos.id });
    if (!row) return fail(404, "Photo not found.");
    await audit(tx, userId, "photo.update", "photo", String(id), p.data);
    return { ok: true as const };
  });
}

export async function deletePhoto(db: Db, userId: string, rawId: unknown): Promise<Ok | Fail> {
  const id = z.coerce.number().int().positive().safeParse(rawId);
  if (!id.success) return fail(400, "Bad photo id.");
  const [row] = await db.delete(photos).where(eq(photos.id, id.data)).returning();
  if (!row) return fail(404, "Photo not found.");
  const key = keyFromUrl(row.webpUrl);
  if (key) await removeFiles(key);
  await audit(db, userId, "photo.delete", "photo", String(id.data), { tag: row.tag, alt: row.alt });
  return { ok: true };
}

// ---------- Menu ----------
const rupees = z.coerce.number().min(0).max(1_000_000).transform((r) => Math.round(r * 100));
const categorySchema = z.object({ name: z.string().trim().min(1, "Name the section.").max(60), sort: z.coerce.number().int().min(0).max(999).optional() });
const itemSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name the dish.").max(80),
  description: z.string().trim().max(240).optional().transform((v) => v || null),
  priceRupees: z.union([z.literal(""), z.null(), rupees]).optional().transform((v) => (typeof v === "number" ? v : null)),
  veg: z.coerce.boolean(),
  available: z.coerce.boolean().optional().default(true),
  sort: z.coerce.number().int().min(0).max(999).optional(),
});

export async function menuChange(db: Db, userId: string, method: "POST" | "PATCH" | "DELETE", raw: Record<string, unknown>): Promise<Ok | Fail> {
  const kind = raw.kind === "item" ? "item" : raw.kind === "category" ? "category" : null;
  if (!kind) return fail(400, "Say whether this is a section or a dish.");
  const id = z.coerce.number().int().positive().safeParse(raw.id);
  if (method !== "POST" && !id.success) return fail(400, "Bad id.");

  if (kind === "category") {
    if (method === "DELETE") {
      const [row] = await db.delete(menuCategories).where(eq(menuCategories.id, id.data!)).returning();
      if (!row) return fail(404, "Section not found.");
      await audit(db, userId, "menu.category.delete", "menu_category", String(row.id), { name: row.name });
      return { ok: true };
    }
    const p = (method === "POST" ? categorySchema : categorySchema.partial()).safeParse(raw);
    if (!p.success) return fail(400, firstIssue(p.error));
    try {
      const [row] =
        method === "POST"
          ? await db.insert(menuCategories).values(p.data as z.infer<typeof categorySchema>).returning()
          : await db.update(menuCategories).set(p.data).where(eq(menuCategories.id, id.data!)).returning();
      if (!row) return fail(404, "Section not found.");
      await audit(db, userId, `menu.category.${method === "POST" ? "create" : "update"}`, "menu_category", String(row.id), p.data);
      return { ok: true };
    } catch {
      return fail(409, "There's already a section with that name.");
    }
  }

  if (method === "DELETE") {
    const [row] = await db.delete(menuItems).where(eq(menuItems.id, id.data!)).returning();
    if (!row) return fail(404, "Dish not found.");
    await audit(db, userId, "menu.item.delete", "menu_item", String(row.id), { name: row.name });
    return { ok: true };
  }
  const p = (method === "POST" ? itemSchema : itemSchema.partial()).safeParse(raw);
  if (!p.success) return fail(400, firstIssue(p.error));
  const { priceRupees, ...rest } = p.data;
  const values = { ...rest, ...(priceRupees !== undefined ? { pricePaise: priceRupees } : {}) };
  const [row] =
    method === "POST"
      ? await db.insert(menuItems).values(values as typeof menuItems.$inferInsert).returning()
      : await db.update(menuItems).set(values).where(eq(menuItems.id, id.data!)).returning();
  if (!row) return fail(404, "Dish not found.");
  await audit(db, userId, `menu.item.${method === "POST" ? "create" : "update"}`, "menu_item", String(row.id), p.data);
  return { ok: true };
}

export async function getMenuForAdmin(db: Db) {
  const [cats, items] = await Promise.all([
    db.select().from(menuCategories).orderBy(asc(menuCategories.sort), asc(menuCategories.id)),
    db.select().from(menuItems).orderBy(asc(menuItems.sort), asc(menuItems.id)),
  ]);
  return cats.map((c) => ({ ...c, items: items.filter((i) => i.categoryId === c.id) }));
}

// ---------- Nights ----------
const nightSchema = z.object({
  title: z.string().trim().min(1, "Name the night.").max(60),
  days: z.string().trim().min(1, "Say which days, e.g. Every Friday.").max(60),
  blurb: z.string().trim().min(1, "Add one line about it.").max(240),
  accent: z.enum(["rose", "amber", "aqua"]),
  ctaDateRule: z
    .string()
    .trim()
    .regex(/^([1-7](,[1-7])*)?$/, "Weekdays as numbers 1 (Mon) to 7 (Sun), comma separated.")
    .transform((v) => v || null),
  sort: z.coerce.number().int().min(0).max(999).optional(),
});

export async function nightChange(db: Db, userId: string, method: "POST" | "PATCH" | "DELETE", raw: Record<string, unknown>): Promise<Ok | Fail> {
  const id = z.coerce.number().int().positive().safeParse(raw.id);
  if (method !== "POST" && !id.success) return fail(400, "Bad id.");
  if (method === "DELETE") {
    const [row] = await db.delete(nights).where(eq(nights.id, id.data!)).returning();
    if (!row) return fail(404, "Night not found.");
    await audit(db, userId, "night.delete", "night", String(row.id), { title: row.title });
    return { ok: true };
  }
  const p = (method === "POST" ? nightSchema : nightSchema.partial()).safeParse(raw);
  if (!p.success) return fail(400, firstIssue(p.error));
  const [row] =
    method === "POST"
      ? await db.insert(nights).values(p.data as z.infer<typeof nightSchema>).returning()
      : await db.update(nights).set(p.data).where(eq(nights.id, id.data!)).returning();
  if (!row) return fail(404, "Night not found.");
  await audit(db, userId, `night.${method === "POST" ? "create" : "update"}`, "night", String(row.id), p.data);
  return { ok: true };
}

// ---------- Settings ----------
const hhmm = z.string().refine(isHHmm, "Use 24-hour HH:mm, e.g. 23:30.");
const url = z.union([z.literal(""), z.url({ protocol: /^https$/, message: "Use a full https:// link." })]);
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[^\d+]/g, ""))
  .refine((v) => v === "" || /^\+\d{10,15}$/.test(v), "Include the country code, e.g. +91 98765 43210.");

/** Strict per-key validators for what staff may edit. */
export const SETTING_SCHEMAS = {
  whatsapp: phone,
  phone,
  hours: z
    .object(
      Object.fromEntries(WEEKDAYS.map((d) => [d, z.object({ open: hhmm, close: hhmm }).nullable()])) as unknown as Record<
        (typeof WEEKDAYS)[number],
        z.ZodNullable<z.ZodObject<{ open: typeof hhmm; close: typeof hhmm }>>
      >,
    )
    .nullable(),
  address: z.string().trim().min(10).max(300),
  address_block_confirmed: z.boolean(),
  maps_url: url,
  instagram: url,
  good_to_know: z.array(z.string().trim().min(1).max(40)).max(12),
  cost_for_two_inr: z.coerce.number().int().positive().max(100_000).nullable(),
  cuisines: z.array(z.string().trim().min(1).max(40)).max(12),
  slot_length_minutes: z.coerce.number().int().min(30).max(360),
  booking_window_days: z.coerce.number().int().min(1).max(90),
  max_guests_per_table: z.coerce.number().int().min(1).max(50),
  booking_enabled: z.boolean(),
  captcha_enabled: z.boolean(),
} as const;
export type SettingKey = keyof typeof SETTING_SCHEMAS;

export async function updateSetting(db: Db, userId: string, raw: { key?: unknown; value?: unknown }): Promise<Ok | Fail> {
  const key = String(raw.key) as SettingKey;
  const schema = SETTING_SCHEMAS[key];
  if (!schema) return fail(400, "Unknown setting.");
  const p = schema.safeParse(raw.value);
  if (!p.success) return fail(400, firstIssue(p.error));
  if (key === "captcha_enabled" && p.data === true && !process.env.TURNSTILE_SECRET_KEY) {
    return fail(409, "Turnstile isn't configured on the server yet (TURNSTILE_SECRET_KEY). Ask Marvice to set it up first.");
  }
  const [before] = await db.select().from(settings).where(eq(settings.key, key));
  await db
    .insert(settings)
    .values({ key, value: p.data as object, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: p.data as object, updatedBy: userId, updatedAt: new Date() } });
  await audit(db, userId, "setting.update", "setting", key, { from: before?.value ?? null, to: p.data });
  return { ok: true };
}

const zonePatch = z.object({
  key: z.enum(["standard", "vip", "vvip", "mezz"]),
  note: z.string().trim().max(240).optional().transform((v) => v || null),
  seats: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(500)]).optional().transform((v) => (typeof v === "number" ? v : null)),
  minSpendRupees: z.union([z.literal(""), z.null(), rupees]).optional().transform((v) => (typeof v === "number" ? v : null)),
});

/** Zone details shown on the VIP cards (capacity and minimum spend stay hidden until set). */
export async function updateZone(db: Db, userId: string, raw: unknown): Promise<Ok | Fail> {
  const p = zonePatch.safeParse(raw);
  if (!p.success) return fail(400, firstIssue(p.error));
  const { key, note, seats, minSpendRupees } = p.data;
  const [row] = await db.update(zones).set({ note, seats, minSpendPaise: minSpendRupees }).where(eq(zones.key, key)).returning();
  if (!row) return fail(404, "Zone not found.");
  await audit(db, userId, "zone.update", "zone", key, { note, seats, minSpendPaise: minSpendRupees });
  return { ok: true };
}

/** Facts the brief lists as unconfirmed (§12), still missing or unconfirmed in settings. */
export function unconfirmedWarnings(s: Record<string, unknown>, zoneRows: { key: string; seats: number | null; minSpendPaise: number | null }[]): string[] {
  const out: string[] = [];
  if (!s.whatsapp) out.push("WhatsApp number is empty, so the WhatsApp buttons are hidden. Three numbers are in circulation: confirm the right one.");
  if (!s.phone) out.push("Phone number is empty, so it isn't shown on the site.");
  if (!s.hours) out.push("Opening hours are not set, so online booking is closed.");
  if (s.address_block_confirmed !== true) out.push("The address says Koramangala 5th Block; listings disagree with 6th Block. Confirm, then tick 'address confirmed'.");
  const vip = zoneRows.filter((z) => z.key === "vip" || z.key === "vvip");
  if (vip.some((z) => z.seats === null || z.minSpendPaise === null)) out.push("VIP/VVIP capacity and minimum spend are not set, so they're hidden on the VIP cards.");
  return out;
}
