'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bot, CreditCard, FileText, KanbanSquare, LogOut, Megaphone, Menu, MessageSquare, Settings, Users, UsersRound } from 'lucide-react';
import { APP_NAME } from '@/lib/api';
import { useSession } from '@/lib/session';

const NAV = [
  { href: '/inbox', label: 'Inbox', icon: MessageSquare, roles: ['owner', 'admin', 'agent'] },
  { href: '/contacts', label: 'Contacts', icon: UsersRound, roles: ['owner', 'admin', 'agent'] },
  { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare, roles: ['owner', 'admin', 'agent'] },
  { href: '/templates', label: 'Templates', icon: FileText, roles: ['owner', 'admin', 'agent'] },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone, roles: ['owner', 'admin'] },
  { href: '/flows', label: 'Automation', icon: Bot, roles: ['owner', 'admin'] },
  { href: '/team', label: 'Team', icon: Users, roles: ['owner', 'admin'] },
  { href: '/settings', label: 'Settings', icon: Settings, roles: ['owner', 'admin'] },
  { href: '/billing', label: 'Billing', icon: CreditCard, roles: ['owner', 'admin'] },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { principal, ready, signOut } = useSession();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { if (ready && !principal) router.replace('/login'); }, [ready, principal, router]);
  useEffect(() => setOpen(false), [path]);
  if (!ready || !principal) return <div className="grid h-full place-items-center text-sm text-muted">Loading…</div>;

  const items = NAV.filter((n) => (n.roles as readonly string[]).includes(principal.role));
  return (
    <div className="flex h-full">
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 border-r border-line bg-white transition-transform md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand font-bold text-white">{APP_NAME[0]}</span>
          <span className="font-semibold">{APP_NAME}</span>
        </div>
        <nav className="space-y-0.5 p-3" aria-label="Main">
          {items.map(({ href, label, icon: Icon }) => {
            const active = path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? 'bg-brand-soft font-medium text-brand-dark' : 'text-ink hover:bg-canvas'}`}>
                <Icon size={18} aria-hidden /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-line p-3">
          <div className="mb-2 px-3 text-xs text-muted">Signed in as <span className="font-medium capitalize text-ink">{principal.role}</span></div>
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink hover:bg-canvas"><LogOut size={18} aria-hidden /> Sign out</button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-ink/30 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center border-b border-line bg-white px-4 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="p-1"><Menu size={20} /></button>
          <span className="ml-3 font-semibold">{APP_NAME}</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
