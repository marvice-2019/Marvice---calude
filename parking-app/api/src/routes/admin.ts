import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { currentUser, requireRole } from "../auth.js";
import { tx } from "../db.js";
import { HttpError, idemKey, IsoDate, parse, Uuid } from "../http.js";
import { audit } from "../services.js";
import { computePayouts } from "./ops.js";

const admin = requireRole("platform_admin");

export function adminRoutes(app: FastifyInstance, deps: Deps) {
  // ADM-01
  app.post("/v1/admin/operators", { preHandler: admin }, async (req, reply) => {
    const u = currentUser(req);
    const b = parse(z.object({
      legal_name: z.string().min(2).max(200),
      pan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN must look like ABCDE1234F."),
      gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN must be 15 characters, like 29ABCDE1234F1Z5.").optional(),
      commission_bps: z.number().int().min(0).max(5000).optional()
    }), req.body);
    const op = await tx(deps.db, async c => {
      const r = (await c.query("INSERT INTO operators (legal_name, pan, gstin, commission_bps) VALUES ($1,$2,$3,COALESCE($4,1500)) RETURNING *",
        [b.legal_name, b.pan, b.gstin ?? null, b.commission_bps ?? null])).rows[0];
      await audit(c, u.sub, "create", "operator", r.id, null, r);
      return r;
    });
    return reply.code(201).send({ operator: op });
  });

  // ADM-01: lot gets the next BLRnnn code; goes live only when is_live is true.
  app.post("/v1/admin/lots", { preHandler: admin }, async (req, reply) => {
    const u = currentUser(req);
    const b = parse(z.object({
      operator_id: Uuid, name: z.string().min(2).max(120), address: z.string().min(5), city: z.string().default("Bengaluru"),
      lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
      kind: z.enum(["multilevel", "basement", "surface", "covered_deck", "owner_listed"]),
      capacity_car: z.number().int().min(0), capacity_bike: z.number().int().min(0).default(0), online_share: z.number().min(0).max(1).default(0.5),
      covered: z.boolean().default(false), ev_chargers: z.number().int().min(0).default(0), open_24h: z.boolean().default(false),
      is_live: z.boolean().default(false), code: z.string().regex(/^[A-Z]{3}\d{3,4}$/).optional(),
      rates: z.array(z.object({ vehicle: z.enum(["car", "bike"]), hourly_paise: z.number().int().min(100), daily_cap_paise: z.number().int().positive().nullable().optional(),
        monthly_paise: z.number().int().positive().nullable().optional() })).default([])
    }), req.body);
    try {
      const lot = await tx(deps.db, async c => {
        const code = b.code ?? (await c.query(
          `SELECT 'BLR' || (COALESCE(max(substring(code from 4)::int), 100) + 1) AS code FROM lots WHERE code LIKE 'BLR%'`)).rows[0].code;
        const r = (await c.query(
          `INSERT INTO lots (operator_id, name, address, city, geo, kind, capacity_car, capacity_bike, online_share, covered, ev_chargers, open_24h, is_live, code)
           VALUES ($1,$2,$3,$4, ST_MakePoint($6,$5)::geography, $7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, name, code, is_live`,
          [b.operator_id, b.name, b.address, b.city, b.lat, b.lng, b.kind, b.capacity_car, b.capacity_bike, b.online_share, b.covered, b.ev_chargers, b.open_24h, b.is_live, code])).rows[0];
        for (const rt of b.rates)
          await c.query("INSERT INTO lot_rates (lot_id, vehicle, hourly_paise, daily_cap_paise, monthly_paise, valid) VALUES ($1,$2,$3,$4,$5,tstzrange('-infinity', NULL))",
            [r.id, rt.vehicle, rt.hourly_paise, rt.daily_cap_paise ?? null, rt.monthly_paise ?? null]);
        await audit(c, u.sub, "create", "lot", r.id, null, { ...r, rates: b.rates });
        return r;
      });
      return reply.code(201).send({ lot, code: lot.code });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "code_taken", "That lot code is already used.");
      throw e;
    }
  });

  // ADM-02: full or partial refund against captured payments of a booking, never more than was paid.
  app.post("/v1/admin/refunds", { preHandler: admin }, async (req) => {
    const u = currentUser(req); idemKey(req);
    const b = parse(z.object({ booking_id: Uuid, amount_paise: z.number().int().positive(), reason: z.string().max(200).default("support") }), req.body);
    return tx(deps.db, async c => {
      const pays = (await c.query("SELECT * FROM payments WHERE booking_id = $1 AND status IN ('captured','partially_refunded') ORDER BY created_at FOR UPDATE", [b.booking_id])).rows;
      const refundable = pays.reduce((s, p) => s + p.amount_paise - p.refunded_paise, 0);
      if (b.amount_paise > refundable) throw new HttpError(409, "over_refund", `Only ${refundable} paise can be refunded on this booking.`);
      let left = b.amount_paise; const done = [];
      for (const p of pays) {
        const amt = Math.min(left, p.amount_paise - p.refunded_paise); if (amt <= 0) continue;
        const r = await deps.payments.refund(p.razorpay_payment_id, amt);
        await c.query("INSERT INTO refunds (payment_id, amount_paise, razorpay_refund_id, reason, created_by) VALUES ($1,$2,$3,$4,$5)", [p.id, amt, r.id, b.reason, u.sub]);
        const full = p.refunded_paise + amt === p.amount_paise;
        await c.query("UPDATE payments SET refunded_paise = refunded_paise + $2, status = $3 WHERE id = $1", [p.id, amt, full ? "refunded" : "partially_refunded"]);
        done.push({ payment_id: p.id, amount_paise: amt, razorpay_refund_id: r.id });
        left -= amt; if (!left) break;
      }
      await audit(c, u.sub, "refund", "booking", b.booking_id, { refundable }, { refunded: b.amount_paise, reason: b.reason });
      return { refund: { amount_paise: b.amount_paise, parts: done } };
    });
  });

  // ADM-03
  app.post("/v1/admin/promos", { preHandler: admin }, async (req, reply) => {
    const u = currentUser(req);
    const b = parse(z.object({
      code: z.string().regex(/^[A-Z0-9]{3,20}$/, "Use 3–20 capital letters or digits."), percent_off: z.number().int().min(1).max(100),
      max_off_paise: z.number().int().positive(), first_booking_only: z.boolean().default(false), weekend_only: z.boolean().default(false),
      valid_from: IsoDate.optional(), valid_to: IsoDate.optional(), max_uses: z.number().int().positive().optional()
    }), req.body);
    try {
      const p = (await deps.db.query(
        `INSERT INTO promo_codes (code, percent_off, max_off_paise, first_booking_only, weekend_only, valid, max_uses)
         VALUES ($1,$2,$3,$4,$5,tstzrange(COALESCE($6, now()), $7),$8) RETURNING *`,
        [b.code, b.percent_off, b.max_off_paise, b.first_booking_only, b.weekend_only, b.valid_from ?? null, b.valid_to ?? null, b.max_uses ?? null])).rows[0];
      await audit(deps.db, u.sub, "create", "promo", b.code, null, p);
      return reply.code(201).send({ promo: p });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "promo_exists", "That code already exists.");
      throw e;
    }
  });

  // ADM-01: operators with KYC status. Bank details live only at Razorpay (Route linked account id here).
  app.get("/v1/admin/operators", { preHandler: admin }, async () => {
    const { rows } = await deps.db.query(
      `SELECT o.id, o.legal_name, o.pan, o.gstin, o.commission_bps, o.payout_account->>'route_account_id' AS route_account_id, o.created_at,
              (SELECT count(*)::int FROM lots l WHERE l.operator_id = o.id) AS lots,
              (SELECT count(*)::int FROM lots l WHERE l.operator_id = o.id AND l.is_live) AS live_lots
       FROM operators o ORDER BY o.legal_name`);
    return rows;
  });

  app.put("/v1/admin/operators/:id/payout-account", { preHandler: admin }, async (req) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    const b = parse(z.object({ route_account_id: z.string().regex(/^acc_[A-Za-z0-9]{14}$/, "Razorpay linked account id looks like acc_XXXXXXXXXXXXXX.") }), req.body);
    return tx(deps.db, async c => {
      const before = (await c.query("SELECT payout_account FROM operators WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!before) throw new HttpError(404, "not_found", "Operator not found.");
      await c.query("UPDATE operators SET payout_account = jsonb_build_object('route_account_id', $2::text) WHERE id = $1", [id, b.route_account_id]);
      await audit(c, u.sub, "set_payout_account", "operator", id, before.payout_account, { route_account_id: b.route_account_id });
      return { operator_id: id, route_account_id: b.route_account_id };
    });
  });

  // OPS-05: weekly payout run (also called by the n8n Monday job) and the payout ledger.
  app.post("/v1/admin/payouts/run", { preHandler: admin }, async (req) => {
    const u = currentUser(req);
    const { week_start } = parse(z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "week_start is a date like 2026-10-05.")
      .refine(d => new Date(d + "T00:00:00Z").getUTCDay() === 1, "Payout weeks start on a Monday.") }), req.body);
    const created = await computePayouts(deps, week_start);
    await audit(deps.db, u.sub, "run_payouts", "payout_week", week_start, null, { created: created.length });
    return { week_start, created };
  });

  app.get("/v1/admin/payouts", { preHandler: admin }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(["pending", "processing", "paid", "failed"]).optional() }), req.query);
    const { rows } = await deps.db.query(
      `SELECT po.id, o.legal_name AS operator, lower(po.period) AS period_start, upper(po.period) - 1 AS period_end, po.payments_count,
              po.gross_paise, po.commission_paise, po.commission_gst_paise, po.tds_paise, po.tcs_paise, po.net_paise,
              po.status, po.razorpay_transfer_id, po.failure_reason, (o.payout_account->>'route_account_id') IS NOT NULL AS has_account
       FROM payouts po JOIN operators o ON o.id = po.operator_id
       WHERE $1::text IS NULL OR po.status = $1 ORDER BY lower(po.period) DESC, o.legal_name LIMIT 200`, [status ?? null]);
    return rows.map(r => ({ ...r, gross_paise: Number(r.gross_paise), commission_paise: Number(r.commission_paise), commission_gst_paise: Number(r.commission_gst_paise),
      tds_paise: Number(r.tds_paise), tcs_paise: Number(r.tcs_paise), net_paise: Number(r.net_paise) }));
  });

  // OPS-05: send one payout through Razorpay Route. Only pending or failed payouts, so a double click can't pay twice.
  app.post("/v1/admin/payouts/:id/transfer", { preHandler: admin }, async (req) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    return tx(deps.db, async c => {
      const p = (await c.query(
        `SELECT po.*, o.payout_account->>'route_account_id' AS account, o.legal_name FROM payouts po JOIN operators o ON o.id = po.operator_id
         WHERE po.id = $1 FOR UPDATE OF po`, [id])).rows[0];
      if (!p) throw new HttpError(404, "not_found", "Payout not found.");
      if (!["pending", "failed"].includes(p.status)) throw new HttpError(409, "not_payable", `This payout is already ${p.status}.`);
      if (!p.account) throw new HttpError(409, "no_account", "Add the operator's Razorpay linked account first.");
      const net = Number(p.net_paise);
      if (net <= 0) throw new HttpError(409, "nothing_to_pay", "Net payout is zero.");
      const t = await deps.payments.transfer(p.account, net, { payout_id: id, operator: p.legal_name, period: String(p.period) });
      await c.query("UPDATE payouts SET status = 'processing', razorpay_transfer_id = $2, failure_reason = NULL WHERE id = $1", [id, t.id]);
      await audit(c, u.sub, "transfer", "payout", id, { status: p.status }, { status: "processing", transfer_id: t.id, amount_paise: net });
      return { payout: { id, status: "processing", razorpay_transfer_id: t.id, amount_paise: net } };
    });
  });

  // ADM-02 support: find a booking and what can still be refunded.
  app.get("/v1/admin/bookings/:code", { preHandler: admin }, async (req) => {
    const { code } = parse(z.object({ code: z.string().min(4).max(12) }), req.params);
    const b = (await deps.db.query(
      `SELECT b.id, b.code, b.status, b.total_paise, lower(b.period) AS "from", upper(b.period) AS "to", l.name AS lot_name, v.plate, u.phone
       FROM bookings b JOIN lots l ON l.id = b.lot_id JOIN vehicles v ON v.id = b.vehicle_id JOIN users u ON u.id = b.user_id
       WHERE b.code = upper($1)`, [code])).rows[0];
    if (!b) throw new HttpError(404, "not_found", "No booking with that code.");
    const pays = (await deps.db.query(
      "SELECT id, purpose, amount_paise, refunded_paise, status, method, captured_at FROM payments WHERE booking_id = $1 ORDER BY created_at", [b.id])).rows;
    const refundable = pays.filter(p => ["captured", "partially_refunded"].includes(p.status)).reduce((s, p) => s + p.amount_paise - p.refunded_paise, 0);
    return { booking: b, payments: pays, refundable_paise: refundable };
  });

  // ADM-03 list
  app.get("/v1/admin/promos", { preHandler: admin }, async () => {
    const { rows } = await deps.db.query(
      `SELECT code, percent_off, max_off_paise, first_booking_only, weekend_only, max_uses, used_count,
              CASE WHEN lower_inf(valid) THEN NULL ELSE lower(valid) END AS valid_from, upper(valid) AS valid_to, valid @> now() AS active
       FROM promo_codes ORDER BY active DESC, code`);
    return rows;
  });

  // Audit log of every admin and operator action (read-only; rows are never updated or deleted).
  app.get("/v1/admin/audit", { preHandler: admin }, async (req) => {
    const q = parse(z.object({ entity: z.string().max(40).optional(), entity_id: z.string().max(64).optional(),
      before_id: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    const { rows } = await deps.db.query(
      `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.before, a.after, u.phone AS actor_phone, u.role AS actor_role
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE ($1::text IS NULL OR a.entity = $1) AND ($2::text IS NULL OR a.entity_id = $2) AND ($3::bigint IS NULL OR a.id < $3)
       ORDER BY a.id DESC LIMIT $4`, [q.entity ?? null, q.entity_id ?? null, q.before_id ?? null, q.limit]);
    return { entries: rows, next_before_id: rows.length === q.limit ? rows[rows.length - 1].id : null };
  });
}
