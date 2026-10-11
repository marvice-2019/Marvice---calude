import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { store, type User } from "@/lib/data";
import { authEnabled, getAuth } from "./auth";

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
