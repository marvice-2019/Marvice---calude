import Link from "next/link";
import { requireUser } from "@/auth/guard";
import { can } from "@/auth/roles";
import { AdminToasts } from "@/components/admin/client";
import { Emblem } from "@/components/Emblem";
import { logoutAction } from "../actions";
import { ADMIN_NAV } from "./nav";

/** Signed-in admin shell: sidebar on desktop, scrollable tab bar on phones. Each page still checks its own permission. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav = ADMIN_NAV.filter((n) => can(user.role, n.permission));
  return (
    <AdminToasts>
      <div className="lg:grid lg:min-h-dvh lg:grid-cols-[220px_1fr]">
        <aside className="hidden border-r border-line bg-surface p-4 lg:flex lg:flex-col">
          <Link href="/admin" className="flex min-h-11 items-center gap-2 font-display text-xl tracking-[-0.05em]">
            <Emblem className="size-7 text-aqua" /> Hydra admin
          </Link>
          <nav aria-label="Admin" className="mt-6 flex flex-col gap-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="flex min-h-11 items-center rounded-lg px-3 text-muted hover:bg-surface2 hover:text-text">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto text-sm text-muted">
            <p>
              {user.name} · {user.role}
            </p>
            <form action={logoutAction}>
              <button type="submit" className="mt-2 min-h-11 underline underline-offset-4">
                Sign out
              </button>
            </form>
          </div>
        </aside>
        <div className="min-w-0 pb-24 lg:pb-0">
          <header className="flex items-center justify-between border-b border-line px-4 py-3 lg:hidden">
            <Link href="/admin" className="flex min-h-11 items-center gap-2 font-display text-lg tracking-[-0.05em]">
              <Emblem className="size-7 text-aqua" /> Admin
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="min-h-11 text-sm text-muted underline underline-offset-4">
                Sign out
              </button>
            </form>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</main>
        </div>
        <nav aria-label="Admin" className="fixed inset-x-0 bottom-0 z-40 flex gap-1 overflow-x-auto border-t border-line bg-bg/95 px-2 py-2 backdrop-blur lg:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm text-muted">
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </AdminToasts>
  );
}
