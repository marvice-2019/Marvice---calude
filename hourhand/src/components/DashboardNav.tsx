"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { focusRing } from "./ui/focus";

const items = [
  { href: "/dashboard/bookings", label: "Bookings" },
  { href: "/dashboard/clients", label: "Clients" },
  { href: "/dashboard/profile", label: "Your page" },
  { href: "/dashboard/event-types", label: "Event types" },
  { href: "/dashboard/links", label: "Links" },
  { href: "/dashboard/packages", label: "Packages" },
  { href: "/dashboard/earnings", label: "Earnings" },
  { href: "/dashboard/invoices", label: "Invoices" },
  { href: "/dashboard/availability", label: "Availability" },
  { href: "/dashboard/calendars", label: "Calendars" },
  { href: "/dashboard/integrations", label: "Integrations" },
  { href: "/dashboard/plan", label: "Plan" },
  { href: "/dashboard/settings", label: "Settings" },
];

/** Pages a Duo second person can use while managing the owner's account; the rest stay the owner's alone. */
const SHARED = new Set(["/dashboard/bookings", "/dashboard/clients", "/dashboard/profile", "/dashboard/event-types", "/dashboard/links", "/dashboard/packages", "/dashboard/availability"]);

export function NavLinks({ onNavigate, acting = false }: { onNavigate?: () => void; acting?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {items.filter((item) => !acting || SHARED.has(item.href)).map((item) => {
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
export function MobileMenu({ acting = false }: { acting?: boolean }) {
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
          <NavLinks acting={acting} onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </div>
  );
}
