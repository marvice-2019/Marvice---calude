'use client';

import { useState } from 'react';
import { Alert, PageHeader, StatusBadge, useApi } from '@/components/ui';
import { api, errorText, money, when } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Plan { id: string; name: string; price_paise: number; billing_cycle: string; purchasable: boolean; limits: Record<string, number> }
interface Sub { status: string; plan_name: string; price_paise: number; billing_cycle: string; current_period_end: string | null; short_url: string | null }
interface Invoice { id: string; number: string; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number; status: string; issued_at: string }

const LIMIT_NAMES: Record<string, string> = { contacts: 'contacts', agents: 'team members', whatsapp_numbers: 'WhatsApp numbers' };

export default function BillingPage() {
  const { principal } = useSession();
  const plans = useApi<{ data: Plan[] }>('/billing/plans');
  const sub = useApi<{ data: Sub | null }>('/billing/subscription');
  const invoices = useApi<{ data: Invoice[] }>('/billing/invoices');
  const [error, setError] = useState<string | null>(null);

  async function subscribe(planId: string) {
    setError(null);
    try {
      const r = await api<{ shortUrl: string | null }>('/billing/subscribe', { body: { planId } });
      if (r.shortUrl) window.location.href = r.shortUrl;
    } catch (e) { setError(errorText(e)); }
  }

  const s = sub.data?.data;
  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Billing" subtitle="Prices exclude 18% GST. Invoices show CGST + SGST or IGST based on your state." />
      {error && <Alert>{error}</Alert>}
      <section className="card p-5">
        <h2 className="mb-2 font-semibold">Current plan</h2>
        {s ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-lg font-semibold">{s.plan_name}</span><StatusBadge status={s.status} />
            <span className="text-muted">{money(s.price_paise)} + GST / {s.billing_cycle === 'yearly' ? 'year' : 'month'}</span>
            {s.current_period_end && <span className="text-muted">Renews {when(s.current_period_end)}</span>}
            {s.short_url && ['created', 'pending', 'halted'].includes(s.status) && <a className="btn btn-primary" href={s.short_url}>Complete payment</a>}
          </div>
        ) : <p className="text-sm text-muted">No paid plan yet.</p>}
      </section>
      <section>
        <h2 className="mb-3 font-semibold">Plans</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(plans.data?.data ?? []).map((p) => (
            <article key={p.id} className="card flex flex-col p-5">
              <h3 className="font-semibold">{p.name}</h3>
              <p className="my-2 text-2xl font-semibold">{money(p.price_paise)}<span className="text-sm font-normal text-muted"> + GST / {p.billing_cycle === 'yearly' ? 'yr' : 'mo'}</span></p>
              <ul className="mb-4 flex-1 space-y-1 text-sm text-muted">
                {Object.entries(p.limits).map(([k, v]) => <li key={k}>Up to {v.toLocaleString('en-IN')} {LIMIT_NAMES[k] ?? k}</li>)}
                {Object.keys(p.limits).length === 0 && <li>No limits</li>}
              </ul>
              {principal?.role === 'owner' && <button className="btn btn-primary" disabled={!p.purchasable} onClick={() => subscribe(p.id)}>Choose {p.name}</button>}
            </article>
          ))}
        </div>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="px-4 pt-4 font-semibold">Invoices</h2>
        <table className="mt-2 w-full">
          <thead><tr><th className="th">Invoice</th><th className="th">Date</th><th className="th">Taxable</th><th className="th">GST</th><th className="th">Total</th><th className="th">Status</th></tr></thead>
          <tbody>
            {(invoices.data?.data ?? []).map((i) => (
              <tr key={i.id}>
                <td className="td font-medium">{i.number}</td><td className="td">{when(i.issued_at)}</td><td className="td">{money(i.taxable_paise)}</td>
                <td className="td">{i.igst_paise ? `IGST ${money(i.igst_paise)}` : `CGST ${money(i.cgst_paise)} + SGST ${money(i.sgst_paise)}`}</td>
                <td className="td font-medium">{money(i.total_paise)}</td><td className="td"><StatusBadge status={i.status} /></td>
              </tr>
            ))}
            {invoices.data?.data.length === 0 && <tr><td className="td text-muted" colSpan={6}>No invoices yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
