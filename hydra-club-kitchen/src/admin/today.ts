import { asc, eq } from "drizzle-orm";
import { istTime } from "@/booking/service";
import { serviceDateOf } from "@/booking/time";
import type { Db } from "@/db/client";
import { bookings, tableHolds, tables, zones } from "@/db/schema";

export type TableNow = { code: string; zone: string; state: "free" | "seated" | "booked" | "held"; next?: string };
export type Arrival = {
  id: string;
  ref: string;
  time: string;
  table: string;
  zone: string;
  guests: number;
  name: string;
  phone: string | null;
  notes: string | null;
  status: string;
  source: string;
};
export type TodayView = {
  date: string;
  hours: { hour: string; arrivals: Arrival[] }[];
  tables: TableNow[];
  counts: { bookings: number; covers: number; seatedNow: number };
};

/**
 * Tonight at a glance for the door: arrivals grouped by IST hour (a night runs
 * past midnight, so 00:xx sorts after 23:xx), and every table's state right now.
 * Cancelled bookings and no-shows are left out of the counts.
 */
export async function getTodayView(db: Db, now = new Date()): Promise<TodayView> {
  const date = serviceDateOf(now);
  const [rows, tableRows, holdRows] = await Promise.all([
    db
      .select({ b: bookings, table: tables.code, zone: zones.key })
      .from(bookings)
      .innerJoin(tables, eq(tables.id, bookings.tableId))
      .innerJoin(zones, eq(zones.id, tables.zoneId))
      .where(eq(bookings.serviceDate, date))
      .orderBy(asc(bookings.startsAt), asc(tables.id)),
    db
      .select({ id: tables.id, code: tables.code, zoneId: tables.zoneId, zone: zones.key })
      .from(tables)
      .innerJoin(zones, eq(zones.id, tables.zoneId))
      .where(eq(tables.active, true))
      .orderBy(asc(zones.sort), asc(tables.id)),
    db
      .select({ tableId: tableHolds.tableId, zoneId: tableHolds.zoneId })
      .from(tableHolds)
      .where(eq(tableHolds.date, date)),
  ]);

  const arrivals: Arrival[] = rows.map(({ b, table, zone }) => ({
    id: b.id,
    ref: b.ref,
    time: istTime(b.startsAt),
    table,
    zone,
    guests: b.guests,
    name: b.name,
    phone: b.phoneE164,
    notes: b.notes,
    status: b.status,
    source: b.source,
  }));
  const hours = new Map<string, Arrival[]>();
  for (const a of arrivals) {
    const hour = `${a.time.slice(0, 2)}:00`;
    hours.set(hour, [...(hours.get(hour) ?? []), a]);
  }

  const live = rows.filter(({ b }) => b.status === "pending" || b.status === "confirmed");
  const heldTables = new Set(holdRows.map((h) => h.tableId).filter((x): x is number => x !== null));
  const heldZones = new Set(holdRows.map((h) => h.zoneId).filter((x): x is number => x !== null));
  const tablesNow: TableNow[] = tableRows.map((t) => {
    if (heldTables.has(t.id) || heldZones.has(t.zoneId)) return { code: t.code, zone: t.zone, state: "held" };
    const mine = live.filter(({ b }) => b.tableId === t.id);
    if (mine.some(({ b }) => b.startsAt <= now && b.endsAt > now)) return { code: t.code, zone: t.zone, state: "seated" };
    const next = mine.find(({ b }) => b.startsAt > now);
    return next ? { code: t.code, zone: t.zone, state: "booked", next: istTime(next.b.startsAt) } : { code: t.code, zone: t.zone, state: "free" };
  });

  return {
    date,
    hours: [...hours.entries()].map(([hour, list]) => ({ hour, arrivals: list })),
    tables: tablesNow,
    counts: {
      bookings: live.length,
      covers: live.reduce((n, { b }) => n + b.guests, 0),
      seatedNow: tablesNow.filter((t) => t.state === "seated").length,
    },
  };
}
