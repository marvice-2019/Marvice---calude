import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { consume } from "@/lib/rate-limit";
import { burnVerifyTime, hashPassword, passwordSchema, verifyPassword } from "./password";
import type { Role } from "./roles";

export type SessionUser = { id: string; email: string; name: string; role: Role; mustChangePassword: boolean };

export const LOGIN_LIMITS = {
  perEmail: { limit: 10, windowSec: 15 * 60 },
  perIp: { limit: 30, windowSec: 15 * 60 },
};

export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email().max(254)),
  password: z.string().min(1).max(128),
});

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; reason: "invalid" | "rate_limited" };

/** The whole credentials check, independent of Auth.js so it can be tested directly. */
export async function authenticate(db: Db, raw: unknown, ip: string): Promise<LoginResult> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const { email, password } = parsed.data;

  const byIp = await consume(db, `login:ip:${ip}`, LOGIN_LIMITS.perIp.limit, LOGIN_LIMITS.perIp.windowSec);
  const byEmail = await consume(db, `login:email:${email}`, LOGIN_LIMITS.perEmail.limit, LOGIN_LIMITS.perEmail.windowSec);
  if (!byIp.ok || !byEmail.ok) {
    await audit(db, null, "auth.login_rate_limited", "user", email);
    return { ok: false, reason: "rate_limited" };
  }

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    await burnVerifyTime(password);
    await audit(db, null, "auth.login_failed", "user", email);
    return { ok: false, reason: "invalid" };
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    await audit(db, user.id, "auth.login_failed", "user", user.id);
    return { ok: false, reason: "invalid" };
  }

  await db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, user.id));
  await audit(db, user.id, "auth.login", "user", user.id);
  return { ok: true, user: toSessionUser(user) };
}

/**
 * A session is valid only if its user still exists and it was issued after the
 * last password change. Role and the forced-change flag always come from the DB,
 * so demoting or deleting a user takes effect on their next request.
 * `authAtMs` is the sign-in time in milliseconds. Millisecond precision matters: a
 * whole-second comparison let a session survive a password change made in the same second.
 */
export async function loadSessionUser(db: Db, userId: string, authAtMs: number): Promise<SessionUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  if (user.passwordChangedAt && authAtMs <= user.passwordChangedAt.getTime()) return null;
  return toSessionUser(user);
}

export const changePasswordSchema = z
  .object({ current: z.string().min(1).max(128), next: passwordSchema, confirm: z.string().max(128) })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "The two new passwords do not match." })
  .refine((v) => v.next !== v.current, { path: ["next"], message: "Choose a different password from the current one." });

export type ChangePasswordResult = { ok: true } | { ok: false; errors: Record<string, string> };

export async function changePassword(db: Db, userId: string, raw: unknown): Promise<ChangePasswordResult> {
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, errors };
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(user.passwordHash, parsed.data.current))) {
    return { ok: false, errors: { current: "Current password is wrong." } };
  }
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(parsed.data.next),
      mustChangePassword: false,
      passwordChangedAt: sql`now()`,
    })
    .where(eq(users.id, userId));
  await audit(db, userId, "auth.password_changed", "user", userId);
  return { ok: true };
}

/**
 * First-run bootstrap: if there are no users, create the owner from
 * ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD with a forced password change.
 * Does nothing once any user exists, so the env value is single-use.
 */
export async function ensureOwner(
  db: Db,
  env: { ADMIN_SEED_EMAIL?: string; ADMIN_SEED_PASSWORD?: string },
): Promise<"created" | "exists" | "skipped"> {
  const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from users`);
  if (rows[0]!.n > 0) return "exists";
  if (!env.ADMIN_SEED_EMAIL || !env.ADMIN_SEED_PASSWORD) return "skipped";
  const email = credentialsSchema.shape.email.parse(env.ADMIN_SEED_EMAIL);
  const initial = passwordSchema.parse(env.ADMIN_SEED_PASSWORD);
  const [owner] = await db
    .insert(users)
    .values({ email, name: "Owner", passwordHash: await hashPassword(initial), role: "owner", mustChangePassword: true })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (owner) await audit(db, null, "auth.owner_bootstrapped", "user", owner.id);
  return "created";
}

function toSessionUser(u: typeof users.$inferSelect): SessionUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword };
}

async function audit(db: Db, userId: string | null, action: string, entity: string, entityId: string) {
  await db.insert(auditLog).values({ userId, action, entity, entityId });
}
