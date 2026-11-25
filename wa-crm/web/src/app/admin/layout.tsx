'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@/lib/api';
import { adminToken } from '@/lib/admin';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const isLogin = path === '/admin/login';
  useEffect(() => {
    if (isLogin) { setOk(true); return; }
    if (!adminToken.get()) router.replace('/admin/login'); else setOk(true);
  }, [isLogin, router]);
  if (!ok) return null;
  if (isLogin) return <>{children}</>;
  const tabs = [['/admin', 'Overview'], ['/admin/plans', 'Plans']] as const;
  return (
    <div className="min-h-full">
      <header className="border-b border-line bg-ink text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <span className="font-semibold">{APP_NAME} · Platform admin</span>
          <nav className="flex gap-4 text-sm">{tabs.map(([href, label]) =>
            <Link key={href} href={href} className={path === href ? 'text-white' : 'text-slate-400 hover:text-white'}>{label}</Link>)}</nav>
          <button className="ml-auto text-sm text-slate-300 hover:text-white" onClick={() => { adminToken.clear(); router.replace('/admin/login'); }}>Sign out</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
