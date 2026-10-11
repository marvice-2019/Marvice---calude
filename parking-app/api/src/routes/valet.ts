import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { currentUser, requireRole } from "../auth.js";
import { tx, type Tx } from "../db.js";
import { HttpError, idemKey, IsoDate, parse, Phone10, Plate, Uuid } from "../http.js";
import { gstOn } from "../pricing.js";
import { audit } from "../services.js";
import { createPayment, idempotent } from "./bookings.js";

// SPEC §6 Valet: pay on request (fee + GST), validation zeroes fee and GST, tips outside GST, forward-only status.
export const TIP_CHOICES_PAISE = [0, 2000, 5000, 10000];
const DAMAGE_WINDOW_MS = 15 * 60_000;
const NEXT: Record<string, string[]> = { dropped: ["parked"], requested: ["coming"], coming: ["ready"] };
const staff = requireRole("operator_staff", "operator_admin");

async function assertDeskMember(q: Tx | Deps["db"], userId: string, deskId: string, roles: string[]) {
  const { rows } = await q.query(
    `SELECT m.role FROM valet_desks d JOIN operator_members m ON m.operator_id = d.operator_id WHERE d.id = $1 AND m.user_id = $2`, [deskId, userId]);
  if (!rows[0] || !roles.includes(rows[0].role)) throw new HttpError(403, "forbidden", "You don't have access to this valet desk.");
}

const ticketView = `
  SELECT t.id, t.code, t.status, t.key_tag, t.bay, t.handover_photos, t.fee_paise, t.gst_paise, t.tip_paise,
         t.dropped_at, t.requested_at, t.ready_at, t.closed_at, t.validation_id IS NOT NULL AS validated,
         d.id AS desk_id, d.name AS desk_name, d.typical_eta_min, v.plate, u.phone
  FROM valet_tickets t JOIN valet_desks d ON d.id = t.desk_id JOIN vehicles v ON v.id = t.vehicle_id JOIN users u ON u.id = t.user_id`;

/** Expected ready time for a requested ticket, from the desk's typical ETA. */
const withEta = (t: any) => ({ ...t,
  eta_at: t.requested_at && ["requested", "coming"].includes(t.status) ? new Date(new Date(t.requested_at).getTime() + t.typical_eta_min * 60_000) : null });

export function valetRoutes(app: FastifyInstance, deps: Deps) {
  // VAL-01: nearby live desks with fee, ETA and whether a venue validates today.
  app.get("/v1/valet/desks", async (req) => {
    const q = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }), req.query);
    const { rows } = await deps.db.query(
      `SELECT d.id, d.name, d.fee_paise, d.typical_eta_min, ST_Distance(d.geo, ST_MakePoint($2,$1)::geography)::int AS distance_m,
              (SELECT v.validator FROM valet_validations v WHERE v.desk_id = d.id AND v.valid @> now() LIMIT 1) AS validator
       FROM valet_desks d WHERE d.is_live AND ST_DWithin(d.geo, ST_MakePoint($2,$1)::geography, 5000) ORDER BY distance_m LIMIT 20`, [q.lat, q.lng]);
    return rows.map(r => ({ ...r, gst_paise: gstOn(r.fee_paise) }));
  });

  // VAL-01: staff create the ticket at handover, with exactly 4 photos. Driver may be a guest (phone only).
  app.post("/v1/valet/tickets", { preHandler: staff }, async (req, reply) => {
    const u = currentUser(req);
    const b = parse(z.object({ desk_id: Uuid, plate: Plate, phone: Phone10, key_tag: z.string().regex(/^[A-Z0-9-]{1,8}$/i, "Key tag: up to 8 letters or digits."),
      photo_keys: z.array(z.string().min(3).max(200)).length(4, "Take all 4 handover photos: front, rear, left and right."),
      bay: z.string().max(12).optional(), client_id: z.string().min(8).max(64).optional() }), req.body);
    await assertDeskMember(deps.db, u.sub, b.desk_id, ["operator_staff", "operator_admin"]);
    if (b.client_id) {
      const seen = await deps.db.query(`${ticketView} WHERE t.client_id = $1`, [b.client_id]);
      if (seen.rows[0]) return reply.code(200).send({ ticket: seen.rows[0], duplicate: true });
    }
    try {
      const ticket = await tx(deps.db, async c => {
        const desk = (await c.query("SELECT fee_paise, name FROM valet_desks WHERE id = $1 AND is_live", [b.desk_id])).rows[0];
        if (!desk) throw new HttpError(404, "desk_not_found", "This valet desk isn't live.");
        const user = (await c.query(
          `INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`, ["+91" + b.phone])).rows[0];
        const veh = (await c.query(
          `INSERT INTO vehicles (user_id, plate) VALUES ($1,$2) ON CONFLICT (user_id, plate) DO UPDATE SET plate = EXCLUDED.plate RETURNING id`, [user.id, b.plate])).rows[0];
        const code = "VT-" + randomBytes(3).toString("hex").slice(0, 4).toUpperCase();
        const r = await c.query(
          `INSERT INTO valet_tickets (code, desk_id, user_id, vehicle_id, key_tag, bay, status, handover_photos, dropped_by, fee_paise, client_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [code, b.desk_id, user.id, veh.id, b.key_tag.toUpperCase(), b.bay ?? null, b.bay ? "parked" : "dropped", JSON.stringify(b.photo_keys), u.sub, desk.fee_paise, b.client_id ?? null]);
        const t = (await c.query(`${ticketView} WHERE t.id = $1`, [r.rows[0].id])).rows[0];
        deps.notify.send({ event: "valet_ticket_created", phone: t.phone, data: { code: t.code, desk: desk.name, tag: t.key_tag } });
        return t;
      });
      return reply.code(201).send({ ticket });
    } catch (e) {
      if ((e as { code?: string; constraint?: string }).constraint === "valet_open_tag_uq")
        throw new HttpError(409, "key_tag_in_use", `Key tag ${b.key_tag.toUpperCase()} is already in use. Pick another tag.`);
      throw e;
    }
  });

  // VAL-05: the driver's open tickets and those closed in the last 24 h.
  app.get("/v1/valet/tickets", { preHandler: requireRole("driver") }, async (req) => {
    const u = currentUser(req);
    const { rows } = await deps.db.query(
      `${ticketView} WHERE t.user_id = $1 AND (t.status NOT IN ('closed','cancelled') OR t.closed_at > now() - interval '24 hours') ORDER BY t.dropped_at DESC`, [u.sub]);
    return rows.map(withEta);
  });

  // VAL-02, VAL-03, VAL-04: request the car; pay fee + GST + tip, or only the tip when validated.
  app.post("/v1/valet/tickets/:id/request", { preHandler: requireRole("driver") }, async (req, reply) => {
    const u = currentUser(req), key = idemKey(req);
    const { id } = parse(z.object({ id: Uuid }), req.params);
    const b = parse(z.object({ validation_code: z.string().max(12).optional(), tip_paise: z.number().int().refine(v => TIP_CHOICES_PAISE.includes(v), "Tip must be ₹0, ₹20, ₹50 or ₹100.") }), req.body);
    const out = await idempotent(deps, u.sub, key, `POST /v1/valet/tickets/${id}/request`, () => tx(deps.db, async c => {
      const t = (await c.query("SELECT t.*, d.fee_paise AS desk_fee FROM valet_tickets t JOIN valet_desks d ON d.id = t.desk_id WHERE t.id = $1 AND t.user_id = $2 FOR UPDATE OF t", [id, u.sub])).rows[0];
      if (!t) throw new HttpError(404, "ticket_not_found", "Ticket not found.");
      if (t.status !== "parked") throw new HttpError(409, "not_parked", t.status === "dropped" ? "Your car is still being parked. Try again in a minute." : "This car has already been requested.");
      let validationId: string | null = null;
      if (b.validation_code?.trim()) {
        const v = (await c.query("SELECT id FROM valet_validations WHERE desk_id = $1 AND upper(code) = upper($2) AND valid @> now()", [t.desk_id, b.validation_code.trim()])).rows[0];
        if (!v) throw new HttpError(422, "validation_invalid", "That code didn't work. Ask the counter for today's validation code.");
        validationId = v.id;
      }
      const fee = validationId ? 0 : t.desk_fee, gst = gstOn(fee), total = fee + gst + b.tip_paise;
      if (total === 0) {
        await c.query("UPDATE valet_tickets SET status = 'requested', requested_at = now(), validation_id = $2, fee_paise = 0, gst_paise = 0, tip_paise = 0 WHERE id = $1", [id, validationId]);
        const ticket = (await c.query(`${ticketView} WHERE t.id = $1`, [id])).rows[0];
        return { status: 200, body: { ticket: withEta(ticket), razorpay_order: null } };
      }
      const order = await createPayment(c, deps, { valetTicketId: id, purpose: "valet", amountPaise: total,
        meta: { fee_paise: fee, gst_paise: gst, tip_paise: b.tip_paise, validation_id: validationId }, receipt: t.code });
      const ticket = (await c.query(`${ticketView} WHERE t.id = $1`, [id])).rows[0];
      return { status: 201, body: { ticket: withEta(ticket), bill: { fee_paise: fee, gst_paise: gst, tip_paise: b.tip_paise, total_paise: total }, razorpay_order: order } };
    }));
    return reply.code(out.status).send(out.body);
  });

  // VAL-05: driver confirms collection.
  app.post("/v1/valet/tickets/:id/collected", { preHandler: requireRole("driver") }, async (req) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    const r = await deps.db.query("UPDATE valet_tickets SET status = 'closed', closed_at = now() WHERE id = $1 AND user_id = $2 AND status = 'ready' RETURNING id", [id, u.sub]);
    if (!r.rowCount) throw new HttpError(409, "not_ready", "Your car isn't at the porch yet.");
    return { ticket: (await deps.db.query(`${ticketView} WHERE t.id = $1`, [id])).rows[0] };
  });

  // VAL-06: damage report while ready, or within 15 minutes of closing; photo required.
  app.post("/v1/valet/tickets/:id/damage", { preHandler: requireRole("driver") }, async (req, reply) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    const b = parse(z.object({ where: z.enum(["front", "rear", "left", "right", "interior"]), photo_key: z.string().min(3).max(200).optional() }), req.body);
    if (!b.photo_key) throw new HttpError(400, "photo_required", "Add a photo of the damage so we can compare it.");
    const t = (await deps.db.query("SELECT t.*, d.operator_id FROM valet_tickets t JOIN valet_desks d ON d.id = t.desk_id WHERE t.id = $1 AND t.user_id = $2", [id, u.sub])).rows[0];
    if (!t) throw new HttpError(404, "ticket_not_found", "Ticket not found.");
    const inWindow = t.status === "ready" || (t.status === "closed" && t.closed_at && Date.now() - t.closed_at.getTime() <= DAMAGE_WINDOW_MS);
    if (!inWindow) throw new HttpError(410, "too_late", "Damage reports close 15 minutes after you collect your car. Contact support with your ticket number.");
    await deps.db.query("UPDATE valet_tickets SET damage_report = $2 WHERE id = $1",
      [id, JSON.stringify({ where: b.where, photo_url: b.photo_key, reported_at: new Date().toISOString() })]);
    const phone = (await deps.db.query("SELECT phone FROM users WHERE id = $1", [u.sub])).rows[0].phone;
    deps.notify.send({ event: "valet_damage_reported", phone, data: { code: t.code, where: b.where, operator_id: t.operator_id } });
    return reply.code(201).send({ reference: `${t.code}-D`, message: "We've got your report. The operator replies within 24 hours." });
  });

  // VAL-07: staff queue, oldest request first.
  app.get("/v1/ops/valet/queue", { preHandler: staff }, async (req) => {
    const u = currentUser(req); const { desk_id } = parse(z.object({ desk_id: Uuid }), req.query);
    await assertDeskMember(deps.db, u.sub, desk_id, ["operator_staff", "operator_admin"]);
    const { rows } = await deps.db.query(`${ticketView} WHERE t.desk_id = $1 AND t.status IN ('requested','coming') ORDER BY t.requested_at`, [desk_id]);
    return rows.map(withEta);
  });

  // VAL-05, VAL-07: forward-only status changes by staff.
  app.put("/v1/ops/valet/tickets/:id/status", { preHandler: staff }, async (req) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    const b = parse(z.object({ status: z.enum(["parked", "coming", "ready"]), bay: z.string().max(12).optional() }), req.body);
    return tx(deps.db, async c => {
      const t = (await c.query("SELECT * FROM valet_tickets WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!t) throw new HttpError(404, "ticket_not_found", "Ticket not found.");
      await assertDeskMember(c, u.sub, t.desk_id, ["operator_staff", "operator_admin"]);
      if (!(NEXT[t.status] ?? []).includes(b.status)) throw new HttpError(409, "bad_transition", `Can't move a ${t.status} car to ${b.status}.`);
      if (b.status === "parked" && !b.bay) throw new HttpError(400, "invalid_request", "bay: record where the car is parked.");
      await c.query(
        `UPDATE valet_tickets SET status = $2::valet_status, bay = COALESCE($3, bay),
           retrieved_by = CASE WHEN $2::text = 'coming' THEN $4::uuid ELSE retrieved_by END,
           ready_at = CASE WHEN $2::text = 'ready' THEN now() ELSE ready_at END WHERE id = $1`, [id, b.status, b.bay ?? null, u.sub]);
      await audit(c, u.sub, "valet_status", "valet_ticket", id, { status: t.status }, { status: b.status });
      const ticket = (await c.query(`${ticketView} WHERE t.id = $1`, [id])).rows[0];
      if (b.status === "ready") deps.notify.send({ event: "valet_car_ready", phone: ticket.phone, data: { code: ticket.code } });
      return { ticket: withEta(ticket) };
    });
  });

  // VAL-03: operator admin creates a venue validation code for a time window.
  app.post("/v1/ops/valet/validations", { preHandler: requireRole("operator_admin") }, async (req, reply) => {
    const u = currentUser(req);
    const b = parse(z.object({ desk_id: Uuid, validator: z.string().min(2).max(80), code: z.string().regex(/^[A-Z0-9]{4,12}$/i, "Code: 4–12 letters or digits."),
      valid_from: IsoDate, valid_to: IsoDate }).refine(x => x.valid_to > x.valid_from, { message: "valid_to must be after valid_from", path: ["valid_to"] }), req.body);
    await assertDeskMember(deps.db, u.sub, b.desk_id, ["operator_admin"]);
    try {
      const v = (await deps.db.query(
        "INSERT INTO valet_validations (desk_id, validator, code, valid) VALUES ($1,$2,$3,tstzrange($4,$5)) RETURNING id, validator, code, lower(valid) AS valid_from, upper(valid) AS valid_to",
        [b.desk_id, b.validator, b.code.toUpperCase(), b.valid_from, b.valid_to])).rows[0];
      await audit(deps.db, u.sub, "create", "valet_validation", v.id, null, v);
      return reply.code(201).send({ validation: v });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "validation_exists", "That code already exists for this window.");
      throw e;
    }
  });
}
