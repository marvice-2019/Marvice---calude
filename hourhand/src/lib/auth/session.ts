import { cookies, headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { store, type User } from "@/lib/data";
import { authEnabled, getAuth } from "./auth";
import { getPool } from "@/lib/data/pg-store";
import { canActFor } from "@/lib/seats";

/**
 * The signed-in host, or null. In memory mode (local demo data, no database) it is the seeded host.
 * Every dashboard page and server action calls this itself; middleware is never the only check.
 */
export async function getSignedInUser(): Promise<User | null> {
  if (!authEnabled()) return store.getCurrentUser();
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return store.getUser(session.user.id);
}

/** The signed-in host; anyone else is sent to the sign-in page. */
export async function requireUser(): Promise<User> {
  const user = await getSignedInUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** The cookie that says which owner a Duo second person is managing. Only a hint: every request re-checks the seat. */
export const ACTING_COOKIE = "hh_acting";

export interface HostContext {
  /** Whose account the page works on: the owner while acting, otherwise the signed-in person. */
  host: User;
  /** Who is signed in. */
  actor: User;
  acting: boolean;
}

/** One check per request, however many components ask. */
export const getHostContext = cache(async (): Promise<HostContext | null> => {
  const actor = await getSignedInUser();
  if (!actor) return null;
  const ownerId = authEnabled() ? (await cookies()).get(ACTING_COOKIE)?.value : undefined;
  if (ownerId && ownerId !== actor.id && (await canActFor(getPool(process.env.DATABASE_URL as string), actor.id, ownerId))) {
    const host = await store.getUser(ownerId);
    if (host) return { host, actor, acting: true };
  }
  return { host: actor, actor, acting: false };
});

/**
 * The account a shared page works on. Only the pages a Duo second person may use call this (bookings, availability,
 * event types, links, clients, packages, the public page); everything else calls requireUser and so always
 * works on the signed-in person's own account.
 */
/**
 * For pages that are the signed-in person's alone (plan, settings, integrations, calendars, earnings, invoices): while
 * managing someone else's account, send them to that account's bookings instead of showing their own data under it.
 */
export async function requireOwnAccount(): Promise<User> {
  const ctx = await getHostContext();
  if (!ctx) redirect("/sign-in");
  if (ctx.acting) redirect("/dashboard/bookings");
  return ctx.actor;
}

export async function requireHost(): Promise<User> {
  const ctx = await getHostContext();
  if (!ctx) redirect("/sign-in");
  return ctx.host;
}
