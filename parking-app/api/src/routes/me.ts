import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { currentUser, requireRole } from "../auth.js";
import { HttpError, parse, Plate, Uuid } from "../http.js";

const driver = requireRole("driver");

export function meRoutes(app: FastifyInstance, deps: Deps) {
  // DRV-07: what checkout prefills.
  app.get("/v1/me", { preHandler: driver }, async (req) => {
    const u = currentUser(req);
    const user = (await deps.db.query("SELECT id, phone, full_name, email, role, default_vehicle_id, payment_method FROM users WHERE id = $1", [u.sub])).rows[0];
    const vehicles = (await deps.db.query("SELECT id, plate, kind, nickname FROM vehicles WHERE user_id = $1 ORDER BY plate", [u.sub])).rows;
    const favourites = (await deps.db.query("SELECT lot_id FROM favourite_lots WHERE user_id = $1 ORDER BY created_at DESC", [u.sub])).rows.map(r => r.lot_id);
    const last = (await deps.db.query(
      `SELECT b.vehicle_id, p.method FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'captured'
       WHERE b.user_id = $1 AND b.status IN ('confirmed','checked_in','completed') ORDER BY b.created_at DESC LIMIT 1`, [u.sub])).rows[0];
    return { user, vehicles, favourites,
      preferences: { vehicle_id: user.default_vehicle_id ?? last?.vehicle_id ?? null, payment_method: user.payment_method ?? last?.method ?? null } };
  });

  app.put("/v1/me/preferences", { preHandler: driver }, async (req) => {
    const u = currentUser(req);
    const b = parse(z.object({ default_vehicle_id: Uuid.nullable().optional(), payment_method: z.enum(["upi", "card", "netbanking"]).optional() }), req.body);
    if (b.default_vehicle_id) {
      const ok = await deps.db.query("SELECT 1 FROM vehicles WHERE id = $1 AND user_id = $2", [b.default_vehicle_id, u.sub]);
      if (!ok.rowCount) throw new HttpError(404, "vehicle_not_found", "That vehicle isn't on your account.");
    }
    const r = await deps.db.query(
      `UPDATE users SET default_vehicle_id = COALESCE($2, default_vehicle_id), payment_method = COALESCE($3, payment_method)
       WHERE id = $1 RETURNING default_vehicle_id, payment_method`, [u.sub, b.default_vehicle_id ?? null, b.payment_method ?? null]);
    return { preferences: r.rows[0] };
  });

  app.post("/v1/me/vehicles", { preHandler: driver }, async (req, reply) => {
    const u = currentUser(req);
    const b = parse(z.object({ plate: Plate, kind: z.enum(["car", "bike", "ev_car", "suv"]).default("car") }), req.body);
    try {
      const r = await deps.db.query("INSERT INTO vehicles (user_id, plate, kind) VALUES ($1,$2,$3) RETURNING id, plate, kind", [u.sub, b.plate, b.kind]);
      return reply.code(201).send({ vehicle: r.rows[0] });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "duplicate_vehicle", "This vehicle is already on your account.");
      throw e;
    }
  });

  // DRV-08
  app.put("/v1/me/favourites/:lot_id", { preHandler: driver }, async (req, reply) => {
    const u = currentUser(req); const { lot_id } = parse(z.object({ lot_id: Uuid }), req.params);
    const lot = await deps.db.query("SELECT 1 FROM lots WHERE id = $1", [lot_id]);
    if (!lot.rowCount) throw new HttpError(404, "lot_not_found", "This lot isn't available.");
    await deps.db.query("INSERT INTO favourite_lots (user_id, lot_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [u.sub, lot_id]);
    return reply.code(204).send();
  });
  app.delete("/v1/me/favourites/:lot_id", { preHandler: driver }, async (req, reply) => {
    const u = currentUser(req); const { lot_id } = parse(z.object({ lot_id: Uuid }), req.params);
    await deps.db.query("DELETE FROM favourite_lots WHERE user_id = $1 AND lot_id = $2", [u.sub, lot_id]);
    return reply.code(204).send();
  });

  // DPDP erasure request: soft delete now, revoke sessions; a scheduled job scrubs PII after 30 days (invoices kept by law).
  app.delete("/v1/me", { preHandler: driver }, async (req, reply) => {
    const u = currentUser(req);
    await deps.db.query("UPDATE users SET deleted_at = now() WHERE id = $1", [u.sub]);
    await deps.db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [u.sub]);
    return reply.code(202).send({ message: "Your account is deleted. Personal data is removed within 30 days; tax invoices are kept as the law requires." });
  });
}
