import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { currentUser, requireRole } from "../auth.js";
import { tx } from "../db.js";
import { HttpError, IsoDate, parse, Plate, rupees, Uuid } from "../http.js";
import { gstOn, startedHours } from "../pricing.js";
import { assertLotMember, audit, rateFor } from "../services.js";
import { createPayment } from "./bookings.js";

const staffOrAdmin = requireRole("operator_staff", "operator_admin");
const EARLY_ENTRY_MS = 15 * 60_000;

export function opsRoutes(app: FastifyInstance, deps: Deps) {
  // OPS-01, OPS-02, MON-03, DRV-13. Retried offline scans are deduplicated by client_event_id.
  app.post("/v1/ops/gate-events", { preHandler: staffOrAdmin }, async (req) => {
    const u = currentUser(req);
    const b = parse(z.object({
      lot_id: Uuid, pass_code: z.string().max(12).optional(), plate: Plate.optional(),
      direction: z.enum(["in", "out"]), scanned_at: IsoDate, client_event_id: z.string().min(8).max(64)
    }).refine(x => x.pass_code || x.plate, "Scan the pass or type the plate."), req.body);
    await assertLotMember(deps.db, u.sub, b.lot_id, ["operator_staff", "operator_admin"]);
    const seen = await deps.db.query("SELECT booking_id, monthly_pass_id, direction FROM gate_events WHERE client_event_id = $1", [b.client_event_id]);
    if (seen.rows[0]) return { result: "ok", duplicate: true };

    return tx(deps.db, async c => {
      const t = b.scanned_at;
      // 1) a booking at this lot by pass code or plate
      const bk = (await c.query(
        `SELECT b.*, lower(b.period) AS starts, upper(b.period) AS ends, v.plate FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id
         WHERE b.status IN ('confirmed','checked_in') AND (($2::text IS NOT NULL AND b.code = $2) OR ($3::text IS NOT NULL AND v.plate = $3))
         ORDER BY (b.lot_id = $1) DESC, abs(extract(epoch FROM lower(b.period) - $4::timestamptz)) LIMIT 1 FOR UPDATE OF b`,
        [b.lot_id, b.pass_code?.toUpperCase() ?? null, b.plate ?? null, t])).rows[0];
      if (bk) {
        if (bk.lot_id !== b.lot_id) throw new HttpError(409, "other_lot", "This pass is for a different lot.");
        if (b.direction === "in") {
          if (t.getTime() < bk.starts.getTime() - EARLY_ENTRY_MS) throw new HttpError(409, "too_early", "This pass starts later. Entry opens 15 minutes before the start time.");
          if (t >= bk.ends) throw new HttpError(409, "expired", "This pass has expired.");
          await c.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1", [bk.id]);
          await c.query("INSERT INTO gate_events (lot_id, booking_id, plate_read, direction, scanned_by, at, client_event_id) VALUES ($1,$2,$3,'in',$4,$5,$6)",
            [b.lot_id, bk.id, bk.plate, u.sub, t, b.client_event_id]);
          return { result: "ok", booking: { id: bk.id, code: bk.code, plate: bk.plate, ends: bk.ends } };
        }
        // out: overstay = started hours past the end, at lot rate + GST (DRV-13)
        let overstay = null;
        if (t > bk.ends) {
          const hrs = startedHours(bk.ends, t);
          const rate = (await rateFor(c, b.lot_id, bk.vehicle, bk.ends)).hourly_paise;
          const base = hrs * rate, gst = gstOn(base);
          const order = await createPayment(c, deps, { bookingId: bk.id, purpose: "overstay", amountPaise: base + gst, meta: { hours: hrs, base_paise: base, gst_paise: gst }, receipt: `${bk.code}-OS` });
          overstay = { hours: hrs, amount_paise: base + gst, message: `Overstay ${hrs} h: collect ${rupees(base + gst)}.`, payment_link: `${deps.cfg.WEB_ORIGIN}/pay/${order.id}` };
        }
        await c.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [bk.id]);
        await c.query("INSERT INTO gate_events (lot_id, booking_id, plate_read, direction, scanned_by, at, client_event_id) VALUES ($1,$2,$3,'out',$4,$5,$6)",
          [b.lot_id, bk.id, bk.plate, u.sub, t, b.client_event_id]);
        return { result: "ok", booking: { id: bk.id, code: bk.code }, overstay };
      }
      // 2) a monthly pass at this lot by plate
      if (b.plate) {
        const mp = (await c.query(
          `SELECT mp.* FROM monthly_passes mp JOIN vehicles v ON v.id = mp.vehicle_id
           WHERE mp.lot_id = $1 AND v.plate = $2 AND mp.status IN ('active','paused_unpaid') LIMIT 1`, [b.lot_id, b.plate])).rows[0];
        if (mp) {
          if (mp.status === "paused_unpaid" && b.direction === "in") throw new HttpError(409, "monthly_paused", "Monthly pass paused: payment due.");
          await c.query("INSERT INTO gate_events (lot_id, monthly_pass_id, plate_read, direction, scanned_by, at, client_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [b.lot_id, mp.id, b.plate, b.direction, u.sub, t, b.client_event_id]);
          return { result: "ok", monthly_pass: { id: mp.id, bay: mp.bay_label } };
        }
      }
      throw new HttpError(404, "no_pass", "No valid pass for this vehicle. Ask the driver to book or use Park now.");
    });
  });

  // OPS-04: lot status; drivers with passes in the next 3 hours are told.
  app.put("/v1/ops/lots/:id/status", { preHandler: staffOrAdmin }, async (req) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    const { status } = parse(z.object({ status: z.enum(["open", "full", "gate_down", "closed"]) }), req.body);
    await assertLotMember(deps.db, u.sub, id, ["operator_staff", "operator_admin"]);
    return tx(deps.db, async c => {
      const before = (await c.query("SELECT status, name FROM lots WHERE id = $1 FOR UPDATE", [id])).rows[0];
      const lot = (await c.query("UPDATE lots SET status = $2 WHERE id = $1 RETURNING id, name, code, status", [id, status])).rows[0];
      await audit(c, u.sub, "set_status", "lot", id, { status: before.status }, { status });
      if (status !== "open") {
        const affected = (await c.query(
          `SELECT b.code, u.phone FROM bookings b JOIN users u ON u.id = b.user_id
           WHERE b.lot_id = $1 AND b.status IN ('confirmed','checked_in') AND b.period && tstzrange(now(), now() + interval '3 hours')`, [id])).rows;
        for (const a of affected) deps.notify.send({ event: "lot_status", phone: a.phone, data: { lot: lot.name, status, code: a.code } });
        return { lot, notified: affected.length };
      }
      return { lot, notified: 0 };
    });
  });

  // OPS-03: new rate card from a date; closes the open card, rejects true overlaps.
  app.post("/v1/ops/lots/:id/rates", { preHandler: requireRole("operator_admin") }, async (req, reply) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    const b = parse(z.object({ vehicle: z.enum(["car", "bike"]), hourly_paise: z.number().int().min(100).max(100_000),
      daily_cap_paise: z.number().int().positive().nullable().optional(), monthly_paise: z.number().int().positive().nullable().optional(),
      valid_from: IsoDate }), req.body);
    await assertLotMember(deps.db, u.sub, id, ["operator_admin"]);
    try {
      const rate = await tx(deps.db, async c => {
        await c.query(`UPDATE lot_rates SET valid = tstzrange(lower(valid), $3) WHERE lot_id = $1 AND vehicle = $2 AND valid @> $3::timestamptz AND lower(valid) < $3`,
          [id, b.vehicle, b.valid_from]);
        const r = (await c.query(
          `INSERT INTO lot_rates (lot_id, vehicle, hourly_paise, daily_cap_paise, monthly_paise, valid) VALUES ($1,$2,$3,$4,$5,tstzrange($6, NULL))
           RETURNING id, vehicle, hourly_paise, daily_cap_paise, monthly_paise, lower(valid) AS valid_from`,
          [id, b.vehicle, b.hourly_paise, b.daily_cap_paise ?? null, b.monthly_paise ?? null, b.valid_from])).rows[0];
        await audit(c, u.sub, "create", "lot_rate", r.id, null, r);
        return r;
      });
      return reply.code(201).send({ rate });
    } catch (e) {
      if ((e as { code?: string }).code === "23P01") throw new HttpError(409, "rate_overlap", "A rate already covers these dates.");
      throw e;
    }
  });

  // OPS-04/05 dashboard: bookings, revenue and occupancy for a lot over a period.
  app.get("/v1/ops/dashboard", { preHandler: requireRole("operator_admin") }, async (req) => {
    const u = currentUser(req);
    const q = parse(z.object({ lot_id: Uuid, from: IsoDate, to: IsoDate }), req.query);
    await assertLotMember(deps.db, u.sub, q.lot_id, ["operator_admin"]);
    const r = (await deps.db.query(
      `SELECT count(*) FILTER (WHERE b.status IN ('confirmed','checked_in','completed'))::int AS bookings,
              COALESCE(sum(b.base_paise) FILTER (WHERE b.status IN ('confirmed','checked_in','completed')), 0)::int AS parking_revenue_paise,
              count(*) FILTER (WHERE b.status = 'checked_in')::int AS parked_now
       FROM bookings b WHERE b.lot_id = $1 AND b.period && tstzrange($2, $3)`, [q.lot_id, q.from, q.to])).rows[0];
    const cap = (await deps.db.query("SELECT capacity_car, status FROM lots WHERE id = $1", [q.lot_id])).rows[0];
    return { ...r, capacity_car: cap.capacity_car, status: cap.status, occupancy_pct: cap.capacity_car ? Math.round((r.parked_now * 100) / cap.capacity_car) : 0 };
  });

  // OPS-05: payouts, JSON or CSV.
  app.get("/v1/ops/payouts", { preHandler: requireRole("operator_admin") }, async (req, reply) => {
    const u = currentUser(req);
    const rows = (await deps.db.query(
      `SELECT p.lower_date AS period_start, p.upper_date AS period_end, p.gross_paise, p.commission_paise, p.tds_paise, p.net_paise, p.status
       FROM (SELECT po.*, lower(po.period) AS lower_date, upper(po.period) AS upper_date FROM payouts po) p
       JOIN operator_members m ON m.operator_id = p.operator_id WHERE m.user_id = $1 AND m.role = 'operator_admin'
       ORDER BY p.lower_date DESC LIMIT 52`, [u.sub])).rows;
    if (req.headers.accept?.includes("text/csv")) {
      const head = "period_start,period_end,gross_inr,commission_inr,tds_inr,net_inr,status";
      const fmt = (d: Date) => d.toISOString().slice(0, 10), inr = (p: number) => (Number(p) / 100).toFixed(2);
      const body = rows.map(r => [fmt(r.period_start), fmt(r.period_end), inr(r.gross_paise), inr(r.commission_paise), inr(r.tds_paise), inr(r.net_paise), r.status].join(","));
      return reply.type("text/csv").send([head, ...body].join("\n") + "\n");
    }
    return rows;
  });
}

/** Weekly payout per operator from captured parking revenue. Platform funds promos, so gross is base before discount. */
export async function computePayouts(deps: Deps, weekStart: string) {
  const r = await deps.db.query(
    `INSERT INTO payouts (operator_id, period, gross_paise, commission_paise, tds_paise)
     SELECT l.operator_id, daterange($1::date, $1::date + 7),
            sum(b.base_paise), round(sum(b.base_paise) * $2 / 10000.0), round(sum(b.base_paise) * $3 / 10000.0)
     FROM bookings b JOIN lots l ON l.id = b.lot_id
     WHERE b.status IN ('confirmed','checked_in','completed')
       AND (lower(b.period) AT TIME ZONE 'Asia/Kolkata')::date >= $1::date AND (lower(b.period) AT TIME ZONE 'Asia/Kolkata')::date < $1::date + 7
     GROUP BY l.operator_id
     ON CONFLICT (operator_id, period) DO NOTHING RETURNING *`, [weekStart, deps.cfg.COMMISSION_BPS, deps.cfg.TDS_BPS]);
  // bigint columns arrive as strings from pg; amounts fit safely in a JS number
  const num = (v: unknown) => Number(v);
  return r.rows.map(p => ({ ...p, gross_paise: num(p.gross_paise), commission_paise: num(p.commission_paise), tds_paise: num(p.tds_paise), net_paise: num(p.net_paise) }));
}
