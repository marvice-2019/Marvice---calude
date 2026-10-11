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

  // OPS lots the signed-in staff or admin works at (platform admins see all), with live counts.
  app.get("/v1/ops/lots", { preHandler: requireRole("operator_staff", "operator_admin", "platform_admin") }, async (req) => {
    const u = currentUser(req);
    const { rows } = await deps.db.query(
      `SELECT l.id, l.name, l.code, l.address, l.status, l.capacity_car, l.capacity_bike, o.legal_name AS operator,
              CASE WHEN $2 THEN 'platform_admin' ELSE m.role::text END AS my_role,
              (SELECT count(*)::int FROM bookings b WHERE b.lot_id = l.id AND b.status = 'checked_in') AS parked_now,
              (SELECT count(*)::int FROM bookings b WHERE b.lot_id = l.id AND b.status = 'confirmed'
                 AND (lower(b.period) AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS expected_today
       FROM lots l JOIN operators o ON o.id = l.operator_id
       LEFT JOIN operator_members m ON m.operator_id = l.operator_id AND m.user_id = $1
       WHERE $2 OR m.user_id IS NOT NULL ORDER BY l.code`, [u.sub, u.role === "platform_admin"]);
    return rows;
  });

  // OPS-01 support: today's expected arrivals at a lot (IST day), plus who is parked now.
  app.get("/v1/ops/lots/:id/arrivals", { preHandler: staffOrAdmin }, async (req) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
    await assertLotMember(deps.db, u.sub, id, ["operator_staff", "operator_admin"]);
    const { rows } = await deps.db.query(
      `SELECT b.id, b.code, v.plate, b.vehicle, b.source, b.status, lower(b.period) AS "from", upper(b.period) AS "to"
       FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id
       WHERE b.lot_id = $1 AND (b.status = 'checked_in' OR (b.status = 'confirmed'
         AND (lower(b.period) AT TIME ZONE 'Asia/Kolkata')::date = COALESCE($2::date, (now() AT TIME ZONE 'Asia/Kolkata')::date)))
       ORDER BY b.status = 'checked_in', lower(b.period)`, [id, date ?? null]);
    return rows;
  });

  // OPS-03 support: rate cards for a lot, current and scheduled. Staff may read, only admins edit.
  app.get("/v1/ops/lots/:id/rates", { preHandler: staffOrAdmin }, async (req) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    await assertLotMember(deps.db, u.sub, id, ["operator_staff", "operator_admin"]);
    const { rows } = await deps.db.query(
      `SELECT id, vehicle, hourly_paise, daily_cap_paise, monthly_paise,
              CASE WHEN lower_inf(valid) THEN NULL ELSE lower(valid) END AS valid_from, upper(valid) AS valid_to,
              valid @> now() AS current
       FROM lot_rates WHERE lot_id = $1 AND (upper_inf(valid) OR upper(valid) > now() - interval '90 days')
       ORDER BY vehicle, lower(valid) DESC NULLS LAST`, [id]);
    return rows;
  });

  // MON-02 support: monthly requests and passes across the admin's lots. Phone is masked (DPDP: only what the operator needs).
  app.get("/v1/ops/monthly-passes", { preHandler: requireRole("operator_admin") }, async (req) => {
    const u = currentUser(req);
    const { status } = parse(z.object({ status: z.enum(["requested", "approved", "active", "paused_unpaid", "cancelled"]).optional() }), req.query);
    const { rows } = await deps.db.query(
      `SELECT mp.id, mp.status, mp.starts_on, mp.price_paise, mp.bay_label, l.id AS lot_id, l.name AS lot_name, l.code AS lot_code, v.plate,
              left(u.phone, 5) || '•••••' || right(u.phone, 3) AS phone_masked
       FROM monthly_passes mp JOIN lots l ON l.id = mp.lot_id JOIN vehicles v ON v.id = mp.vehicle_id JOIN users u ON u.id = mp.user_id
       JOIN operator_members m ON m.operator_id = l.operator_id AND m.user_id = $1 AND m.role = 'operator_admin'
       WHERE $2::text IS NULL OR mp.status::text = $2 ORDER BY mp.status = 'requested' DESC, mp.created_at DESC LIMIT 200`, [u.sub, status ?? null]);
    return rows;
  });

  // OPS-04/05 dashboard: hourly arrivals and occupancy, and money split for a lot over a period (max 31 days).
  app.get("/v1/ops/dashboard", { preHandler: requireRole("operator_admin") }, async (req) => {
    const u = currentUser(req);
    const q = parse(z.object({ lot_id: Uuid, from: IsoDate, to: IsoDate })
      .refine(x => x.to > x.from && x.to.getTime() - x.from.getTime() <= 31 * 86_400_000, "Pick a range of up to 31 days."), req.query);
    await assertLotMember(deps.db, u.sub, q.lot_id, ["operator_admin"]);
    const r = (await deps.db.query(
      `SELECT count(*) FILTER (WHERE b.status IN ('confirmed','checked_in','completed'))::int AS bookings,
              COALESCE(sum(b.base_paise) FILTER (WHERE b.status IN ('confirmed','checked_in','completed')), 0)::int AS parking_revenue_paise,
              count(*) FILTER (WHERE b.status = 'checked_in')::int AS parked_now
       FROM bookings b WHERE b.lot_id = $1 AND b.period && tstzrange($2, $3)`, [q.lot_id, q.from, q.to])).rows[0];
    const lot = (await deps.db.query(
      "SELECT l.capacity_car, l.status, o.commission_bps, o.gstin FROM lots l JOIN operators o ON o.id = l.operator_id WHERE l.id = $1", [q.lot_id])).rows[0];
    // hourly buckets (charts are drawn in IST by the client)
    const byHour = (await deps.db.query(
      `SELECT h AS hour,
              count(b.id) FILTER (WHERE lower(b.period) >= h AND lower(b.period) < h + interval '1 hour')::int AS arrivals,
              count(b.id) FILTER (WHERE b.period && tstzrange(h, h + interval '1 hour'))::int AS occupied
       FROM generate_series($2::timestamptz, $3::timestamptz - interval '1 second', interval '1 hour') h -- starts exactly at "from", so IST (UTC+5:30) days stay aligned
       LEFT JOIN bookings b ON b.lot_id = $1 AND b.status IN ('confirmed','checked_in','completed') AND b.period && tstzrange(h, h + interval '1 hour')
       GROUP BY h ORDER BY h`, [q.lot_id, q.from, q.to])).rows;
    const money = (await deps.db.query(
      `SELECT COALESCE(sum(CASE p.purpose WHEN 'booking' THEN b.base_paise ELSE (p.meta->>'base_paise')::int END), 0)::int AS gross_paise,
              COALESCE(sum(CASE p.purpose WHEN 'booking' THEN b.gst_paise ELSE (p.meta->>'gst_paise')::int END), 0)::int AS gst_collected_paise
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE b.lot_id = $1 AND p.status IN ('captured','partially_refunded') AND b.status <> 'cancelled' AND p.captured_at >= $2 AND p.captured_at < $3`,
      [q.lot_id, q.from, q.to])).rows[0];
    const split = payoutSplit(money.gross_paise, lot.commission_bps, !!lot.gstin, deps.cfg);
    return { ...r, capacity_car: lot.capacity_car, status: lot.status,
      occupancy_pct: lot.capacity_car ? Math.round((r.parked_now * 100) / lot.capacity_car) : 0,
      by_hour: byHour, revenue: { ...split, gst_collected_paise: money.gst_collected_paise } };
  });

  // OPS-05: payouts with every deduction line, JSON or CSV.
  app.get("/v1/ops/payouts", { preHandler: requireRole("operator_admin") }, async (req, reply) => {
    const u = currentUser(req);
    const rows = (await deps.db.query(
      `SELECT DISTINCT ON (po.id) po.id, lower(po.period) AS period_start, upper(po.period) - 1 AS period_end, po.payments_count,
              po.gross_paise::bigint, po.commission_paise, po.commission_gst_paise, po.tds_paise, po.tcs_paise, po.net_paise,
              po.status, po.razorpay_transfer_id, po.transferred_at, po.failure_reason
       FROM payouts po JOIN operator_members m ON m.operator_id = po.operator_id AND m.user_id = $1 AND m.role = 'operator_admin'
       ORDER BY po.id`, [u.sub])).rows
      .map(numify).sort((a, b) => +b.period_start - +a.period_start).slice(0, 52);
    const wantsCsv = req.headers.accept?.includes("text/csv") || (req.query as { format?: string }).format === "csv";
    if (wantsCsv) {
      const head = "period_start,period_end,payments,gross_inr,commission_inr,gst_on_commission_inr,tds_194o_inr,tcs_gst_inr,net_inr,status,transfer_id";
      const fmt = (d: Date) => d.toISOString().slice(0, 10), inr = (p: number) => (p / 100).toFixed(2);
      const body = rows.map(r => [fmt(r.period_start), fmt(r.period_end), r.payments_count, inr(r.gross_paise), inr(r.commission_paise), inr(r.commission_gst_paise),
        inr(r.tds_paise), inr(r.tcs_paise), inr(r.net_paise), r.status, r.razorpay_transfer_id ?? ""].join(","));
      return reply.type("text/csv").header("content-disposition", "attachment; filename=bayline-payouts.csv").send([head, ...body].join("\n") + "\n");
    }
    return rows;
  });
}

const MONEY = ["gross_paise", "commission_paise", "commission_gst_paise", "tds_paise", "tcs_paise", "net_paise"] as const;
// bigint columns arrive as strings from pg; amounts fit safely in a JS number
function numify<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of MONEY) if (k in out) out[k] = Number(out[k]);
  return out as T;
}

/** One operator's deductions on a gross parking value, rounded half-up per line exactly like the SQL payout run. */
export function payoutSplit(gross: number, commissionBps: number, gstRegistered: boolean, cfg: { TDS_BPS: number; TCS_BPS: number; COMMISSION_GST_BPS: number }) {
  const r = (v: number) => Math.round(v);
  const commission = r(gross * commissionBps / 10_000);
  const commission_gst = r(commission * cfg.COMMISSION_GST_BPS / 10_000);
  const tds = r(gross * cfg.TDS_BPS / 10_000);
  const tcs = gstRegistered ? r(gross * cfg.TCS_BPS / 10_000) : 0;
  return { gross_paise: gross, commission_paise: commission, commission_gst_paise: commission_gst, tds_paise: tds, tcs_paise: tcs,
    net_paise: gross - commission - commission_gst - tds - tcs };
}

/**
 * Weekly payout per operator (IST week starting `weekStart`), from parking value actually captured that week:
 * bookings (base, before platform-funded promos), extensions, overstays, monthly fees and valet fees. GST, the platform fee
 * and tips are not operator revenue. Cancelled bookings and fully refunded payments are excluded; partial goodwill refunds
 * are borne by the platform. Idempotent per (operator, week).
 */
export async function computePayouts(deps: Deps, weekStart: string) {
  const r = await deps.db.query(
    `WITH lines AS (
       SELECT COALESCE(lb.operator_id, lm.operator_id, d.operator_id) AS operator_id,
              CASE p.purpose WHEN 'booking' THEN b.base_paise WHEN 'valet' THEN (p.meta->>'fee_paise')::int ELSE (p.meta->>'base_paise')::int END AS value
       FROM payments p
       LEFT JOIN bookings b ON b.id = p.booking_id LEFT JOIN lots lb ON lb.id = b.lot_id
       LEFT JOIN monthly_passes mp ON mp.id = p.monthly_pass_id LEFT JOIN lots lm ON lm.id = mp.lot_id
       LEFT JOIN valet_tickets vt ON vt.id = p.valet_ticket_id LEFT JOIN valet_desks d ON d.id = vt.desk_id
       WHERE p.status IN ('captured','partially_refunded')
         AND (p.purpose <> 'booking' OR b.status IN ('confirmed','checked_in','completed'))
         AND (p.captured_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date AND (p.captured_at AT TIME ZONE 'Asia/Kolkata')::date < $1::date + 7
     ), g AS (SELECT operator_id, sum(value) AS gross, count(*)::int AS n FROM lines WHERE value > 0 GROUP BY operator_id)
     INSERT INTO payouts (operator_id, period, gross_paise, commission_paise, commission_gst_paise, tds_paise, tcs_paise, payments_count)
     SELECT o.id, daterange($1::date, $1::date + 7), g.gross, c.comm, round(c.comm * $3 / 10000.0), round(g.gross * $2 / 10000.0),
            CASE WHEN o.gstin IS NOT NULL THEN round(g.gross * $4 / 10000.0) ELSE 0 END, g.n
     FROM g JOIN operators o ON o.id = g.operator_id CROSS JOIN LATERAL (SELECT round(g.gross * o.commission_bps / 10000.0) AS comm) c
     ON CONFLICT (operator_id, period) DO NOTHING RETURNING *`,
    [weekStart, deps.cfg.TDS_BPS, deps.cfg.COMMISSION_GST_BPS, deps.cfg.TCS_BPS]);
  return r.rows.map(numify);
}
