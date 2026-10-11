import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { currentUser, requireRole } from "../auth.js";
import { tx } from "../db.js";
import { HttpError, idemKey, IsoDate, parse, Uuid } from "../http.js";
import { audit } from "../services.js";

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
}
