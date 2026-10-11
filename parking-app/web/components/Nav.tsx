"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Five destinations everywhere: top links on desktop, a thumb-reach tab bar on phones (SPEC §4).
const TABS = [
  { href: "/", label: "Find", d: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3" },
  { href: "/valet", label: "Valet", d: "M5 17h14M6 17l1.5-5h9L18 17M8 12l1-3h6l1 3M7 20v-3m10 3v-3" },
  { href: "/passes", label: "Passes", d: "M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4zM14 7v12" },
  { href: "/monthly", label: "Monthly", d: "M5 5h14v15H5zM5 10h14M9 3v4m6-4v4" },
  { href: "/account", label: "Account", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0" }
];

const active = (path: string, href: string) => (href === "/" ? path === "/" || path.startsWith("/lots") || path.startsWith("/parking") : path.startsWith(href));

export function Header() {
  const path = usePathname();
  return (
    <header className="top">
      <Link href="/" className="brand" aria-label="Bayline home"><span className="psign" aria-hidden>P</span>Bayline</Link>
      <nav className="toplinks" aria-label="Main">
        {TABS.map(t => <Link key={t.href} href={t.href} aria-current={active(path, t.href) ? "page" : undefined}>{t.label}</Link>)}
        <Link href="/list-your-space" aria-current={path.startsWith("/list-your-space") ? "page" : undefined}>List your space</Link>
      </nav>
    </header>
  );
}

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map(t => (
        <Link key={t.href} href={t.href} aria-current={active(path, t.href) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden><path d={t.d} /></svg>{t.label}
        </Link>
      ))}
    </nav>
  );
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    addEventListener("online", sync); addEventListener("offline", sync);
    return () => { removeEventListener("online", sync); removeEventListener("offline", sync); };
  }, []);
  return offline ? <div className="offline" role="status">You&apos;re offline. Your passes still show; booking needs a connection.</div> : null;
}
