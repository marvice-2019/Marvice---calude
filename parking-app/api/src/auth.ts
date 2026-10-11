import { createHash, randomBytes, randomInt } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError, parse, Phone10 } from "./http.js";
import type { Deps } from "./app.js";

export type Role = "driver" | "operator_admin" | "operator_staff" | "platform_admin";
export type AuthUser = { sub: string; role: Role };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const OTP_TTL_MIN = 5, OTP_PER_HOUR = 5, OTP_MAX_ATTEMPTS = 5;
const ACCESS_TTL = "15m", REFRESH_DAYS = 30;

export function currentUser(req: FastifyRequest): AuthUser {
  const u = req.user as AuthUser | undefined;
  if (!u) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  return u;
}

/** preHandler factory: verifies JWT and checks role. Drivers include guests (phone-verified users). */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    try { await req.jwtVerify(); } catch { throw new HttpError(401, "unauthenticated", "Sign in to continue."); }
    const u = req.user as AuthUser;
    if (roles.length && !roles.includes(u.role)) throw new HttpError(403, "forbidden", "You don't have access to this.");
  };
}

async function issueTokens(app: FastifyInstance, deps: Deps, userId: string, role: Role) {
  const access = app.jwt.sign({ sub: userId, role } satisfies AuthUser, { expiresIn: ACCESS_TTL });
  const refresh = randomBytes(32).toString("base64url");
  await deps.db.query("INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))",
    [sha(refresh), userId, REFRESH_DAYS]);
  return { access, refresh };
}

export function authRoutes(app: FastifyInstance, deps: Deps) {
  app.post("/v1/auth/otp", { config: { rateLimit: { max: 20 * deps.cfg.RATE_LIMIT_SCALE, timeWindow: "1 hour" } } }, async (req) => {
    const { phone } = parse(z.object({ phone: Phone10 }), req.body);
    const e164 = "+91" + phone;
    const { rows } = await deps.db.query("SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '1 hour'", [e164]);
    if (rows[0].n >= OTP_PER_HOUR) throw new HttpError(429, "otp_rate_limited", "Too many attempts. Try again in an hour.");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await deps.db.query("INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))",
      [e164, sha(e164 + code), OTP_TTL_MIN]);
    await deps.otp.send(e164, code);
    return { sent: true };
  });

  app.post("/v1/auth/verify", async (req) => {
    const { phone, otp } = parse(z.object({ phone: Phone10, otp: z.string().regex(/^\d{6}$/) }), req.body);
    const e164 = "+91" + phone;
    const { rows } = await deps.db.query(
      "SELECT id, code_hash, attempts FROM otp_codes WHERE phone = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1", [e164]);
    const row = rows[0];
    if (!row || row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(401, "otp_invalid", "That code has expired. Request a new one.");
    if (row.code_hash !== sha(e164 + otp)) {
      await deps.db.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1", [row.id]);
      throw new HttpError(401, "otp_invalid", "That code doesn't match. Check the SMS and try again.");
    }
    await deps.db.query("UPDATE otp_codes SET used_at = now() WHERE id = $1", [row.id]);
    // Same phone always maps to the same user, so guest passes carry over (GST-02).
    const u = await deps.db.query(
      `INSERT INTO users (phone) VALUES ($1)
       ON CONFLICT (phone) DO UPDATE SET deleted_at = NULL WHERE users.deleted_at IS NULL
       RETURNING id, role, phone, full_name`, [e164]);
    const user = u.rows[0] ?? (await deps.db.query("SELECT id, role, phone, full_name, deleted_at FROM users WHERE phone = $1", [e164])).rows[0];
    if (user.deleted_at) throw new HttpError(403, "account_deleted", "This account was deleted. Contact support to restore it.");
    return { ...(await issueTokens(app, deps, user.id, user.role)), user: { id: user.id, phone: user.phone, role: user.role, full_name: user.full_name } };
  });

  app.post("/v1/auth/refresh", async (req) => {
    const { refresh } = parse(z.object({ refresh: z.string().min(20) }), req.body);
    const { rows } = await deps.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING user_id`, [sha(refresh)]);
    if (!rows[0]) throw new HttpError(401, "refresh_invalid", "Your session ended. Sign in again.");
    const u = (await deps.db.query("SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL", [rows[0].user_id])).rows[0];
    if (!u) throw new HttpError(401, "refresh_invalid", "Your session ended. Sign in again.");
    const { access, refresh: next } = await issueTokens(app, deps, u.id, u.role);
    return { access, refresh: next };
  });
}
