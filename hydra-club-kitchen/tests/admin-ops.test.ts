import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { csvCell, exportBookingsCsv } from "../src/admin/export";
import { createBooking, createWalkIn, lookupBooking } from "../src/booking/service";
import type { WeekHours } from "../src/booking/time";
import { auditLog, bookings, settings, tables, users } from "../src/db/schema";
import { getSettings, type Settings } from "../src/lib/settings";
import { freshDb } from "./db-helpers";

const day = { open: "11:30", close: "01:00" };
const HOURS: WeekHours = { mon: null, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
const NOW = new Date("2026-12-01T15:30:00Z"); // Tue 1 Dec 2026, 21:00 IST

let conn: Awaited<ReturnType<typeof freshDb>>;
let s: Settings;
let staffId: string;

beforeAll(async () => {
  conn = await freshDb();
  await conn.db.update(settings).set({ value: HOURS }).where(eq(settings.key, "hours"));
  s = await getSettings(conn.db);
  const [u] = await conn.db.insert(users).values({ email: "mgr@hydra.test", name: "Mgr", passwordHash: "x", role: "manager" }).returning();
  staffId = u!.id;
});
afterAll(async () => conn?.sql.end());

const walkIn = (over: Record<string, unknown> = {}) =>
  createWalkIn(conn.db, s, staffId, { table: "T2", time: "now", guests: 3, name: "Walk In", ...over }, NOW);

describe("walk-ins", () => {
  it("seats a walk-in without a phone: confirmed, source walk_in, audited", async () => {
    const r = await walkIn();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking).toMatchObject({ status: "confirmed", date: "2026-12-01", time: "21:00", table: "T2" });
    const [row] = await conn.db.select().from(bookings).where(eq(bookings.ref, r.booking.ref));
    expect(row).toMatchObject({ phoneE164: null, source: "walk_in", status: "confirmed" });
    const [a] = await conn.db.select().from(auditLog).where(eq(auditLog.entityId, r.booking.ref));
    expect(a).toMatchObject({ action: "booking.walk_in", userId: staffId });
  });

  it("still refuses an overlapping table with the friendly taken message", async () => {
    const r = await walkIn({ name: "Second" });
    expect(r).toMatchObject({ ok: false, status: 409, code: "table_taken" });
  });

  it("accepts an optional phone but rejects a malformed one", async () => {
    const good = await walkIn({ table: "T3", phone: "98765 43210" });
    expect(good.ok).toBe(true);
    const bad = await walkIn({ table: "T5", phone: "12345" });
    expect(bad).toMatchObject({ ok: false, status: 400, fields: { phone: expect.any(String) } });
  });

  it("the database refuses a web booking without a phone", async () => {
    const [t] = await conn.db.select({ id: tables.id }).from(tables).where(eq(tables.code, "T6"));
    const insert = conn.db.insert(bookings).values({
      ref: "HYD-ZZZZ",
      tableId: t!.id,
      startsAt: new Date("2026-12-02T15:30:00Z"),
      endsAt: new Date("2026-12-02T17:30:00Z"),
      guests: 2,
      name: "No Phone",
      phoneE164: null,
      source: "web",
    });
    await expect(insert).rejects.toMatchObject({ cause: { code: "23514", constraint_name: "bookings_phone_required" } });
  });

  it("guest lookup never matches a booking with no phone", async () => {
    const r = await walkIn({ table: "T7" });
    if (!r.ok) throw new Error("walk-in failed");
    for (const last4 of ["0000", "1234"]) {
      expect(await lookupBooking(conn.db, { ref: r.booking.ref, last4 })).toMatchObject({ ok: false, status: 404 });
    }
  });
});

describe("CSV export", () => {
  it("neutralises formula cells and quotes per RFC 4180", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+91")).toBe("'+91");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe("\"'\rx\"");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell(4)).toBe("4");
  });

  it("exports the range with all columns and audits without guest data", async () => {
    const made = await createBooking(
      conn.db,
      s,
      { table: "T4", date: "2026-12-04", time: "21:00", guests: 4, name: '=HYPERLINK("x")', phone: "98765 43210", notes: "+cmd", consent: true },
      { ip: "198.51.100.9", now: new Date("2026-12-01T06:30:00Z") },
    );
    if (!made.ok) throw new Error(made.message);
    const r = await exportBookingsCsv(conn.db, staffId, { from: "2026-12-01", to: "2026-12-04" });
    if (!r.ok) throw new Error(r.message);
    const lines = r.csv.trim().split("\r\n");
    expect(lines[0]).toBe("ref,service_date,time_ist,table,zone,guests,name,phone,status,source,notes,created_at");
    expect(r.rows).toBe(lines.length - 1);
    expect(r.rows).toBeGreaterThanOrEqual(4);
    const line = lines.find((l) => l.startsWith(made.booking.ref))!;
    expect(line).toContain(`,2026-12-04,21:00,T4,`);
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain(",'+919876543210,pending,web,'+cmd,");
    expect(lines.some((l) => l.includes(",walk_in,"))).toBe(true);

    const [a] = await conn.db.select().from(auditLog).where(eq(auditLog.action, "booking.export"));
    expect(a).toMatchObject({ userId: staffId, entityId: "2026-12-01..2026-12-04", diff: { from: "2026-12-01", to: "2026-12-04", rows: r.rows } });
    expect(JSON.stringify(a)).not.toMatch(/HYPERLINK|9876543210|Walk In/);
  });

  it("refuses a backwards range", async () => {
    expect(await exportBookingsCsv(conn.db, staffId, { from: "2026-12-04", to: "2026-12-01" })).toMatchObject({ ok: false });
  });
});
