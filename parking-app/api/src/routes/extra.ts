import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { currentUser, requireRole } from "../auth.js";
import { HttpError, parse, Uuid } from "../http.js";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export function extraRoutes(app: FastifyInstance, deps: Deps) {
  // DRV-15: destination suggestions (areas, malls, hospitals, stadiums, offices).
  app.get("/v1/destinations", async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().max(60).default("") }), req.query);
    const { rows } = await deps.db.query(
      `SELECT name, kind, ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng FROM destinations
       WHERE $1 = '' OR lower(name) LIKE '%' || lower($1) || '%' OR kind = lower($1)
       ORDER BY (lower(name) LIKE lower($1) || '%') DESC, name LIMIT 8`, [q]);
    return rows;
  });

  // DRV-14, VAL-01, VAL-06: pre-signed upload for a photo (images only, 5 MB max enforced by the signed policy).
  app.post("/v1/uploads", { preHandler: requireRole("driver", "operator_staff", "operator_admin") }, async (req) => {
    const u = currentUser(req);
    const { content_type } = parse(z.object({ content_type: z.string() }), req.body);
    if (!IMAGE_TYPES.includes(content_type)) throw new HttpError(400, "bad_type", "Choose a photo (JPG or PNG).");
    const ext = content_type.split("/")[1];
    return deps.storage.presignUpload(`u/${u.sub}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`, content_type);
  });

  // DRV-14: mark my spot on my own booking (replaces any earlier spot).
  app.post("/v1/bookings/:id/spot", { preHandler: requireRole("driver") }, async (req, reply) => {
    const u = currentUser(req); const { id } = parse(z.object({ id: Uuid }), req.params);
    const b = parse(z.object({ floor: z.string().trim().max(6).optional(), bay: z.string().trim().max(8).optional(),
      note: z.string().trim().max(80).optional(), photo_key: z.string().max(200).optional() }), req.body);
    const clean = { floor: b.floor || null, bay: b.bay || null, note: b.note || null, photo: b.photo_key || null };
    if (!clean.floor && !clean.bay && !clean.note && !clean.photo) throw new HttpError(400, "spot_empty", "Add a floor, bay, note or photo so you can find your car later.");
    if (clean.photo && !clean.photo.startsWith(`u/${u.sub}/`)) throw new HttpError(400, "bad_photo", "That photo isn't one you uploaded.");
    const own = await deps.db.query("SELECT 1 FROM bookings WHERE id = $1 AND user_id = $2", [id, u.sub]);
    if (!own.rowCount) throw new HttpError(404, "booking_not_found", "Booking not found.");
    const r = await deps.db.query(
      `INSERT INTO parked_spots (booking_id, floor, bay, note, photo_url) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO UPDATE SET floor = EXCLUDED.floor, bay = EXCLUDED.bay, note = EXCLUDED.note, photo_url = EXCLUDED.photo_url
       RETURNING floor, bay, note, photo_url`, [id, clean.floor, clean.bay, clean.note, clean.photo]);
    return reply.code(200).send({ spot: r.rows[0] });
  });

  // ACC-02: data export request, at most one per day.
  app.post("/v1/me/data-export", { preHandler: requireRole("driver") }, async (req, reply) => {
    const u = currentUser(req);
    const recent = await deps.db.query("SELECT 1 FROM data_export_requests WHERE user_id = $1 AND requested_at > now() - interval '1 day'", [u.sub]);
    if (recent.rowCount) throw new HttpError(429, "export_pending", "You already asked today. Your export arrives on WhatsApp within 7 days.");
    await deps.db.query("INSERT INTO data_export_requests (user_id) VALUES ($1)", [u.sub]);
    return reply.code(202).send({ message: "Request logged. Your data export arrives on WhatsApp within 7 days." });
  });
}
