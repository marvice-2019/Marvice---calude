import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../app.js";
import { HttpError, IsoDate, parse, Phone10, Uuid } from "../http.js";
import { promoFor, quoteFor, spotsLeft, type VehicleKind } from "../services.js";

const Vehicle = z.enum(["car", "bike", "ev_car", "suv"]).default("car");
const Range = z.object({ from: IsoDate, to: IsoDate, vehicle: Vehicle })
  .refine(r => r.to > r.from, { message: "Leaving time must be after arrival. Move it later.", path: ["to"] })
  .refine(r => r.to.getTime() - r.from.getTime() <= 30 * 86_400_000, { message: "Bookings run up to 30 days. For longer stays, use Monthly.", path: ["to"] });

export function publicRoutes(app: FastifyInstance, deps: Deps) {
  const fee = deps.cfg.PLATFORM_FEE_PAISE;

  // DRV-01: live lots within 3 km, with quote and spots left.
  app.get("/v1/lots/search", { config: { rateLimit: { max: 60 * deps.cfg.RATE_LIMIT_SCALE, timeWindow: "1 minute" } } }, async (req) => {
    const q = parse(z.object({
      lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180),
      from: IsoDate, to: IsoDate, vehicle: Vehicle, sort: z.enum(["dist", "price", "left"]).default("dist"),
      filters: z.string().default("").transform(s => s.split(",").map(x => x.trim()).filter(Boolean))
        .pipe(z.array(z.enum(["covered", "ev", "valet", "h24", "bike", "saved"])))
    }).and(Range), req.query);
    let userId: string | null = null;
    if (q.filters.includes("saved")) { try { await req.jwtVerify(); userId = (req.user as { sub: string }).sub; } catch { throw new HttpError(401, "unauthenticated", "Sign in to see your saved lots."); } }
    const f = new Set(q.filters);
    const { rows } = await deps.db.query(
      `SELECT l.id, l.name, l.code, l.address, l.kind, l.covered, l.ev_chargers, l.open_24h, l.status,
              ST_Distance(l.geo, ST_MakePoint($2, $1)::geography)::int AS distance_m,
              ST_Y(l.geo::geometry) AS lat, ST_X(l.geo::geometry) AS lng,
              EXISTS (SELECT 1 FROM valet_desks d WHERE d.lot_id = l.id AND d.is_live) AS valet
       FROM lots l
       WHERE l.is_live AND l.status <> 'closed' AND ST_DWithin(l.geo, ST_MakePoint($2, $1)::geography, 3000)
         AND (NOT $3 OR l.covered) AND (NOT $4 OR l.ev_chargers > 0) AND (NOT $5 OR l.open_24h) AND (NOT $6 OR l.capacity_bike > 0)
         AND (NOT $7 OR EXISTS (SELECT 1 FROM valet_desks d WHERE d.lot_id = l.id AND d.is_live))
         AND ($8::uuid IS NULL OR EXISTS (SELECT 1 FROM favourite_lots fl WHERE fl.lot_id = l.id AND fl.user_id = $8))
       ORDER BY distance_m LIMIT 30`, [q.lat, q.lng, f.has("covered"), f.has("ev"), f.has("h24"), f.has("bike"), f.has("valet"), userId]);
    const out = [];
    for (const lot of rows) {
      try {
        const quote = await quoteFor(deps.db, fee, lot.id, q.vehicle as VehicleKind, q.from, q.to, null);
        out.push({ lot, distance_m: lot.distance_m, quote, spots_left: Math.max(0, await spotsLeft(deps.db, lot.id, q.vehicle as VehicleKind, q.from, q.to)) });
      } catch (e) { if (!(e instanceof HttpError && e.code === "no_rate")) throw e; }
    }
    const key = { dist: (a: any, b: any) => a.distance_m - b.distance_m, price: (a: any, b: any) => a.quote.totalPaise - b.quote.totalPaise,
      left: (a: any, b: any) => b.spots_left - a.spots_left }[q.sort];
    return out.sort(key);
  });

  // DRV-09: Park now looks up the code printed on the entrance board.
  app.get("/v1/lots/by-code/:code", async (req) => {
    const { code } = parse(z.object({ code: z.string().transform(s => { const c = s.replace(/[\s-]/g, "").toUpperCase(); return /^\d{3,5}$/.test(c) ? "BLR" + c : c; }) }), req.params);
    const { rows } = await deps.db.query("SELECT id, name, code, address, status FROM lots WHERE code = $1 AND is_live", [code]);
    if (!rows[0]) throw new HttpError(404, "lot_not_found", `No lot with code ${code}. Check the board at the entrance, or pick a lot nearby.`);
    return { lot: rows[0] };
  });

  // DRV-02
  app.get("/v1/lots/:id", async (req) => {
    const { id } = parse(z.object({ id: Uuid }), req.params);
    const q = parse(Range, req.query);
    const { rows } = await deps.db.query(
      `SELECT id, name, code, address, city, kind, covered, ev_chargers, open_24h, opens_at, closes_at, status,
              capacity_car, capacity_bike, ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng
       FROM lots WHERE id = $1 AND is_live`, [id]);
    if (!rows[0]) throw new HttpError(404, "lot_not_found", "This lot isn't available.");
    const quote = await quoteFor(deps.db, fee, id, q.vehicle as VehicleKind, q.from, q.to, null);
    return { lot: rows[0], quote, spots_left: Math.max(0, await spotsLeft(deps.db, id, q.vehicle as VehicleKind, q.from, q.to)) };
  });

  // DRV-02, DRV-06: quote with optional promo; a bad promo returns the plain-language reason, not an error.
  app.post("/v1/quotes", async (req) => {
    const b = parse(z.object({ lot_id: Uuid, from: IsoDate, to: IsoDate, vehicle: Vehicle, promo: z.string().max(20).optional() }), req.body);
    if (b.to <= b.from) throw new HttpError(400, "invalid_request", "Leaving time must be after arrival. Move it later.");
    let userId: string | null = null;
    try { await req.jwtVerify(); userId = (req.user as { sub: string }).sub; } catch { /* anonymous quote */ }
    const { promo, error } = await promoFor(deps.db, b.promo, userId, b.from);
    const quote = await quoteFor(deps.db, fee, b.lot_id, b.vehicle as VehicleKind, b.from, b.to, promo);
    return { ...quote, promo_error: error };
  });

  // OWN-01 (proposed): lot-owner lead form.
  app.post("/v1/leads/owners", { config: { rateLimit: { max: 5 * deps.cfg.RATE_LIMIT_SCALE, timeWindow: "1 hour" } } }, async (req, reply) => {
    const b = parse(z.object({ name: z.string().min(2).max(100), phone: Phone10, address: z.string().min(5).max(300), bays: z.number().int().min(1).max(5000) }), req.body);
    await deps.db.query("INSERT INTO owner_leads (name, phone, address, bays) VALUES ($1, $2, $3, $4)", [b.name, "+91" + b.phone, b.address, b.bays]);
    deps.notify.send({ event: "owner_lead", data: { name: b.name, bays: b.bays } });
    return reply.code(201).send({ ok: true });
  });
}
