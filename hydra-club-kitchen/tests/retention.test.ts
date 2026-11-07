import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRetention } from "../scripts/retention";
import { bookings, tables } from "../src/db/schema";
import { freshDb } from "./db-helpers";

let conn: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  conn = await freshDb();
});
afterAll(async () => conn?.sql.end());

describe("data retention (what /privacy promises)", () => {
  it("deletes bookings older than 12 months and rate-limit rows older than a day, keeps the rest", async () => {
    const [t] = await conn.db.select().from(tables).limit(1);
    const row = (ref: string, iso: string) => ({
      ref,
      tableId: t!.id,
      startsAt: new Date(iso),
      endsAt: new Date(new Date(iso).getTime() + 7_200_000),
      guests: 2,
      name: "Old Guest",
      phoneE164: "+919876543210",
    });
    await conn.db.insert(bookings).values([
      row("HYD-OLD1", "2025-10-01T15:00:00Z"), // night of 1 Oct 2025: > 12 months before 7 Nov 2026
      row("HYD-KEEP", "2025-12-01T15:00:00Z"), // within 12 months
    ]);
    await conn.db.execute(sql`insert into rate_limit_hits (key, at) values ('booking:ip:1.2.3.4', '2026-11-05T00:00:00Z'), ('booking:ip:5.6.7.8', '2026-11-07T10:00:00Z')`);

    const result = await runRetention(conn.db, new Date("2026-11-07T12:00:00Z"));
    expect(result).toEqual({ bookingsDeleted: 1, rateLimitRowsDeleted: 1 });
    const left = await conn.db.select({ ref: bookings.ref }).from(bookings);
    expect(left).toEqual([{ ref: "HYD-KEEP" }]);
    expect(await runRetention(conn.db, new Date("2026-11-07T12:00:00Z"))).toEqual({ bookingsDeleted: 0, rateLimitRowsDeleted: 0 });
  });
});
