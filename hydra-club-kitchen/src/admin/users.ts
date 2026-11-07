import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { credentialsSchema } from "@/auth/core";
import { hashPassword, passwordSchema } from "@/auth/password";
import { ROLES } from "@/auth/roles";
import type { Db } from "@/db/client";
import { auditLog, users } from "@/db/schema";

/**
 * Staff accounts (owner only). Every change is audited; audit rows never hold
 * passwords or hashes. Guards: you can't demote or delete yourself, and the
 * last owner can't be removed or demoted.
 */
export type StaffUser = { id: string; email: string; name: string; role: (typeof ROLES)[number]; lastLoginAt: string | null; mustChangePassword: boolean };
type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; status: number; message: string };

const fail = (status: number, message: string) => ({ ok: false as const, status, message });

export async function listUsers(db: Db): Promise<StaffUser[]> {
  const rows = await db.select().from(users).orderBy(asc(users.role), asc(users.name));
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    mustChangePassword: u.mustChangePassword,
  }));
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Add a name.").max(80),
  email: credentialsSchema.shape.email,
  role: z.enum(ROLES),
  tempPassword: passwordSchema,
});

export async function createUser(db: Db, actorId: string, raw: unknown): Promise<Result<{ user: StaffUser }>> {
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Check the form.");
  const { name, email, role, tempPassword } = parsed.data;
  const [row] = await db
    .insert(users)
    .values({ name, email, role, passwordHash: await hashPassword(tempPassword), mustChangePassword: true })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (!row) return fail(409, "Someone already uses that email.");
  await audit(db, actorId, "user.create", row.id, { email, role });
  return { ok: true, user: (await listUsers(db)).find((u) => u.id === row.id)! };
}

async function ownerCount(db: Db) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "owner"));
  return r!.n;
}

const roleSchema = z.object({ id: z.uuid(), role: z.enum(ROLES) });

export async function setRole(db: Db, actorId: string, raw: unknown): Promise<Result> {
  const parsed = roleSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "Bad request.");
  const { id, role } = parsed.data;
  if (id === actorId) return fail(409, "You can't change your own role.");
  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) return fail(404, "User not found.");
  if (target.role === role) return { ok: true };
  if (target.role === "owner" && (await ownerCount(db)) <= 1) return fail(409, "Hydra needs at least one owner.");
  await db.update(users).set({ role }).where(eq(users.id, id));
  await audit(db, actorId, "user.role", id, { role: { from: target.role, to: role } });
  return { ok: true };
}

const resetSchema = z.object({ id: z.uuid(), tempPassword: passwordSchema });

/** New temporary password; the user must change it at next sign-in and all their sessions end now. */
export async function resetPassword(db: Db, actorId: string, raw: unknown): Promise<Result> {
  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Bad request.");
  const { id, tempPassword } = parsed.data;
  const [updated] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true, passwordChangedAt: sql`now()` })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!updated) return fail(404, "User not found.");
  await audit(db, actorId, "user.reset_password", id, null);
  return { ok: true };
}

export async function deleteUser(db: Db, actorId: string, rawId: unknown): Promise<Result> {
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return fail(400, "Bad request.");
  if (id.data === actorId) return fail(409, "You can't delete your own account.");
  const [target] = await db.select().from(users).where(eq(users.id, id.data));
  if (!target) return fail(404, "User not found.");
  if (target.role === "owner" && (await ownerCount(db)) <= 1) return fail(409, "Hydra needs at least one owner.");
  await db.delete(users).where(and(eq(users.id, id.data), ne(users.id, actorId)));
  await audit(db, actorId, "user.delete", id.data, { email: target.email, role: target.role });
  return { ok: true };
}

async function audit(db: Db, userId: string, action: string, entityId: string, diff: Record<string, unknown> | null) {
  await db.insert(auditLog).values({ userId, action, entity: "user", entityId, diff });
}
