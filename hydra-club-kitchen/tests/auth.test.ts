import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticate, changePassword, ensureOwner, LOGIN_LIMITS, loadSessionUser } from "../src/auth/core";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { can, PERMISSIONS, ROLES } from "../src/auth/roles";
import { auditLog, users } from "../src/db/schema";
import { isSameOrigin } from "../src/lib/origin";
import { clientIp, consume } from "../src/lib/rate-limit";
import { freshDb } from "./db-helpers";

let conn: Awaited<ReturnType<typeof freshDb>>;
const OWNER_EMAIL = "owner@hydra.test";
const INITIAL = "initial-secret-123";

beforeAll(async () => {
  conn = await freshDb();
});
afterAll(async () => conn?.sql.end());
beforeEach(async () => {
  await conn.db.execute(sql`truncate rate_limit_hits, audit_log`);
});

describe("passwords (argon2id)", () => {
  it("verifies the right password, rejects the wrong one and malformed hashes", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse battery")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("roles", () => {
  it("only the owner manages users; hosts can work bookings but not export, holds, content or settings", () => {
    expect(ROLES.filter((r) => can(r, "users:manage"))).toEqual(["owner"]);
    expect(can("host", "bookings:write")).toBe(true);
    for (const p of ["bookings:export", "holds:write", "content:write", "settings:write", "audit:read"] as const) {
      expect(can("host", p)).toBe(false);
      expect(can("manager", p)).toBe(true);
    }
    // The owner can do everything.
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) expect(can("owner", p)).toBe(true);
  });
});

describe("owner bootstrap", () => {
  it("skips without env, creates the owner once with a forced password change, then never again", async () => {
    expect(await ensureOwner(conn.db, {})).toBe("skipped");
    expect(await ensureOwner(conn.db, { ADMIN_SEED_EMAIL: " Owner@Hydra.TEST ", ADMIN_SEED_PASSWORD: INITIAL })).toBe(
      "created",
    );
    expect(await ensureOwner(conn.db, { ADMIN_SEED_EMAIL: "other@hydra.test", ADMIN_SEED_PASSWORD: INITIAL })).toBe(
      "exists",
    );
    const all = await conn.db.select().from(users);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ email: OWNER_EMAIL, role: "owner", mustChangePassword: true });
  });

  it("refuses a weak seed password", async () => {
    await conn.sql.end();
    conn = await freshDb();
    await expect(ensureOwner(conn.db, { ADMIN_SEED_EMAIL: "a@b.co", ADMIN_SEED_PASSWORD: "short" })).rejects.toThrow();
    expect(await conn.db.select().from(users)).toHaveLength(0);
    expect(await ensureOwner(conn.db, { ADMIN_SEED_EMAIL: OWNER_EMAIL, ADMIN_SEED_PASSWORD: INITIAL })).toBe("created");
  });
});

describe("authenticate", () => {
  it("signs in with the right password (email case-insensitive), records last login and audits it", async () => {
    const r = await authenticate(conn.db, { email: "OWNER@hydra.test", password: INITIAL }, "1.1.1.1");
    expect(r).toMatchObject({ ok: true, user: { email: OWNER_EMAIL, role: "owner", mustChangePassword: true } });
    const [u] = await conn.db.select().from(users).where(eq(users.email, OWNER_EMAIL));
    expect(u!.lastLoginAt).not.toBeNull();
    const actions = (await conn.db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toContain("auth.login");
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    expect(await authenticate(conn.db, { email: OWNER_EMAIL, password: "nope" }, "1.1.1.2")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await authenticate(conn.db, { email: "ghost@hydra.test", password: "nope" }, "1.1.1.2")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await authenticate(conn.db, { email: "not-an-email", password: "x" }, "1.1.1.2")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it(`locks an email out after ${LOGIN_LIMITS.perEmail.limit} attempts, even with the right password`, async () => {
    for (let i = 0; i < LOGIN_LIMITS.perEmail.limit; i++) {
      await authenticate(conn.db, { email: OWNER_EMAIL, password: "guess" }, `10.0.0.${i}`);
    }
    expect(await authenticate(conn.db, { email: OWNER_EMAIL, password: INITIAL }, "10.0.1.1")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
  });
});

describe("rate limiter", () => {
  it("lets exactly `limit` of 20 concurrent hits through", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => consume(conn.db, "test:burst", 5, 3600)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const blocked = results.find((r) => !r.ok);
    expect(blocked && !blocked.ok && blocked.retryAfterSec).toBeGreaterThan(3500);
  });

  it("slides: hits older than the window stop counting", async () => {
    await conn.db.execute(
      sql`insert into rate_limit_hits (key, at) select 'test:slide', now() - interval '2 hours' from generate_series(1,5)`,
    );
    expect(await consume(conn.db, "test:slide", 5, 3600)).toEqual({ ok: true });
  });

  it("reads the proxy's client IP, not a spoofed left-most X-Forwarded-For entry", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("sessions and password change", () => {
  it("rejects a session for a deleted user and reads the role fresh from the DB", async () => {
    const [host] = await conn.db
      .insert(users)
      .values({ email: "host@hydra.test", name: "Host", passwordHash: await hashPassword(INITIAL), role: "host" })
      .returning();
    const now = Date.now();
    expect((await loadSessionUser(conn.db, host!.id, now))?.role).toBe("host");
    await conn.db.update(users).set({ role: "manager" }).where(eq(users.id, host!.id));
    expect((await loadSessionUser(conn.db, host!.id, now))?.role).toBe("manager");
    await conn.db.delete(users).where(eq(users.id, host!.id));
    expect(await loadSessionUser(conn.db, host!.id, now)).toBeNull();
  });

  it("validates the new password, then clears the forced change and kills older sessions", async () => {
    const [owner] = await conn.db.select().from(users).where(eq(users.email, OWNER_EMAIL));
    const id = owner!.id;
    const before = Date.now() - 5000;

    expect(await changePassword(conn.db, id, { current: "wrong", next: "brand-new-secret-1", confirm: "brand-new-secret-1" })).toEqual({
      ok: false,
      errors: { current: "Current password is wrong." },
    });
    const short = await changePassword(conn.db, id, { current: INITIAL, next: "short", confirm: "short" });
    expect(short.ok).toBe(false);
    const mismatch = await changePassword(conn.db, id, { current: INITIAL, next: "brand-new-secret-1", confirm: "brand-new-secret-2" });
    expect(!mismatch.ok && mismatch.errors.confirm).toBeTruthy();
    const same = await changePassword(conn.db, id, { current: INITIAL, next: INITIAL, confirm: INITIAL });
    expect(!same.ok && same.errors.next).toBeTruthy();

    expect(await changePassword(conn.db, id, { current: INITIAL, next: "brand-new-secret-1", confirm: "brand-new-secret-1" })).toEqual({ ok: true });
    const [after] = await conn.db.select().from(users).where(eq(users.id, id));
    expect(after!.mustChangePassword).toBe(false);
    expect(await loadSessionUser(conn.db, id, before)).toBeNull(); // session from before the change
    // Regression: a session signed in moments before the change, within the same second, must die too.
    const changedAt = after!.passwordChangedAt!.getTime();
    expect(await loadSessionUser(conn.db, id, changedAt - 1)).toBeNull();
    expect(await loadSessionUser(conn.db, id, Math.floor(changedAt / 1000) * 1000)).toBeNull();
    expect(await loadSessionUser(conn.db, id, changedAt + 1)).not.toBeNull();
    expect((await authenticate(conn.db, { email: OWNER_EMAIL, password: "brand-new-secret-1" }, "9.9.9.9")).ok).toBe(true);
    expect((await authenticate(conn.db, { email: OWNER_EMAIL, password: INITIAL }, "9.9.9.9")).ok).toBe(false);
  });
});

describe("same-origin check for admin mutations", () => {
  const site = "https://hydraclub.in";
  it("accepts the site origin, rejects others and a missing Origin", () => {
    expect(isSameOrigin(new Headers({ origin: "https://hydraclub.in" }), site)).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example" }), site)).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "null" }), site)).toBe(false);
    expect(isSameOrigin(new Headers(), site)).toBe(false);
  });
  it("falls back to the Host header when the site URL is not configured", () => {
    expect(isSameOrigin(new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }), undefined)).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "http://evil:3000", host: "localhost:3000" }), undefined)).toBe(false);
  });
});
