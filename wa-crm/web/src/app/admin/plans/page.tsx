'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Modal, PageHeader } from '@/components/ui';
import { errorText, money } from '@/lib/api';
import { adminApi, useAdmin } from '@/lib/admin';

interface Plan { id: string; name: string; slug: string; price_paise: number; billing_cycle: 'monthly' | 'yearly'; razorpay_plan_id: string | null;
  is_active: boolean; limits: Record<string, number>; tenant_count: number }

const RESOURCES = [['contacts', 'Contacts'], ['agents', 'Team members'], ['whatsapp_numbers', 'WhatsApp numbers']] as const;

export default function AdminPlans() {
  const plans = useAdmin<{ data: Plan[] }>('/admin/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Plans" subtitle="Prices exclude GST. A plan can be bought only after it has a Razorpay plan id."
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> New plan</button>} />
      {(error || plans.error) && <div className="mb-3"><Alert>{error ?? plans.error}</Alert></div>}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr><th className="th">Plan</th><th className="th">Price</th><th className="th">Limits</th><th className="th">Razorpay</th><th className="th">Workspaces</th><th className="th" /></tr></thead>
          <tbody>
            {(plans.data?.data ?? []).map((p) => (
              <tr key={p.id} className={p.is_active ? '' : 'opacity-50'}>
                <td className="td"><div className="font-medium">{p.name}</div><div className="text-xs text-muted">{p.slug}{p.is_active ? '' : ' · inactive'}</div></td>
                <td className="td">{money(p.price_paise)} / {p.billing_cycle === 'yearly' ? 'yr' : 'mo'}</td>
                <td className="td text-xs">{Object.entries(p.limits).map(([k, v]) => `${k}: ${v.toLocaleString('en-IN')}`).join(' · ') || 'none'}</td>
                <td className="td text-xs">{p.razorpay_plan_id ?? <span className="text-danger">not linked</span>}</td>
                <td className="td">{p.tenant_count}</td>
                <td className="td whitespace-nowrap text-right text-sm">
                  <button className="mr-3 text-brand" onClick={() => setEditing(p)}>Edit</button>
                  {p.is_active
                    ? <button className="text-danger" onClick={async () => { setError(null); try { await adminApi(`/admin/plans/${p.id}`, { method: 'DELETE' }); plans.reload(); } catch (e) { setError(errorText(e)); } }}>Deactivate</button>
                    : <button className="text-brand" onClick={async () => { await adminApi(`/admin/plans/${p.id}`, { method: 'PATCH', body: { isActive: true } }).catch(() => {}); plans.reload(); }}>Reactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <PlanForm plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); plans.reload(); }} />}
    </>
  );
}

function PlanForm({ plan, onClose, onDone }: { plan: Plan | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: plan?.name ?? '', slug: plan?.slug ?? '', rupees: plan ? String(plan.price_paise / 100) : '', billingCycle: plan?.billing_cycle ?? 'monthly',
    razorpayPlanId: plan?.razorpay_plan_id ?? '', limits: Object.fromEntries(RESOURCES.map(([k]) => [k, plan?.limits[k] !== undefined ? String(plan.limits[k]) : ''])) as Record<string, string>,
  });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const limits = Object.fromEntries(Object.entries(f.limits).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]));
    const body = { name: f.name, slug: f.slug, pricePaise: Math.round(Number(f.rupees) * 100), billingCycle: f.billingCycle,
      razorpayPlanId: f.razorpayPlanId.trim() || null, limits };
    try {
      if (plan) await adminApi(`/admin/plans/${plan.id}`, { method: 'PATCH', body }); else await adminApi('/admin/plans', { body });
      onDone();
    } catch (err) { setError(errorText(err)); }
  }
  return (
    <Modal title={plan ? `Edit ${plan.name}` : 'New plan'} open onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="pn">Name</label><input id="pn" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="ps">Slug</label><input id="ps" className="input" required pattern="[a-z0-9][a-z0-9-]+" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></div>
          <div><label className="label" htmlFor="pp">Price in ₹ (before GST)</label><input id="pp" className="input" required type="number" min="0" step="0.01" value={f.rupees} onChange={(e) => setF({ ...f, rupees: e.target.value })} /></div>
          <div><label className="label" htmlFor="pc">Billing</label>
            <select id="pc" className="input" value={f.billingCycle} onChange={(e) => setF({ ...f, billingCycle: e.target.value as 'monthly' | 'yearly' })}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
        </div>
        <div><label className="label" htmlFor="pr">Razorpay plan id (plan_…)</label><input id="pr" className="input" value={f.razorpayPlanId} onChange={(e) => setF({ ...f, razorpayPlanId: e.target.value })} /></div>
        <fieldset><legend className="label">Limits (empty = unlimited)</legend>
          <div className="grid grid-cols-3 gap-3">{RESOURCES.map(([k, label]) => (
            <div key={k}><label className="label" htmlFor={`l-${k}`}>{label}</label>
              <input id={`l-${k}`} className="input" type="number" min="0" value={f.limits[k]} onChange={(e) => setF({ ...f, limits: { ...f.limits, [k]: e.target.value } })} /></div>))}</div>
        </fieldset>
        <button className="btn btn-primary w-full">{plan ? 'Save plan' : 'Create plan'}</button>
      </form>
    </Modal>
  );
}
