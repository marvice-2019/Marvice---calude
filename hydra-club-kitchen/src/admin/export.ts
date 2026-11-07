import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { istTime } from "@/booking/service";
import { isIsoDate } from "@/booking/time";
import type { Db } from "@/db/client";
import { auditLog, bookings, tables, zones } from "@/db/schema";

/** Longest range one export may cover, so a typo can't pull years of guest data. */
export const EXPORT_MAX_DAYS = 366;

export const exportRangeSchema = z
  .object({ from: z.string().refine(isIsoDate, "Pick a start date."), to: z.string().refine(isIsoDate, "Pick an end date.") })
  .refine((v) => v.from <= v.to, { message: "The start date must be on or before the end date." })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < EXPORT_MAX_DAYS, {
    message: `Export at most ${EXPORT_MAX_DAYS} days at a time.`,
  });

export const CSV_HEADER = ["ref", "service_date", "time_ist", "table", "zone", "guests", "name", "phone", "status", "source", "notes", "created_at"];

/** Spreadsheet apps run cells that start with these as formulas. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula-looking text gets a leading quote, then RFC 4180 quoting. */
export function csvCell(value: string | number | null): string {
  let v = value === null ? "" : String(value);
  if (FORMULA_START.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export type ExportResult = { ok: true; csv: string; rows: number; from: string; to: string } | { ok: false; message: string };

/** Bookings whose service date is in [from, to], as CSV. Audits who exported what range and how many rows (no guest data). */
export async function exportBookingsCsv(db: Db, userId: string, raw: unknown): Promise<ExportResult> {
  const parsed = exportRangeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Pick a date range." };
  const { from, to } = parsed.data;
  const rows = await db
    .select({ b: bookings, table: tables.code, zone: zones.key })
    .from(bookings)
    .innerJoin(tables, eq(tables.id, bookings.tableId))
    .innerJoin(zones, eq(zones.id, tables.zoneId))
    .where(and(gte(bookings.serviceDate, from), lte(bookings.serviceDate, to)))
    .orderBy(asc(bookings.startsAt), asc(tables.id));
  const lines = [CSV_HEADER.join(",")];
  for (const { b, table, zone } of rows) {
    lines.push(
      [b.ref, b.serviceDate, istTime(b.startsAt), table, zone, b.guests, b.name, b.phoneE164, b.status, b.source, b.notes, b.createdAt.toISOString()]
        .map(csvCell)
        .join(","),
    );
  }
  await db.insert(auditLog).values({
    userId,
    action: "booking.export",
    entity: "booking",
    entityId: `${from}..${to}`,
    diff: { from, to, rows: rows.length },
  });
  return { ok: true, csv: `${lines.join("\r\n")}\r\n`, rows: rows.length, from, to };
}
