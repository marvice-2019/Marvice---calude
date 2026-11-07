import type { Metadata } from "next";
import { requireUser } from "@/auth/guard";
import { can, PERMISSIONS, type Permission } from "@/auth/roles";
import { logoutAction } from "../actions";

export const metadata: Metadata = { title: "Admin" };

// Placeholder dashboard until stage 5 builds Today, Bookings, Holds, Photos, Menu, Nights, Settings, Users.
export default async function AdminHome() {
  const user = await requireUser("bookings:read");
  const allowed = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(user.role, p));
  return (
    <main className="admin-card">
      <h1>Hi {user.name}</h1>
      <p>
        Signed in as {user.email} ({user.role}).
      </p>
      <p>You can: {allowed.join(", ")}</p>
      <form action={logoutAction}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
