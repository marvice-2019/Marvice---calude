import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTodayView } from "../src/admin/today";
import { createUser, deleteUser, listUsers, resetPassword, setRole } from "../src/admin/users";
import { authenticate, ensureOwner, loadSessionUser } from "../src/auth/core";
import { auditLog, bookings, tableHolds, tables, users } from "../src/db/schema";
import { freshDb } from "./db-helpers";

let conn: Awaited<ReturnType<typeof freshDb>>;
let ownerId: string;
const TEMP = "temporary-pass-123";

beforeAll(async () => {
  conn = await freshDb();
  await ensureOwner(conn.db, { ADMIN_SEED_EMAIL: "owner@hydra.test", ADMIN_SEED_PASSWORD: "owner-initial-123" });
  ownerId = (await conn.db.select().from(users))[0]!.id;
});
afterAll(async () => conn?.sql.end());

describe("staff accounts", () => {
  beforeEach(async () => {
    await conn.db.delete(users).where(sql`${users.id} <> ${ownerId}`);
    await conn.db.execute(sql`truncate audit_log, rate_limit_hits`);
  });

  it("creates a user who must change the temporary password, and audits it without secrets", async () => {
    const r = await createUser(conn.db, ownerId, { name: "Ravi", email: "Ravi@Hydra.test", role: "host", tempPassword: TEMP });
    expect(r).toMatchObject({ ok: true, user: { email: "ravi@hydra.test", role: "host", mustChangePassword: true } });
    expect(await createUser(conn.db, ownerId, { name: "Dup", email: "ravi@hydra.test", role: "host", tempPassword: TEMP })).toMatchObject({ ok: false, status: 409 });
    expect(await createUser(conn.db, ownerId, { name: "Weak", email: "w@hydra.test", role: "host", tempPassword: "short" })).toMatchObject({ ok: false, status: 400 });
    const audit = await conn.db.select().from(auditLog);
    expect(audit.map((a) => a.action)).toEqual(["user.create"]);
    expect(JSON.stringify(audit)).not.toContain(TEMP);
    expect(JSON.stringify(audit)).not.toContain("$argon2");
    expect((await authenticate(conn.db, { email: "ravi@hydra.test", password: TEMP }, "1.1.1.1")).ok).toBe(true);
  });

  it("changes roles, but never your own and never the last owner", async () => {
    const r = await createUser(conn.db, ownerId, { name: "Mia", email: "mia@hydra.test", role: "host", tempPassword: TEMP });
    const miaId = r.ok ? r.user.id : "";
    expect(await setRole(conn.db, ownerId, { id: miaId, role: "manager" })).toEqual({ ok: true });
    expect((await listUsers(conn.db)).find((u) => u.id === miaId)?.role).toBe("manager");
    expect(await setRole(conn.db, ownerId, { id: ownerId, role: "host" })).toMatchObject({ ok: false, message: "You can't change your own role." });
    // Mia (made owner) tries to demote the original owner: allowed while two owners exist, refused for the last one.
    await setRole(conn.db, ownerId, { id: miaId, role: "owner" });
    expect(await setRole(conn.db, miaId, { id: ownerId, role: "manager" })).toEqual({ ok: true });
    expect(await setRole(conn.db, ownerId, { id: miaId, role: "host" })).toMatchObject({ ok: false, message: "Hydra needs at least one owner." });
    await setRole(conn.db, miaId, { id: ownerId, role: "owner" });
  });

  it("a password reset forces a change and ends every existing session", async () => {
    const r = await createUser(conn.db, ownerId, { name: "Kiran", email: "kiran@hydra.test", role: "host", tempPassword: TEMP });
    const id = r.ok ? r.user.id : "";
    await conn.db.update(users).set({ mustChangePassword: false }).where(eq(users.id, id));
    const before = Date.now() - 1000;
    expect(await loadSessionUser(conn.db, id, before)).not.toBeNull();
    expect(await resetPassword(conn.db, ownerId, { id, tempPassword: "another-temp-456" })).toEqual({ ok: true });
    expect(await loadSessionUser(conn.db, id, before)).toBeNull();
    expect((await listUsers(conn.db)).find((u) => u.id === id)?.mustChangePassword).toBe(true);
  });

  it("deletes users, but not yourself and not the last owner", async () => {
    const r = await createUser(conn.db, ownerId, { name: "Temp", email: "temp@hydra.test", role: "host", tempPassword: TEMP });
    expect(await deleteUser(conn.db, ownerId, ownerId)).toMatchObject({ ok: false, message: "You can't delete your own account." });
    expect(await deleteUser(conn.db, ownerId, r.ok ? r.user.id : "")).toEqual({ ok: true });
    expect((await listUsers(conn.db)).map((u) => u.email)).toEqual(["owner@hydra.test"]);
  });
});

describe("Today view", () => {
  it("groups tonight's arrivals by IST hour across midnight and shows each table's state now", async () => {
    await conn.db.execute(sql`truncate bookings, table_holds`);
    const ids = Object.fromEntries((await conn.db.select().from(tables)).map((t) => [t.code, t.id]));
    const mk = (ref: string, table: string, iso: string, status: "pending" | "confirmed" | "cancelled" = "confirmed", guests = 2) => ({
      ref,
      tableId: ids[table]!,
      startsAt: new Date(iso),
      endsAt: new Date(new Date(iso).getTime() + 2 * 3_600_000),
      guests,
      name: ref,
      phoneE164: "+919876543210",
      status,
    });
    await conn.db.insert(bookings).values([
      mk("HYD-AAA1", "T1", "2026-12-04T14:30:00Z", "confirmed", 4), // 20:00 IST, seated at 21:00 IST
      mk("HYD-AAA2", "T2", "2026-12-04T17:30:00Z", "pending", 3), // 23:00 IST
      mk("HYD-AAA3", "T3", "2026-12-04T18:45:00Z", "confirmed", 2), // 00:15 IST, still the 4th's night
      mk("HYD-AAA4", "T4", "2026-12-04T16:30:00Z", "cancelled", 6), // 22:00 IST, cancelled
    ]);
    await conn.db.insert(tableHolds).values({ zoneId: null, tableId: ids["T5"]!, date: "2026-12-04", reason: "Band" });
    const view = await getTodayView(conn.db, new Date("2026-12-04T15:30:00Z")); // 21:00 IST
    expect(view.date).toBe("2026-12-04");
    expect(view.hours.map((h) => h.hour)).toEqual(["20:00", "22:00", "23:00", "00:00"]);
    expect(view.counts).toEqual({ bookings: 3, covers: 9, seatedNow: 1 });
    const state = Object.fromEntries(view.tables.map((t) => [t.code, t.state]));
    expect(state).toMatchObject({ T1: "seated", T2: "booked", T3: "booked", T4: "free", T5: "held", T6: "free" });
    expect(view.tables.find((t) => t.code === "T2")?.next).toBe("23:00");
  });
});
