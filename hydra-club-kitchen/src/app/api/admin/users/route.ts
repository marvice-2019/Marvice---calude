import { createUser, deleteUser, listUsers, resetPassword, setRole } from "@/admin/users";
import { requireApiUser } from "@/auth/guard";
import { getDb } from "@/db";
import { BadBody, badBody, json, readJson } from "@/lib/http";

type R = { ok: true } | { ok: false; status: number; message: string };
const respond = (r: R & Record<string, unknown>) => (r.ok ? json(r) : json({ ok: false, message: r.message }, r.status));

/** GET /api/admin/users → staff list (owner only). */
export async function GET(req: Request) {
  const user = await requireApiUser(req, "users:manage");
  if (user instanceof Response) return user;
  return json({ ok: true, users: await listUsers(getDb()) });
}

/** POST { name, email, role, tempPassword } → new account that must change its password. */
export async function POST(req: Request) {
  const user = await requireApiUser(req, "users:manage");
  if (user instanceof Response) return user;
  try {
    return respond(await createUser(getDb(), user.id, await readJson(req)));
  } catch (err) {
    if (err instanceof BadBody) return badBody();
    throw err;
  }
}

/** PATCH { id, role } or { id, tempPassword } → change role or reset password. */
export async function PATCH(req: Request) {
  const user = await requireApiUser(req, "users:manage");
  if (user instanceof Response) return user;
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BadBody) return badBody();
    throw err;
  }
  const db = getDb();
  return respond("tempPassword" in body ? await resetPassword(db, user.id, body) : await setRole(db, user.id, body));
}

/** DELETE ?id= */
export async function DELETE(req: Request) {
  const user = await requireApiUser(req, "users:manage");
  if (user instanceof Response) return user;
  return respond(await deleteUser(getDb(), user.id, new URL(req.url).searchParams.get("id")));
}
