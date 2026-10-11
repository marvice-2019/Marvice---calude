"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", tab: "Find parking", short: "Find", match: (p: string) => p === "/" || p.startsWith("/lot") || p.startsWith("/park-now") },
  { href: "/passes", tab: "My passes", short: "Passes", match: (p: string) => p.startsWith("/passes") },
  { href: "/monthly", tab: "Monthly", short: "Monthly", match: (p: string) => p.startsWith("/monthly") },
  { href: "/list-your-space", tab: "List your space", short: "List space", match: (p: string) => p.startsWith("/list-your-space") }
];

/** Top tabs on desktop, bottom tab bar on phones (the CSS switches at 900 px, as in the prototype). */
export function Nav({ variant }: { variant: "tabs" | "bottom" }) {
  const path = usePathname() ?? "/";
  return (
    <nav className={variant} aria-label={variant === "tabs" ? "Main" : "Main (bottom)"}>
      {ITEMS.map(i => (
        <Link key={i.href} href={i.href} aria-current={i.match(path) ? "page" : undefined}>
          {variant === "bottom" && <i aria-hidden="true" />}
          {variant === "tabs" ? i.tab : i.short}
        </Link>
      ))}
    </nav>
  );
}
