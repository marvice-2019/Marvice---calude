'use client';

import { useState } from 'react';
import { Alert, PageHeader, StatusBadge } from '@/components/ui';
import { errorText, tokenStore, when } from '@/lib/api';
import { adminApi, useAdmin } from '@/lib/admin';

interface Stats { tenants_by_status: { active: number; suspended: number }; total_contacts: number;
  messages_last_30d: { inbound: number; outbound: number }; new_tenants_last_30d?: number }
interface Tenant { id: string; name: string; status: string; plan_id: string | null; plan_name: string | null; owner_email: string | null;
  created_at: string; contact_count: number; member_count: number }
interface Plan { id: string; name: string; is_active: boolean }

export default function AdminOverview() {
  const stats = useAdmin<Stats>('/admin/stats');
  const plans = useAdmin<{ data: Plan[] }>('/admin/plans');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = new URLSearchParams({ ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status } : {}) });
  const tenants = useAdmin<{ data: Tenant[]; total: number }>(`/admin/tenants?${q}`);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); tenants.reload(); stats.reload(); } catch (e) { setError(errorText(e)); } };

  async function loginAs(t: Tenant) {
    if (!confirm(`Open ${t.name} as its owner for 15 minutes? This is recorded in the audit log.`)) return;
    try {
      const r = await adminApi<{ token: string }>(`/admin/tenants/${t.id}/impersonate`, { body: {} });
      tokenStore.set(r.token);
      window.open('/inbox', '_blank', 'noopener');
    } catch (e) { setError(errorText(e)); }
  }

  const s = stats.data;
  const cards = s ? [
    ['Active workspaces', s.tenants_by_status.active], ['Suspended', s.tenants_by_status.suspended],
    ['Contacts', s.total_contacts], ['Messages in (30 days)', s.messages_last_30d.inbound], ['Messages out (30 days)', s.messages_last_30d.outbound],
  ] as const : [];
  return (
    <>
      <PageHeader title="Overview" />
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map(([label, v]) => <div key={label} className="card p-4"><div className="text-xs text-muted">{label}</div><div className="mt-1 text-2xl font-semibold">{v.toLocaleString('en-IN')}</div></div>)}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">Workspaces {tenants.data && <span className="font-normal text-muted">({tenants.data.total})</span>}</h2>
        <input className="input w-64" placeholder="Search name or owner email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search workspaces" />
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
      </div>
      {(error || tenants.error) && <div className="mb-3"><Alert>{error ?? tenants.error}</Alert></div>}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr><th className="th">Workspace</th><th className="th">Plan</th><th className="th">Status</th><th className="th">Contacts</th><th className="th">Team</th><th className="th">Created</th><th className="th" /></tr></thead>
          <tbody>
            {(tenants.data?.data ?? []).map((t) => (
              <tr key={t.id}>
                <td className="td"><div className="font-medium">{t.name}</div><div className="text-xs text-muted">{t.owner_email ?? '—'}</div></td>
                <td className="td">
                  <select className="input w-auto" aria-label={`Plan for ${t.name}`} value={t.plan_id ?? ''}
                    onChange={(e) => act(() => adminApi(`/admin/tenants/${t.id}`, { method: 'PATCH', body: { planId: e.target.value || null } }))}>
                    <option value="">No plan</option>
                    {(plans.data?.data ?? []).filter((p) => p.is_active || p.id === t.plan_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td className="td"><StatusBadge status={t.status} /></td>
                <td className="td">{t.contact_count.toLocaleString('en-IN')}</td>
                <td className="td">{t.member_count}</td>
                <td className="td text-muted">{when(t.created_at)}</td>
                <td className="td whitespace-nowrap text-right text-sm">
                  <button className="mr-3 text-brand" onClick={() => loginAs(t)}>Log in as</button>
                  {t.status === 'active'
                    ? <button className="text-danger" onClick={() => { if (confirm(`Suspend ${t.name}? Their team loses access until reactivated.`)) void act(() => adminApi(`/admin/tenants/${t.id}`, { method: 'PATCH', body: { status: 'suspended' } })); }}>Suspend</button>
                    : <button className="text-brand" onClick={() => act(() => adminApi(`/admin/tenants/${t.id}`, { method: 'PATCH', body: { status: 'active' } }))}>Reactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
