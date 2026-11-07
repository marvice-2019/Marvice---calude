import "server-only";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { isSameOrigin } from "@/lib/origin";
import { loadSessionUser, type SessionUser } from "./core";
import { can, type Permission } from "./roles";

/** The signed-in user, re-read from Postgres. Null if signed out, deleted, or the session predates a password change. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id || typeof session.authAt !== "number") return null;
  return loadSessionUser(getDb(), session.user.id, session.authAt);
}

/** For admin pages and server actions. */
export async function requireUser(permission?: Permission, opts: { allowPasswordChange?: boolean } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  if (user.mustChangePassword && !opts.allowPasswordChange) redirect("/admin/change-password");
  if (permission && !can(user.role, permission)) notFound(); // don't reveal admin areas a role can't use
  return user;
}

/**
 * For /api/admin route handlers. Returns the user, or a Response to send back.
 * Mutations (anything but GET/HEAD) must also pass the same-origin check.
 */
export async function requireApiUser(req: Request, permission: Permission): Promise<SessionUser | Response> {
  if (req.method !== "GET" && req.method !== "HEAD" && !isSameOrigin(req.headers, process.env.NEXT_PUBLIC_SITE_URL)) {
    return Response.json({ error: "bad_origin" }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorised" }, { status: 401 });
  if (user.mustChangePassword) return Response.json({ error: "password_change_required" }, { status: 403 });
  if (!can(user.role, permission)) return Response.json({ error: "forbidden" }, { status: 403 });
  return user;
}
