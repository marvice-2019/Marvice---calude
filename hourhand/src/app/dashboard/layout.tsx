import Link from "next/link";
import { connection } from "next/server";
import { MobileMenu, NavLinks } from "@/components/DashboardNav";
import { SyncLight } from "@/components/SyncLight";
import { focusRing } from "@/components/ui/focus";
import { store } from "@/lib/data";
import { summarizeSync } from "@/lib/sync";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await connection(); // render per request: the sync light shows minutes since the last check
  const user = await store.getCurrentUser();
  const sync = summarizeSync(await store.listCalendarConnections(user.id), new Date());
  const brand = (
    <Link href="/dashboard/event-types" className={`inline-flex min-h-11 items-center rounded-sm font-display text-lg text-text ${focusRing}`}>
      Hourhand
    </Link>
  );
  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className={`sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-20 focus:rounded-md focus:bg-card focus:p-3 ${focusRing}`}>
        Skip to content
      </a>
      <aside className="hidden border-r border-border bg-surface p-4 lg:block lg:w-(--hh-sidebar) lg:shrink-0">
        {brand}
        <nav aria-label="Main" className="mt-6">
          <NavLinks />
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="relative flex min-h-(--hh-header) items-center justify-between gap-3 border-b border-border px-4 lg:justify-end lg:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <MobileMenu />
            {brand}
          </div>
          <SyncLight status={sync.status} minutesAgo={sync.minutesAgo} />
        </header>
        <main id="main" className="mx-auto max-w-(--hh-content-max) px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
