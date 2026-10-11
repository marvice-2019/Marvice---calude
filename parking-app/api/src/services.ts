import type pg from "pg";
import { HttpError } from "./http.js";
import { istWeekday, quote, type Promo, type Quote } from "./pricing.js";

type Q = pg.Pool | pg.PoolClient;
export type VehicleKind = "car" | "bike" | "ev_car" | "suv";
/** Rate cards exist for 'car' and 'bike'; EVs and SUVs pay the car rate in the MVP. */
export const rateKind = (k: VehicleKind) => (k === "bike" ? "bike" : "car");

export async function rateFor(q: Q, lotId: string, kind: VehicleKind, at: Date) {
  const { rows } = await q.query(
    `SELECT hourly_paise, daily_cap_paise, monthly_paise FROM lot_rates
     WHERE lot_id = $1 AND vehicle = $2 AND valid @> $3::timestamptz`, [lotId, rateKind(kind), at]);
  if (!rows[0]) throw new HttpError(404, "no_rate", "This lot has no price for that vehicle and time yet.");
  return rows[0] as { hourly_paise: number; daily_cap_paise: number | null; monthly_paise: number | null };
}

/** Validates a promo for this user and arrival. Returns the promo, or an error message for the UI (DRV-06). */
export async function promoFor(q: Q, raw: string | undefined, userId: string | null, arrive: Date): Promise<{ promo: Promo | null; error: string | null }> {
  const code = (raw ?? "").trim().toUpperCase();
  if (!code) return { promo: null, error: null };
  const { rows } = await q.query(
    `SELECT * FROM promo_codes WHERE code = $1 AND valid @> now() AND (max_uses IS NULL OR used_count < max_uses)`, [code]);
  const p = rows[0];
  if (!p) return { promo: null, error: `${code} isn't a valid code. Check the spelling, or try FIRST50.` };
  if (p.first_booking_only && userId) {
    const prior = await q.query(
      `SELECT 1 FROM bookings WHERE user_id = $1 AND status IN ('confirmed','checked_in','completed') LIMIT 1`, [userId]);
    if (prior.rowCount) return { promo: null, error: `${code} works on your first booking only.` };
  }
  if (p.weekend_only && ![0, 6].includes(istWeekday(arrive)))
    return { promo: null, error: `${code} works only when you arrive on a Saturday or Sunday.` };
  return { promo: { code, percentOff: p.percent_off, maxOffPaise: p.max_off_paise }, error: null };
}

export async function quoteFor(q: Q, feePaise: number, lotId: string, kind: VehicleKind, from: Date, to: Date, promo: Promo | null): Promise<Quote> {
  const r = await rateFor(q, lotId, kind, from);
  return quote(r.hourly_paise, from, to, feePaise, promo, r.daily_cap_paise);
}

/** Spots still sellable online for a period (mirrors book_bay's capacity rule). */
export async function spotsLeft(q: Q, lotId: string, kind: VehicleKind, from: Date, to: Date, excludeBooking?: string) {
  const { rows } = await q.query(
    `SELECT floor(CASE WHEN $2 = 'bike' THEN capacity_bike ELSE capacity_car END * online_share)::int
            - (SELECT count(*)::int FROM bookings b
               WHERE b.lot_id = l.id AND b.period && tstzrange($3, $4)
                 AND (b.vehicle = 'bike') = ($2 = 'bike')
                 AND ($5::uuid IS NULL OR b.id <> $5::uuid)
                 AND (b.status IN ('confirmed','checked_in') OR (b.status = 'pending_payment' AND b.hold_expires_at > now()))) AS left
     FROM lots l WHERE l.id = $1`, [lotId, rateKind(kind), from, to, excludeBooking ?? null]);
  return (rows[0]?.left as number | undefined) ?? 0;
}

export async function audit(q: Q, actorId: string, action: string, entity: string, entityId: string, before: unknown, after: unknown) {
  await q.query("INSERT INTO audit_log (actor_id, action, entity, entity_id, before, after) VALUES ($1,$2,$3,$4,$5,$6)",
    [actorId, action, entity, entityId, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)]);
}

/** Staff and operator admins may act only on lots of their own operator. */
export async function assertLotMember(q: Q, userId: string, lotId: string, roles: string[]) {
  const { rows } = await q.query(
    `SELECT m.role FROM lots l JOIN operator_members m ON m.operator_id = l.operator_id
     WHERE l.id = $1 AND m.user_id = $2`, [lotId, userId]);
  if (!rows[0] || !roles.includes(rows[0].role)) throw new HttpError(403, "forbidden", "You don't have access to this lot.");
}
