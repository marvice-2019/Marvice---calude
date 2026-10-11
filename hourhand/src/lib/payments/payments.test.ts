// Booking payments: the host's own Razorpay keys (sealed, bound to their owner) and the 0006 booking constraints,
// against real Postgres (only with TEST_DATABASE_URL; uses its own database <name>_pay, dropped and recreated each run).
import { createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../../scripts/migrate";
import { seed } from "../../../scripts/seed";
import { BillingApiError } from "../billing/providers";
import { createPgStore } from "../data/pg-store";
import type { User } from "../data/types";
import { disconnectRazorpay, keyPairAuth, loadHostRazorpay, maskKeyId, razorpayVerifier, RazorpayKeyError, saveRazorpayKeys, type HostRazorpayAuth } from "./host-razorpay";

const KEY_ID = "rzp_test_AbCdEfGh1234";
const KEY_SECRET = "s3cr3tValueThatMustNotLeak";
const ok = async () => {};

describe("Razorpay key checks (no database)", () => {
  it("verifies Checkout payment signatures with the host's key", () => {
    const sign = (key: string, text: string) => createHmac("sha256", key).update(text).digest("hex");
    const auth = keyPairAuth("rzp_test_abcdefgh", "host-key");
    const good = sign("host-key", "order_1|pay_1");
    expect(auth.verifyPaymentSignature("order_1", "pay_1", good)).toBe(true);
    expect(auth.verifyPaymentSignature("order_1", "pay_1", sign("other-key", "order_1|pay_1"))).toBe(false); // wrong key
    expect(auth.verifyPaymentSignature("order_2", "pay_1", good)).toBe(false); // tampered order
    expect(auth.verifyPaymentSignature("order_1", "pay_2", good)).toBe(false); // tampered payment
    expect(auth.verifyPaymentSignature("order_1", "pay_1", "zz" + good.slice(2))).toBe(false); // bad hex
    expect(auth.verifyPaymentSignature("order_1", "pay_1", good.slice(0, 62))).toBe(false); // wrong length
  });

  it("verifier sends Basic auth to /v1/orders and classifies a 401", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    const auth: HostRazorpayAuth = { keyId: KEY_ID, headers: () => ({ authorization: "Basic x" }), verifyPaymentSignature: () => false };
    const err = await razorpayVerifier("https://rp.fake/", f)(auth).catch((e) => e);
    expect(err).toBeInstanceOf(BillingApiError);
    expect(err.status).toBe(401);
    expect(seen[0]).toEqual({ url: "https://rp.fake/v1/orders?count=1", headers: { authorization: "Basic x" } });
  });

  it("masks the key id", () => {
    expect(maskKeyId(KEY_ID)).toBe("rzp_test_••••1234");
  });
});

const BASE = process.env.TEST_DATABASE_URL;

describe.skipIf(!BASE)("booking payments (TEST_DATABASE_URL)", () => {
  let pool: pg.Pool;
  let priya: User;
  let arun: User;
  const key = randomBytes(32);
  const row = async (userId: string) => (await pool.query("select * from integrations where user_id = $1 and provider = 'razorpay'", [userId])).rows[0];

  beforeAll(async () => {
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_pay`;
    if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`TEST_DATABASE_URL must name a test database, got "${name}"`);
    u.pathname = `/${name}`;
    const admin = new URL(BASE!);
    admin.pathname = "/postgres";
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      await c.query(`drop database if exists ${name} with (force)`);
      await c.query(`create database ${name}`);
    } finally {
      await c.end();
    }
    await migrate(u.toString());
    await seed(u.toString());
    pool = new pg.Pool({ connectionString: u.toString() });
    const store = createPgStore(pool);
    priya = (await store.getUserBySlug("priya"))!;
    arun = (await store.getUserBySlug("arun"))!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("host Razorpay keys", () => {
    beforeEach(async () => {
      await pool.query("delete from integrations");
    });

    it("rejects malformed key ids and secrets before calling Razorpay", async () => {
      let called = 0;
      const verify = async () => { called++; };
      for (const [id, s] of [["rzp_prod_AbCdEfGh12", "x"], ["rzp_test_short", "x"], ["key_AbCdEfGh1234", "x"], [KEY_ID, ""], [KEY_ID, "x".repeat(129)]]) {
        await expect(saveRazorpayKeys(pool, key, priya.id, id, s, verify)).rejects.toMatchObject({ code: "format" });
      }
      expect(called).toBe(0);
      expect(await row(priya.id)).toBeUndefined();
    });

    it("a 401 from Razorpay is rejected and nothing is stored", async () => {
      const verify = async () => { throw new BillingApiError("Razorpay 401", 401, false); };
      const err = await saveRazorpayKeys(pool, key, priya.id, KEY_ID, KEY_SECRET, verify).catch((e) => e);
      expect(err).toBeInstanceOf(RazorpayKeyError);
      expect(err.code).toBe("rejected");
      expect(await row(priya.id)).toBeUndefined();
    });

    it("stores the pair sealed, with the key id and mode readable", async () => {
      let checked: HostRazorpayAuth | undefined;
      expect(await saveRazorpayKeys(pool, key, priya.id, KEY_ID, KEY_SECRET, async (a) => { checked = a; })).toEqual({ mode: "test" });
      expect(checked!.headers().authorization).toBe(`Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`);
      const r = await row(priya.id);
      expect(r).toMatchObject({ public_id: KEY_ID, mode: "test", status: "ok" });
      expect(r.credentials_encrypted.toString("latin1")).not.toContain(KEY_SECRET);
      expect(r.credentials_encrypted.toString("latin1")).not.toContain(KEY_ID);

      const loaded = await loadHostRazorpay(pool, key, priya.id);
      expect(loaded).toMatchObject({ keyId: KEY_ID, mode: "test" });
      expect(loaded!.headers()).toEqual(checked!.headers());

      await saveRazorpayKeys(pool, key, priya.id, "rzp_live_ZyXwVuTs9876", KEY_SECRET, ok);
      expect(await row(priya.id)).toMatchObject({ public_id: "rzp_live_ZyXwVuTs9876", mode: "live" });
    });

    it("a sealed pair copied to another host can't be opened", async () => {
      await saveRazorpayKeys(pool, key, priya.id, KEY_ID, KEY_SECRET, ok);
      await pool.query(
        `insert into integrations (user_id, provider, credentials_encrypted, public_id, mode)
         select $1, provider, credentials_encrypted, public_id, mode from integrations where user_id = $2`, [arun.id, priya.id]);
      await expect(loadHostRazorpay(pool, key, arun.id)).rejects.toThrow();
    });

    it("disconnect removes only the host's own row", async () => {
      await saveRazorpayKeys(pool, key, priya.id, KEY_ID, KEY_SECRET, ok);
      expect(await loadHostRazorpay(pool, key, arun.id)).toBeNull();
      await disconnectRazorpay(pool, arun.id);
      expect(await loadHostRazorpay(pool, key, priya.id)).not.toBeNull();
      await disconnectRazorpay(pool, priya.id);
      expect(await loadHostRazorpay(pool, key, priya.id)).toBeNull();
    });
  });

  describe("0006 booking constraints", () => {
    let eventTypeId: string;
    let n = 0;
    const book = (status: string, start: string, hold: string | null = "2031-01-01T00:00:00Z") => {
      const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
      return pool.query(
        `insert into bookings (event_type_id, host_id, start_at, end_at, buffered_start, buffered_end, status, idempotency_key, hold_expires_at, cancelled_at)
         values ($1, $2, $3, $4, $3, $4, $5, $6, $7, $8)`,
        [eventTypeId, priya.id, start, end, status, `pay-test-${++n}`, status === "pending_payment" ? hold : null, status === "cancelled" ? start : null]);
    };

    beforeAll(async () => {
      eventTypeId = (await pool.query("select id from event_types where user_id = $1 limit 1", [priya.id])).rows[0].id;
    });
    beforeEach(async () => {
      await pool.query("delete from bookings where idempotency_key like 'pay-test-%'");
    });

    it("two overlapping held bookings for one host can't both exist", async () => {
      await book("pending_payment", "2030-03-01T10:00:00Z");
      await expect(book("pending_payment", "2030-03-01T10:15:00Z")).rejects.toThrow(/no_double_booking/);
    });

    it("a held booking blocks a confirmed one and the other way round", async () => {
      await book("pending_payment", "2030-03-02T10:00:00Z");
      await expect(book("confirmed", "2030-03-02T10:15:00Z")).rejects.toThrow(/no_double_booking/);
      await book("confirmed", "2030-03-03T10:00:00Z");
      await expect(book("pending_payment", "2030-03-03T10:15:00Z")).rejects.toThrow(/no_double_booking/);
    });

    it("a cancelled booking doesn't block a hold", async () => {
      await book("cancelled", "2030-03-04T10:00:00Z");
      await book("pending_payment", "2030-03-04T10:00:00Z");
    });

    it("a hold needs an expiry, and only a hold has one", async () => {
      await expect(book("pending_payment", "2030-03-05T10:00:00Z", null)).rejects.toThrow(/bookings_hold_check/);
      await expect(pool.query(
        `insert into bookings (event_type_id, host_id, start_at, end_at, buffered_start, buffered_end, status, idempotency_key, hold_expires_at)
         values ($1, $2, '2030-03-06T10:00:00Z', '2030-03-06T10:30:00Z', '2030-03-06T10:00:00Z', '2030-03-06T10:30:00Z', 'confirmed', 'pay-test-x', now())`,
        [eventTypeId, priya.id])).rejects.toThrow(/bookings_hold_check/);
    });
  });
});
