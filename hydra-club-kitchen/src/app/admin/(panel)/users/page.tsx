import type { Metadata } from "next";
import { listUsers } from "@/admin/users";
import { requireUser } from "@/auth/guard";
import { NewUserForm, UserControls } from "@/components/admin/forms";
import { getDb } from "@/db";

export const metadata: Metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/** §8 Users (owner only). */
export default async function UsersPage() {
  const me = await requireUser("users:manage");
  const people = await listUsers(getDb());
  return (
    <>
      <h1 className="font-display text-3xl tracking-[-0.04em]">Staff</h1>
      <ul className="mt-5 grid gap-2">
        {people.map((u) => (
          <li key={u.id} className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="font-semibold">
                {u.name} <span className="text-sm font-normal text-muted">· {u.role}</span>
              </p>
              <p className="text-sm text-muted">
                {u.email} · {u.lastLoginAt ? `last in ${new Date(u.lastLoginAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}` : "never signed in"}
                {u.mustChangePassword ? " · must set a new password" : ""}
              </p>
            </div>
            <UserControls id={u.id} role={u.role} isSelf={u.id === me.id} />
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <NewUserForm />
      </div>
    </>
  );
}
