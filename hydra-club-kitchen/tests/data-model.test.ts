import { eq, sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookings, nights, settings, tables, tableHolds, zones } from "../src/db/schema";
import { seed } from "../scripts/seed";
import { freshDb } from "./db-helpers";

let conn: Awaited<ReturnType<typeof freshDb>>;
let t1: number;
let t2: number;

beforeAll(async () => {
  conn = await freshDb();
  const rows = await conn.db.select().from(tables);
  t1 = rows.find((r) => r.code === "T1")!.id;
  t2 = rows.find((r) => r.code === "T2")!.id;
});
afterAll(async () => conn?.sql.end());

let refN = 0;
const booking = (over: Partial<typeof bookings.$inferInsert> = {}) => ({
  ref: `HYD-${String(refN++).padStart(4, "0")}`,
  tableId: t1,
  startsAt: new Date("2026-12-04T15:00:00Z"), // 20:30 IST
  endsAt: new Date("2026-12-04T17:00:00Z"), // 22:30 IST
  guests: 4,
  name: "Test Guest",
  phoneE164: "+919876543210",
  ...over,
});

const pgCode = (err: unknown) => (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;

describe("seed", () => {
  it("loads 4 zones and 20 tables in the right zones", async () => {
    const zoneRows = await conn.db.select().from(zones);
    expect(zoneRows.map((z) => z.key).sort()).toEqual(["mezz", "standard", "vip", "vvip"]);
    const counts = await conn.db.execute(
      dsql`select z.key, count(t.id)::int as n from zones z join tables t on t.zone_id = z.id group by z.key, z.sort order by z.sort`,
    );
    expect([...counts]).toEqual([
      { key: "standard", n: 12 },
      { key: "vip", n: 2 },
      { key: "vvip", n: 2 },
      { key: "mezz", n: 4 },
    ]);
  });

  it("ships unconfirmed facts empty and never invents capacity, spend or nights", async () => {
    const s = Object.fromEntries((await conn.db.select().from(settings)).map((r) => [r.key, r.value]));
    expect(s.whatsapp).toBe("");
    expect(s.phone).toBe("");
    // Hours were confirmed by the client (2026-11-07): every day 11:30 AM to 1 AM.
    const day = { open: "11:30", close: "01:00" };
    expect(s.hours).toEqual({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day });
    expect(s.address_block_confirmed).toBe(false);
    const zoneRows = await conn.db.select().from(zones);
    expect(zoneRows.every((z) => z.seats === null && z.minSpendPaise === null)).toBe(true);
    expect(await conn.db.select().from(nights)).toEqual([]);
  });

  it("is idempotent and does not overwrite admin edits", async () => {
    await conn.db.update(settings).set({ value: "+919999999999" }).where(eq(settings.key, "whatsapp"));
    await seed(conn.db);
    const [w] = await conn.db.select().from(settings).where(eq(settings.key, "whatsapp"));
    expect(w!.value).toBe("+919999999999");
    expect((await conn.db.select().from(tables)).length).toBe(20);
  });
});

describe("no double booking (bookings_no_overlap)", () => {
  it("rejects an overlapping live booking on the same table", async () => {
    await conn.db.insert(bookings).values(booking());
    await expect(
      conn.db.insert(bookings).values(
        booking({ startsAt: new Date("2026-12-04T16:00:00Z"), endsAt: new Date("2026-12-04T18:00:00Z") }),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === "23P01");
  });

  it("allows the same slot on a different table", async () => {
    await expect(conn.db.insert(bookings).values(booking({ tableId: t2 }))).resolves.toBeDefined();
  });

  it("allows back-to-back bookings (half-open ranges)", async () => {
    await expect(
      conn.db.insert(bookings).values(
        booking({ startsAt: new Date("2026-12-04T17:00:00Z"), endsAt: new Date("2026-12-04T19:00:00Z") }),
      ),
    ).resolves.toBeDefined();
  });

  it("frees the slot once the booking is cancelled", async () => {
    const slot = { startsAt: new Date("2026-12-05T15:00:00Z"), endsAt: new Date("2026-12-05T17:00:00Z") };
    const [first] = await conn.db.insert(bookings).values(booking(slot)).returning();
    await conn.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, first!.id));
    await expect(conn.db.insert(bookings).values(booking(slot))).resolves.toBeDefined();
  });

  it("two simultaneous bookings for the same table and slot: exactly one succeeds", async () => {
    const slot = { startsAt: new Date("2026-12-06T15:00:00Z"), endsAt: new Date("2026-12-06T17:00:00Z") };
    const attempts = Array.from({ length: 8 }, () =>
      conn.sql.begin(async (tx) => {
        await tx`select pg_sleep(0.05)`; // widen the race window
        const b = booking(slot);
        await tx`insert into bookings (ref, table_id, starts_at, ends_at, guests, name, phone_e164)
                 values (${b.ref}, ${b.tableId}, ${b.startsAt.toISOString()}, ${b.endsAt.toISOString()}, ${b.guests}, ${b.name}, ${b.phoneE164})`;
      }),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.every((r) => pgCode(r.reason) === "23P01")).toBe(true);
  });
});

describe("service date (Asia/Kolkata, cutoff 05:00)", () => {
  const serviceDateOf = async (iso: string, tableId: number) => {
    const [row] = await conn.db
      .insert(bookings)
      .values(booking({ tableId, startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 3600_000) }))
      .returning({ d: bookings.serviceDate });
    return row!.d;
  };

  it("an 11:30 PM IST slot belongs to that day", async () => {
    expect(await serviceDateOf("2026-12-10T18:00:00Z", t1)).toBe("2026-12-10"); // 23:30 IST on the 10th
  });

  it("a 12:30 AM IST slot belongs to the previous day's night", async () => {
    expect(await serviceDateOf("2026-12-10T19:00:00Z", t2)).toBe("2026-12-10"); // 00:30 IST on the 11th
  });

  it("a noon IST slot belongs to that day", async () => {
    expect(await serviceDateOf("2026-12-11T06:30:00Z", t1)).toBe("2026-12-11"); // 12:00 IST on the 11th
  });
});

describe("constraints", () => {
  it("rejects bad refs, non-Indian-mobile phones, inverted times and zero guests", async () => {
    const bad = [
      booking({ ref: "HYD-12" }),
      booking({ phoneE164: "+915876543210", startsAt: new Date("2027-01-01T10:00:00Z"), endsAt: new Date("2027-01-01T11:00:00Z") }),
      booking({ startsAt: new Date("2027-01-02T12:00:00Z"), endsAt: new Date("2027-01-02T11:00:00Z") }),
      booking({ guests: 0, startsAt: new Date("2027-01-03T10:00:00Z"), endsAt: new Date("2027-01-03T11:00:00Z") }),
    ];
    for (const b of bad) {
      await expect(conn.db.insert(bookings).values(b)).rejects.toSatisfy((e) => pgCode(e) === "23514");
    }
  });

  it("a hold targets exactly one of table or zone, once per date", async () => {
    await conn.db.insert(tableHolds).values({ tableId: t1, date: "2026-12-31", reason: "NYE private party" });
    await expect(
      conn.db.insert(tableHolds).values({ tableId: t1, date: "2026-12-31", reason: "dup" }),
    ).rejects.toSatisfy((e) => pgCode(e) === "23505");
    await expect(
      conn.db.insert(tableHolds).values({ date: "2026-12-30", reason: "no target" }),
    ).rejects.toSatisfy((e) => pgCode(e) === "23514");
  });
});
