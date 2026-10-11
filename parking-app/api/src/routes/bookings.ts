import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { currentUser, requireRole } from "../auth.js";
import { tx, type Tx } from "../db.js";
import { HttpError, idemKey, IsoDate, parse, Plate, rupees, Uuid } from "../http.js";
import { financialYear, gstOn } from "../pricing.js";
import { promoFor, quoteFor, rateFor, spotsLeft, type VehicleKind } from "../services.js";

const driver = requireRole("driver");

/** Replays the stored response for a repeated Idempotency-Key; otherwise runs fn and stores its result. */
async function idempotent(deps: Deps, userId: string, key: string, route: string, fn: () => Promise<{ status: number; body: unknown }>) {
  const prev = await deps.db.query("SELECT status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND route = $3", [userId, key, route]);
  if (prev.rows[0]) return { status: prev.rows[0].status_code as number, body: prev.rows[0].response };
  const out = await fn();
  await deps.db.query("INSERT INTO idempotency_keys (user_id, key, route, response, status_code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    [userId, key, route, JSON.stringify(out.body), out.status]);
  return out;
}

async function createPayment(c: Tx, deps: Deps, p: { bookingId?: string; monthlyPassId?: string; purpose: string; amountPaise: number; meta?: object; receipt: string }) {
  const order = await deps.payments.createOrder(p.amountPaise, p.receipt);
  await c.query(
    `INSERT INTO payments (booking_id, monthly_pass_id, razorpay_order_id, amount_paise, purpose, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [p.bookingId ?? null, p.monthlyPassId ?? null, order.id, p.amountPaise, p.purpose, JSON.stringify(p.meta ?? {})]);
  return { id: order.id, amount: order.amountPaise, currency: order.currency, key_id: deps.payments.keyId };
}
export { createPayment };

const bookingView = `
  SELECT b.id, b.code, b.status, b.source, b.vehicle, lower(b.period) AS "from", upper(b.period) AS "to",
         b.base_paise, b.discount_paise, b.fee_paise, b.gst_paise, b.total_paise, b.promo_code,
         v.plate, l.id AS lot_id, l.name AS lot_name, l.code AS lot_code, u.phone
  FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id JOIN lots l ON l.id = b.lot_id JOIN users u ON u.id = b.user_id`;

export function bookingRoutes(app: FastifyInstance, deps: Deps) {
  const fee = deps.cfg.PLATFORM_FEE_PAISE;

  // DRV-04, DRV-05, DRV-06, DRV-09, GST-01
  app.post("/v1/bookings", { preHandler: driver, config: { rateLimit: { max: 10 * deps.cfg.RATE_LIMIT_SCALE, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = currentUser(req), key = idemKey(req);
    const b = parse(z.object({
      lot_id: Uuid, source: z.enum(["prebook", "park_now"]).default("prebook"),
      from: IsoDate.optional(), to: IsoDate.optional(), hours: z.number().int().min(1).max(24).optional(),
      vehicle_id: Uuid.optional(), plate: Plate.optional(), vehicle_kind: z.enum(["car", "bike", "ev_car", "suv"]).default("car"),
      promo: z.string().max(20).optional()
    }), req.body);
    const out = await idempotent(deps, user.sub, key, "POST /v1/bookings", async () => {
      let from: Date, to: Date;
      if (b.source === "park_now") {
        if (!b.hours) throw new HttpError(400, "invalid_request", "hours: choose how long you'll park.");
        from = new Date(Math.floor(Date.now() / 60_000) * 60_000); to = new Date(from.getTime() + b.hours * 3_600_000);
      } else {
        if (!b.from || !b.to) throw new HttpError(400, "invalid_request", "from and to are required for a pre-booking.");
        if (b.to <= b.from) throw new HttpError(400, "invalid_request", "Leaving time must be after arrival. Move it later.");
        if (b.from.getTime() < Date.now() - 5 * 60_000) throw new HttpError(400, "invalid_request", "Arrival time is in the past. Pick a later time or use Park now.");
        from = b.from; to = b.to;
      }
      if (!b.vehicle_id && !b.plate) throw new HttpError(400, "invalid_request", "Add your vehicle number.");
      return tx(deps.db, async c => {
        // vehicle: existing (must be the user's) or created from the plate
        let vehicleId = b.vehicle_id, kind = b.vehicle_kind as VehicleKind;
        if (vehicleId) {
          const v = await c.query("SELECT id, kind FROM vehicles WHERE id = $1 AND user_id = $2", [vehicleId, user.sub]);
          if (!v.rows[0]) throw new HttpError(404, "vehicle_not_found", "That vehicle isn't on your account.");
          kind = v.rows[0].kind;
        } else {
          const v = await c.query(
            `INSERT INTO vehicles (user_id, plate, kind) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, plate) DO UPDATE SET kind = EXCLUDED.kind RETURNING id`, [user.sub, b.plate, kind]);
          vehicleId = v.rows[0].id;
        }
        const { promo, error } = await promoFor(c, b.promo, user.sub, from);
        if (error) throw new HttpError(422, "promo_invalid", error);
        const q = await quoteFor(c, fee, b.lot_id, kind, from, to, promo);
        let bookingId: string;
        await c.query("SAVEPOINT book_bay"); // a refused hold aborts the statement; roll back to here to answer with alternatives
        try {
          const r = await c.query("SELECT book_bay($1,$2,$3,$4,tstzrange($5,$6),$7,$8,$9) AS id",
            [user.sub, b.lot_id, vehicleId, kind, from, to, q.basePaise, q.feePaise, q.gstPaise]);
          bookingId = r.rows[0].id;
        } catch (e) {
          const m = (e as Error).message;
          await c.query("ROLLBACK TO SAVEPOINT book_bay");
          if (m.includes("lot_full")) {
            const near = await c.query(
              `SELECT l2.id, l2.name, l2.code FROM lots l1 JOIN lots l2 ON l2.id <> l1.id AND l2.is_live AND l2.status = 'open'
               WHERE l1.id = $1 ORDER BY ST_Distance(l1.geo, l2.geo) LIMIT 3`, [b.lot_id]);
            throw new HttpError(409, "lot_full", "This lot just filled up. Try a nearby lot.", { alternatives: near.rows });
          }
          if (m.includes("lot_not_available")) throw new HttpError(404, "lot_not_found", "This lot isn't available.");
          throw e;
        }
        await c.query("UPDATE bookings SET discount_paise = $2, promo_code = $3, source = $4 WHERE id = $1",
          [bookingId, q.discountPaise, q.promoCode, b.source]);
        const booking = (await c.query(`${bookingView} WHERE b.id = $1`, [bookingId])).rows[0];
        const order = await createPayment(c, deps, { bookingId, purpose: "booking", amountPaise: q.totalPaise, receipt: booking.code });
        return { status: 201, body: { booking, quote: q, razorpay_order: order } };
      });
    });
    return reply.code(out.status).send(out.body);
  });

  // DRV-10, GST-02
  app.get("/v1/bookings", { preHandler: driver }, async (req) => {
    const user = currentUser(req);
    const { rows } = await deps.db.query(`${bookingView} WHERE b.user_id = $1 AND b.status <> 'pending_payment' ORDER BY lower(b.period) DESC LIMIT 100`, [user.sub]);
    return rows;
  });

  // DRV-11: one more hour at the lot rate + GST, if capacity allows.
  app.post("/v1/bookings/:id/extend", { preHandler: driver }, async (req, reply) => {
    const user = currentUser(req), key = idemKey(req);
    const { id } = parse(z.object({ id: Uuid }), req.params);
    const out = await idempotent(deps, user.sub, key, `POST /v1/bookings/${id}/extend`, () => tx(deps.db, async c => {
      const bk = (await c.query(`SELECT b.*, upper(b.period) AS ends FROM bookings b WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE`, [id, user.sub])).rows[0];
      if (!bk) throw new HttpError(404, "booking_not_found", "Booking not found.");
      if (!["confirmed", "checked_in"].includes(bk.status) || bk.ends <= new Date()) throw new HttpError(410, "ended", "This pass has ended. Book again to keep parking.");
      const newEnd = new Date(bk.ends.getTime() + 3_600_000);
      if (await spotsLeft(c, bk.lot_id, bk.vehicle, bk.ends, newEnd, bk.id) <= 0)
        throw new HttpError(409, "lot_full", `Can't extend: the lot is full after ${bk.ends.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}.`);
      const rate = (await rateFor(c, bk.lot_id, bk.vehicle, bk.ends)).hourly_paise;
      const amount = rate + gstOn(rate);
      const order = await createPayment(c, deps, { bookingId: id, purpose: "extend", amountPaise: amount, meta: { hours: 1, base_paise: rate, gst_paise: gstOn(rate) }, receipt: `${bk.code}-X` });
      return { status: 201, body: { booking_id: id, new_end: newEnd, amount_paise: amount, razorpay_order: order } };
    }));
    return reply.code(out.status).send(out.body);
  });

  // DRV-12: free cancellation until arrival; Park now passes can't be cancelled once paid.
  app.post("/v1/bookings/:id/cancel", { preHandler: driver }, async (req, reply) => {
    const user = currentUser(req), key = idemKey(req);
    const { id } = parse(z.object({ id: Uuid }), req.params);
    const out = await idempotent(deps, user.sub, key, `POST /v1/bookings/${id}/cancel`, () => tx(deps.db, async c => {
      const bk = (await c.query("SELECT b.*, lower(b.period) AS starts FROM bookings b WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE", [id, user.sub])).rows[0];
      if (!bk) throw new HttpError(404, "booking_not_found", "Booking not found.");
      if (bk.status !== "confirmed" || bk.source === "park_now" || bk.starts <= new Date())
        throw new HttpError(409, "cannot_cancel", "This pass has started, so it can't be cancelled.");
      const pays = (await c.query("SELECT * FROM payments WHERE booking_id = $1 AND status = 'captured' FOR UPDATE", [id])).rows;
      let refunded = 0;
      for (const p of pays) {
        const amt = p.amount_paise - p.refunded_paise;
        if (amt <= 0) continue;
        const r = await deps.payments.refund(p.razorpay_payment_id, amt);
        await c.query("INSERT INTO refunds (payment_id, amount_paise, razorpay_refund_id, reason, created_by) VALUES ($1,$2,$3,'driver_cancel',$4)", [p.id, amt, r.id, user.sub]);
        await c.query("UPDATE payments SET refunded_paise = amount_paise, status = 'refunded' WHERE id = $1", [p.id]);
        refunded += amt;
      }
      await c.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [id]);
      const phone = (await c.query("SELECT phone FROM users WHERE id = $1", [user.sub])).rows[0].phone;
      deps.notify.send({ event: "refund_issued", phone, data: { code: bk.code, amount: rupees(refunded) } });
      return { status: 200, body: { booking: { id, status: "cancelled" }, refund: { amount_paise: refunded, message: "Cancelled. Full refund in 3–5 working days." } } };
    }));
    return reply.code(out.status).send(out.body);
  });

  // Razorpay webhook: verify signature on the raw body, then process each event id once.
  app.post("/v1/webhooks/razorpay", { config: { rawBody: true } }, async (req, reply) => {
    const raw = (req as any).rawBody as string;
    if (!deps.payments.verifyWebhook(raw, req.headers["x-razorpay-signature"] as string | undefined))
      throw new HttpError(400, "bad_signature", "Invalid signature.");
    const eventId = String(req.headers["x-razorpay-event-id"] ?? "");
    if (!eventId) throw new HttpError(400, "missing_event_id", "Missing x-razorpay-event-id.");
    const evt = JSON.parse(raw);
    const result = await tx(deps.db, async c => {
      const first = await c.query("INSERT INTO webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
      if (!first.rowCount) return "duplicate";
      const pay = evt?.payload?.payment?.entity;
      if (!pay?.order_id) return "ignored";
      if (evt.event === "payment.captured") return onCaptured(c, deps, pay);
      if (evt.event === "payment.failed") return onFailed(c, pay);
      return "ignored";
    });
    return reply.code(200).send({ ok: true, result });
  });
}

async function onFailed(c: Tx, pay: { order_id: string }) {
  const p = (await c.query("UPDATE payments SET status = 'failed' WHERE razorpay_order_id = $1 AND status = 'created' RETURNING *", [pay.order_id])).rows[0];
  if (p?.purpose === "booking") await c.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'pending_payment'", [p.booking_id]);
  return "failed";
}

async function onCaptured(c: Tx, deps: Deps, pay: { id: string; order_id: string; amount: number; method?: string; fee?: number }) {
  const p = (await c.query("SELECT * FROM payments WHERE razorpay_order_id = $1 FOR UPDATE", [pay.order_id])).rows[0];
  if (!p) return "unknown_order";
  if (p.status === "captured") return "already_captured";
  if (pay.amount !== p.amount_paise) throw new HttpError(400, "amount_mismatch", `Captured ${pay.amount} != expected ${p.amount_paise}`);
  await c.query("UPDATE payments SET status = 'captured', razorpay_payment_id = $2, method = $3, gateway_fee_paise = $4 WHERE id = $1",
    [p.id, pay.id, pay.method ?? null, pay.fee ?? null]);

  let taxable = 0, gst = 0;
  if (p.purpose === "booking") {
    const b = (await c.query("UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = $1 RETURNING *", [p.booking_id])).rows[0];
    taxable = b.base_paise - b.discount_paise + b.fee_paise; gst = b.gst_paise;
    if (b.promo_code) await c.query("UPDATE promo_codes SET used_count = used_count + 1 WHERE code = $1", [b.promo_code]);
    const v = (await c.query(`SELECT b.code, l.name, l.code AS lot_code, lower(b.period) AS "from", upper(b.period) AS "to", u.phone
      FROM bookings b JOIN lots l ON l.id = b.lot_id JOIN users u ON u.id = b.user_id WHERE b.id = $1`, [b.id])).rows[0];
    deps.notify.send({ event: "pass_issued", phone: v.phone, data: v });
  } else if (p.purpose === "extend") {
    await c.query("UPDATE bookings SET period = tstzrange(lower(period), upper(period) + make_interval(hours => $2)) WHERE id = $1", [p.booking_id, p.meta.hours ?? 1]);
    taxable = p.meta.base_paise; gst = p.meta.gst_paise;
  } else if (p.purpose === "overstay") {
    taxable = p.meta.base_paise; gst = p.meta.gst_paise;
  } else if (p.purpose === "monthly") {
    await c.query("UPDATE monthly_passes SET status = 'active' WHERE id = $1 AND status IN ('approved','paused_unpaid')", [p.monthly_pass_id]);
    taxable = p.meta.base_paise; gst = p.meta.gst_paise;
  }
  // GST invoice: intra-state (Karnataka) split into CGST + SGST. Confirm place-of-supply rules with CA.
  const seq = (await c.query("SELECT nextval('invoice_seq') AS n")).rows[0].n;
  const number = `BL/${financialYear(new Date())}/${String(seq).padStart(6, "0")}`;
  const cgst = Math.floor(gst / 2);
  await c.query("INSERT INTO invoices (number, payment_id, taxable_paise, cgst_paise, sgst_paise) VALUES ($1,$2,$3,$4,$5)",
    [number, p.id, taxable, cgst, gst - cgst]);
  return "captured";
}
