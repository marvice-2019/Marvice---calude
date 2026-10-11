import { createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll } from "vitest";
import { buildApp, type Deps } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { fakePayments, notifier, storage } from "../src/providers.js";

const ADMIN_URL = process.env.TEST_PG_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const WEBHOOK_SECRET = "whsec_test_" + "x".repeat(20);

/** Fresh database (copied from the migrated template), app and fakes for one test file. */
export async function setup() {
  const name = "t_" + randomBytes(6).toString("hex");
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE bayline_test_tpl`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  const cfg = loadConfig({ NODE_ENV: "test", DATABASE_URL: url, JWT_SECRET: "j".repeat(40), RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    INTERNAL_TOKEN: "internal-token-123456", RATE_LIMIT_MAX: "100000", RATE_LIMIT_SCALE: "1000" } as NodeJS.ProcessEnv);
  const db = createPool(url);
  const otpBox = new Map<string, string>();
  const payments = fakePayments(cfg);
  const notify = notifier(cfg, { info: () => {}, warn: () => {} });
  const deps: Deps = { cfg, db, payments, otp: { async send(p, c) { otpBox.set(p, c); } }, notify, storage: storage(cfg) };
  const app = await buildApp(deps, { logger: false });

  afterAll(async () => {
    await app.close(); await db.end();
    const a = new pg.Client({ connectionString: ADMIN_URL }); await a.connect();
    await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await a.end();
  });

  async function login(phone: string, role?: "operator_staff" | "operator_admin" | "platform_admin") {
    await app.inject({ method: "POST", url: "/v1/auth/otp", payload: { phone } });
    const otp = otpBox.get("+91" + phone)!;
    let r = await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { phone, otp } });
    let body = r.json();
    if (role) {
      await db.query("UPDATE users SET role = $2 WHERE id = $1", [body.user.id, role]);
      await app.inject({ method: "POST", url: "/v1/auth/otp", payload: { phone } });
      r = await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { phone, otp: otpBox.get("+91" + phone)! } });
      body = r.json();
    }
    return { token: body.access as string, userId: body.user.id as string, refresh: body.refresh as string, h: { authorization: `Bearer ${body.access}` } };
  }

  /** Signed Razorpay-style webhook. */
  async function webhook(event: string, orderId: string, amount: number, eventId = "evt_" + randomBytes(6).toString("hex"), paymentId = "pay_" + randomBytes(6).toString("hex")) {
    const raw = JSON.stringify({ event, payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, method: "upi", fee: 300 } } } });
    const sig = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    return app.inject({ method: "POST", url: "/v1/webhooks/razorpay", payload: raw,
      headers: { "content-type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": eventId } });
  }

  /** Any signed webhook body (e.g. Route transfer events). */
  async function rawWebhook(body: object, eventId = "evt_" + randomBytes(6).toString("hex")) {
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    return app.inject({ method: "POST", url: "/v1/webhooks/razorpay", payload: raw,
      headers: { "content-type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": eventId } });
  }

  return { app, deps, db, payments, notify, otpBox, login, webhook, rawWebhook };
}

export type Ctx = Awaited<ReturnType<typeof setup>>;

/** Operator with two lots ~600 m apart near MG Road, rates, promos, and staff/admin logins. */
export async function seed(ctx: Ctx, opts: { capacity?: number } = {}) {
  const { db } = ctx;
  const op = (await db.query("INSERT INTO operators (legal_name, pan) VALUES ('Test Parking Pvt Ltd', 'ABCDE1234F') RETURNING id")).rows[0].id;
  const op2 = (await db.query("INSERT INTO operators (legal_name, pan) VALUES ('Other Parking LLP', 'PQRSX6789K') RETURNING id")).rows[0].id;
  const mk = async (operator: string, name: string, code: string, lat: number, lng: number, cap: number) =>
    (await db.query(
      `INSERT INTO lots (operator_id, name, address, city, geo, kind, capacity_car, capacity_bike, online_share, is_live, code)
       VALUES ($1,$2,'MG Road, Bengaluru','Bengaluru',ST_MakePoint($4,$3)::geography,'multilevel',$5,10,1,true,$6) RETURNING id`,
      [operator, name, lat, lng, cap, code])).rows[0].id as string;
  const lot = await mk(op, "MG Road Metro Multilevel", "BLR101", 12.9757, 77.6066, opts.capacity ?? 20);
  const lot2 = await mk(op, "Brigade Road Basement P1", "BLR102", 12.9716, 77.6070, 20);
  const lotOther = await mk(op2, "Other Operator Lot", "BLR103", 12.9740, 77.6100, 20);
  for (const id of [lot, lot2, lotOther]) {
    await db.query("INSERT INTO lot_rates (lot_id, vehicle, hourly_paise, monthly_paise, valid) VALUES ($1,'car',4000,420000,tstzrange('-infinity',NULL))", [id]);
    await db.query("INSERT INTO lot_rates (lot_id, vehicle, hourly_paise, valid) VALUES ($1,'bike',1500,tstzrange('-infinity',NULL))", [id]);
  }
  await db.query(`INSERT INTO promo_codes (code, percent_off, max_off_paise, first_booking_only, valid) VALUES ('FIRST50',50,10000,true,tstzrange('-infinity',NULL))`);
  await db.query(`INSERT INTO promo_codes (code, percent_off, max_off_paise, weekend_only, valid) VALUES ('WEEKEND20',20,20000,true,tstzrange('-infinity',NULL))`);
  const staff = await ctx.login("9000000001", "operator_staff");
  const opAdmin = await ctx.login("9000000002", "operator_admin");
  const otherStaff = await ctx.login("9000000003", "operator_staff");
  const platform = await ctx.login("9000000004", "platform_admin");
  await db.query("INSERT INTO operator_members (operator_id, user_id, role) VALUES ($1,$2,'operator_staff'),($1,$3,'operator_admin'),($4,$5,'operator_staff')",
    [op, staff.userId, opAdmin.userId, op2, otherStaff.userId]);
  return { op, op2, lot, lot2, lotOther, staff, opAdmin, otherStaff, platform };
}

/** A pre-booking starting `startInMin` from now for `hours`, paid via webhook. Returns the booking. */
export async function bookAndPay(ctx: Ctx, auth: { h: Record<string, string> }, lotId: string, startInMin = 60, hours = 3, extra: Record<string, unknown> = {}) {
  const from = new Date(Date.now() + startInMin * 60_000), to = new Date(from.getTime() + hours * 3_600_000);
  const r = await ctx.app.inject({ method: "POST", url: "/v1/bookings", headers: { ...auth.h, "idempotency-key": "k-" + randomBytes(6).toString("hex") },
    payload: { lot_id: lotId, from: from.toISOString(), to: to.toISOString(), plate: "KA01AB1234", ...extra } });
  if (r.statusCode !== 201) throw new Error(`booking failed ${r.statusCode} ${r.body}`);
  const body = r.json();
  const w = await ctx.webhook("payment.captured", body.razorpay_order.id, body.razorpay_order.amount);
  if (w.statusCode !== 200) throw new Error(`webhook failed ${w.body}`);
  return body;
}

export const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
export const idem = () => ({ "idempotency-key": "k-" + randomBytes(6).toString("hex") });
