'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api, errorText } from '@/lib/api';

/** Loads JSON from the API; `reload()` refetches. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path).then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [path, n]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) {
  const cls = tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-sky-200 bg-sky-50 text-sky-800';
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[10vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card w-full max-w-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800', PENDING: 'bg-amber-100 text-amber-800', REJECTED: 'bg-red-100 text-red-800',
  published: 'bg-emerald-100 text-emerald-800', draft: 'bg-slate-100 text-slate-700', paused: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800', sending: 'bg-sky-100 text-sky-800', scheduled: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-slate-100 text-slate-500', active: 'bg-emerald-100 text-emerald-800', open: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-100 text-slate-600', failed: 'bg-red-100 text-red-800', paid: 'bg-emerald-100 text-emerald-800',
};
export const StatusBadge = ({ status }: { status: string }) =>
  <span className={`badge ${STATUS_TONE[status] ?? 'bg-slate-100 text-slate-700'}`}>{status.toLowerCase().replace(/_/g, ' ')}</span>;
