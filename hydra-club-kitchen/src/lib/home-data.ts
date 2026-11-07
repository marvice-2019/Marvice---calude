import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { menuCategories, menuItems, nights, photos, tables, zones } from "@/db/schema";
import { bookingOpen, getSettings, type Settings } from "./settings";

export type ZoneInfo = {
  key: "standard" | "vip" | "vvip" | "mezz";
  name: string;
  colour: string;
  note: string | null;
  seats: number | null;
  minSpendPaise: number | null;
  tableCount: number;
};
export type PhotoInfo = typeof photos.$inferSelect;
export type MenuCategory = { id: number; name: string; items: (typeof menuItems.$inferSelect)[] };
export type Night = typeof nights.$inferSelect;

export type HomeData = {
  settings: Settings;
  bookingOpen: boolean;
  zones: ZoneInfo[];
  /** Active bookable tables. Every number on the site is derived from the DB, never typed in. */
  totalTables: number;
  photos: PhotoInfo[];
  menu: MenuCategory[];
  nights: Night[];
};

/** Everything the public pages read, in one round of queries. */
export async function getHomeData(): Promise<HomeData> {
  const db = getDb();
  const [settings, zoneRows, photoRows, categoryRows, itemRows, nightRows] = await Promise.all([
    getSettings(db),
    db
      .select({
        key: zones.key,
        name: zones.name,
        colour: zones.colour,
        note: zones.note,
        seats: zones.seats,
        minSpendPaise: zones.minSpendPaise,
        tableCount: sql<number>`count(${tables.id}) filter (where ${tables.active})::int`,
      })
      .from(zones)
      .leftJoin(tables, eq(tables.zoneId, zones.id))
      .groupBy(zones.id)
      .orderBy(asc(zones.sort)),
    db.select().from(photos).orderBy(asc(photos.tag), asc(photos.sort), asc(photos.id)),
    db.select().from(menuCategories).orderBy(asc(menuCategories.sort), asc(menuCategories.id)),
    db.select().from(menuItems).where(eq(menuItems.available, true)).orderBy(asc(menuItems.sort), asc(menuItems.id)),
    db.select().from(nights).orderBy(asc(nights.sort), asc(nights.id)),
  ]);
  const menu = categoryRows
    .map((c) => ({ id: c.id, name: c.name, items: itemRows.filter((i) => i.categoryId === c.id) }))
    .filter((c) => c.items.length > 0);
  return {
    settings,
    bookingOpen: bookingOpen(settings),
    zones: zoneRows,
    totalTables: zoneRows.reduce((n, z) => n + z.tableCount, 0),
    photos: photoRows,
    menu,
    nights: nightRows,
  };
}
