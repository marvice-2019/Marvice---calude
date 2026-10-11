import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { currentUser, requireRole } from "../auth.js";
import { tx } from "../db.js";
import { HttpError, idemKey, parse, rupees, Uuid } from "../http.js";
import { gstOn } from "../pricing.js";
import { assertLotMember, audit, rateFor } from "../services.js";
import { createPayment } from "./bookings.js";

/** 'YYYY-MM' of a date in India time. */
export const istMonth = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7);
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).getUTCDate();

export function monthlyRoutes(app: FastifyInstance, deps: Deps) {
  // MON-01
  app.post("/v1/monthly-passes", { preHandler: requireRole("driver") }, async (req, reply) => {
    const u = currentUser(req);
    const b = parse(z.object({ lot_id: Uuid, vehicle_id: Uuid, starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.body);
    const v = await deps.db.query("SELECT kind FROM vehicles WHERE id = $1 AND user_id = $2", [b.vehicle_id, u.sub]);
    if (!v.rows[0]) throw new HttpError(404, "vehicle_not_found", "That vehicle isn't on your account.");
    const rate = await rateFor(deps.db, b.lot_id, v.rows[0].kind, new Date(b.starts_on + "T00:00:00+05:30")).catch(() => null);
    if (!rate?.monthly_paise) throw new HttpError(409, "no_monthly", "This lot doesn't offer monthly passes.");
    const r = await deps.db.query(
      `INSERT INTO monthly_passes (user_id, lot_id, vehicle_id, starts_on, price_paise) VALUES ($1,$2,$3,$4,$5) RETURNING id, status, starts_on, price_paise`,
      [u.sub, b.lot_id, b.vehicle_id, b.starts_on, rate.monthly_paise]);
    return reply.code(201).send({ pass: r.rows[0], message: "Request sent. The operator replies within one working day." });
  });

  // MON-02: operator approves and assigns a bay; driver gets a payment link for month 1.
  app.post("/v1/ops/monthly-passes/:id/approve", { preHandler: requireRole("operator_admin") }, async (req, reply) => {
    const u = currentUser(req); idemKey(req);
    const { id } = parse(z.object({ id: Uuid }), req.params);
    const { bay_label } = parse(z.object({ bay_label: z.string().min(1).max(20) }), req.body);
    const out = await tx(deps.db, async c => {
      const p = (await c.query("SELECT mp.*, u.phone FROM monthly_passes mp JOIN users u ON u.id = mp.user_id WHERE mp.id = $1 FOR UPDATE", [id])).rows[0];
      if (!p) throw new HttpError(404, "not_found", "Monthly pass not found.");
      await assertLotMember(c, u.sub, p.lot_id, ["operator_admin"]);
      if (p.status !== "requested") throw new HttpError(409, "not_requested", "This request was already handled.");
      await c.query("UPDATE monthly_passes SET status = 'approved', bay_label = $2 WHERE id = $1", [id, bay_label]);
      const month = istMonth(new Date(p.starts_on.getTime() + 12 * 3_600_000));
      const gst = gstOn(p.price_paise);
      const order = await createPayment(c, deps, { monthlyPassId: id, purpose: "monthly", amountPaise: p.price_paise + gst, meta: { month, base_paise: p.price_paise, gst_paise: gst }, receipt: `MP-${id.slice(0, 8)}-${month}` });
      const payment_link = `${deps.cfg.WEB_ORIGIN}/pay/${order.id}`;
      await audit(c, u.sub, "approve", "monthly_pass", id, { status: "requested" }, { status: "approved", bay_label });
      deps.notify.send({ event: "monthly_approved", phone: p.phone, data: { bay: bay_label, amount: rupees(p.price_paise + gst), link: payment_link } });
      return { pass: { id, status: "approved", bay_label }, payment_link, razorpay_order: order };
    });
    return reply.code(200).send(out);
  });

  // MON-03 job, called daily by n8n cron with the internal token.
  app.post("/v1/internal/jobs/monthly-billing", async (req) => {
    if (req.headers["x-internal-token"] !== deps.cfg.INTERNAL_TOKEN) throw new HttpError(401, "unauthenticated", "Bad internal token.");
    const { now } = parse(z.object({ now: z.string().datetime({ offset: true }).optional() }), req.body ?? {});
    return runMonthlyBilling(deps, now ? new Date(now) : new Date());
  });
}

/** Reminders on the 3rd and 5th; pause passes still unpaid after the 7th. Returns what it did. */
export async function runMonthlyBilling(deps: Deps, now: Date) {
  const month = istMonth(now), day = istDay(now);
  const unpaid = (await deps.db.query(
    `SELECT mp.id, mp.price_paise, u.phone, l.name FROM monthly_passes mp
     JOIN users u ON u.id = mp.user_id JOIN lots l ON l.id = mp.lot_id
     WHERE mp.status = 'active' AND mp.starts_on < date_trunc('month', $1::timestamptz AT TIME ZONE 'Asia/Kolkata')
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.monthly_pass_id = mp.id AND p.purpose = 'monthly'
                       AND p.status = 'captured' AND p.meta->>'month' = $2)`, [now, month])).rows;
  const done = { reminded: 0, paused: 0 };
  for (const p of unpaid) {
    const amount = rupees(p.price_paise + gstOn(p.price_paise));
    if (day === 3 || day === 5) { deps.notify.send({ event: "monthly_due", phone: p.phone, data: { lot: p.name, amount, month } }); done.reminded++; }
    if (day > 7) {
      await deps.db.query("UPDATE monthly_passes SET status = 'paused_unpaid' WHERE id = $1", [p.id]);
      deps.notify.send({ event: "monthly_paused", phone: p.phone, data: { lot: p.name, amount } }); done.paused++;
    }
  }
  return done;
}
