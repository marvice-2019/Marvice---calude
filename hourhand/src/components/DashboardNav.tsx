"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { focusRing } from "./ui/focus";

const items = [
  { href: "/dashboard/bookings", label: "Bookings" },
  { href: "/dashboard/event-types", label: "Event types" },
  { href: "/dashboard/availability", label: "Availability" },
  { href: "/dashboard/calendars", label: "Calendars" },
  { href: "/dashboard/integrations", label: "Integrations" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-md px-3 text-sm ${current ? "bg-surface font-semibold text-text" : "text-text-muted hover:bg-surface hover:text-text"} ${focusRing}`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Below 1024px the sidebar collapses into this menu in the top bar. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-text hover:bg-surface ${focusRing}`}
      >
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="absolute inset-x-0 top-full z-10 border-b border-border bg-bg p-4 shadow-pop">
          <NavLinks onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </div>
  );
}
