'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Empty, Modal, PageHeader, StatusBadge, useApi } from '@/components/ui';
import { api, errorText, money } from '@/lib/api';

interface Item { retailerId: string; name: string; quantity: number; unitPaise: number; totalPaise: number }
interface Order { id: string; number: number; status: string; items: Item[]; subtotal_paise: string; currency: string; note: string | null;
  source: string; created_at: string; conversation_id: string | null; contact_name: string | null; contact_phone: string }
interface Summary { new_orders: number; in_progress: number; value_30d_paise: string; orders_30d: number }

const STATUSES = ['new', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled'] as const;
const NEXT: Record<string, string[]> = { new: ['confirmed', 'cancelled'], confirmed: ['paid', 'shipped', 'cancelled'], paid: ['shipped', 'cancelled'],
  shipped: ['delivered'], delivered: [], cancelled: [] };
const SOURCE: Record<string, string> = { whatsapp: 'WhatsApp cart', manual: 'Added by team', api: 'Via API' };

export default function OrdersPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(search.trim() ? { search: search.trim() } : {}) }).toString();
  const list = useApi<{ data: Order[] }>(`/orders${qs ? `?${qs}` : ''}`);
  const summary = useApi<Summary>('/orders/summary');
  const [open, setOpen] = useState<Order | null>(null);
  const [adding, setAdding] = useState(false);
  const s = summary.data;
  const refresh = () => { list.reload(); summary.reload(); };

  return (
    <div className="space-y-5 p-6">
      <PageHeader title="Orders" subtitle="Carts sent from your WhatsApp catalog arrive here automatically."
        actions={<><Link href="/products" className="btn btn-secondary">Products</Link>
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> New order</button></>} />
      {s && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['New', String(s.new_orders)], ['In progress', String(s.in_progress)], ['Orders (30 days)', String(s.orders_30d)], ['Value (30 days)', money(Number(s.value_30d_paise))]]
          .map(([k, v]) => <div key={k} className="card p-3"><div className="text-xs text-muted">{k}</div><div className="font-semibold">{v}</div></div>)}
      </div>}
      <div className="flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search name, number or order #" aria-label="Search orders" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-44" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map((x) => <option key={x} value={x} className="capitalize">{x}</option>)}</select>
      </div>
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && list.data.data.length === 0 ? <Empty title="No orders yet">Link your Meta catalog to your WhatsApp number so customers can send carts, or add an order here.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-muted"><tr>
              <th className="px-4 py-2">Order</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Items</th>
              <th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Placed</th></tr></thead>
            <tbody className="divide-y divide-line">
              {(list.data?.data ?? []).map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-canvas" onClick={() => setOpen(o)}>
                  <td className="px-4 py-2.5 font-semibold">#{o.number}</td>
                  <td className="px-4 py-2.5">{o.contact_name ?? '—'}<div className="text-xs text-muted">+{o.contact_phone}</div></td>
                  <td className="px-4 py-2.5">{o.items.reduce((a, i) => a + i.quantity, 0)} item(s)<div className="text-xs text-muted">{SOURCE[o.source]}</div></td>
                  <td className="px-4 py-2.5 text-right font-medium">{money(Number(o.subtotal_paise))}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-2.5 text-muted">{new Date(o.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
      {open && <OrderModal order={open} onClose={() => setOpen(null)} onChanged={(o) => { setOpen(o); refresh(); }} />}
      {adding && <NewOrder onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

function OrderModal({ order, onClose, onChanged }: { order: Order; onClose: () => void; onChanged: (o: Order) => void }) {
  const [notify, setNotify] = useState(true);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  async function move(status: string) {
    setMsg(null);
    try {
      const r = await api<{ status: string; notified: { sent: boolean; reason?: string } }>(`/orders/${order.id}`, { method: 'PATCH', body: { status, notify } });
      setMsg(!notify ? { tone: 'success', text: `Marked ${status}.` } : r.notified.sent ? { tone: 'success', text: `Marked ${status} and the customer was told on WhatsApp.` }
        : { tone: 'info', text: `Marked ${status}. No WhatsApp message was sent: ${r.notified.reason === 'outside_service_window' ? 'the customer has not messaged in the last 24 hours, so send them a template from the inbox' : 'there is no chat with this customer'}.` });
      onChanged({ ...order, status: r.status });
    } catch (e) { setMsg({ tone: 'error', text: errorText(e) }); }
  }
  return (
    <Modal title={`Order #${order.number}`} open onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div><b>{order.contact_name ?? '—'}</b> · +{order.contact_phone} · <StatusBadge status={order.status} /></div>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {order.items.map((i, k) => <li key={k} className="flex justify-between px-3 py-2"><span>{i.quantity} × {i.name}<span className="block text-xs text-muted">{i.retailerId} · {money(i.unitPaise)} each</span></span>
            <span className="font-medium">{money(i.totalPaise)}</span></li>)}
          <li className="flex justify-between px-3 py-2 font-semibold"><span>Total</span><span>{money(Number(order.subtotal_paise))}</span></li>
        </ul>
        {order.note && <p className="rounded-lg bg-canvas p-2"><span className="text-xs text-muted">Customer note: </span>{order.note}</p>}
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {NEXT[order.status]!.length > 0 && <>
          <label className="flex items-center gap-2"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Tell the customer on WhatsApp</label>
          <div className="flex flex-wrap gap-2">{NEXT[order.status]!.map((s) => (
            <button key={s} className={`btn ${s === 'cancelled' ? 'btn-secondary text-danger' : 'btn-primary'} capitalize`} onClick={() => move(s)}>Mark {s}</button>))}</div>
        </>}
        {order.conversation_id && <Link className="inline-block text-brand hover:underline" href={`/inbox?c=${order.conversation_id}`}>Open chat</Link>}
      </div>
    </Modal>
  );
}

function NewOrder({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const products = useApi<{ data: { id: string; name: string; price_paise: string; is_active: boolean }[] }>('/products');
  const [q, setQ] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const contacts = useApi<{ data: { id: string; name: string | null; phone: string }[] }>(q.trim().length >= 2 ? `/contacts?search=${encodeURIComponent(q.trim())}&pageSize=5` : null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const active = (products.data?.data ?? []).filter((p) => p.is_active);
  const total = active.reduce((a, p) => a + (qty[p.id] ?? 0) * Number(p.price_paise), 0);
  return (
    <Modal title="New order" open onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setError(null);
        const items = Object.entries(qty).filter(([, n]) => n > 0).map(([productId, quantity]) => ({ productId, quantity }));
        if (!contactId) { setError('Pick a contact from the list.'); return; }
        if (!items.length) { setError('Add at least one product.'); return; }
        try { await api('/orders', { body: { contactId, items } }); onDone(); } catch (err) { setError(errorText(err)); } }}>
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="oc">Customer (search name or number)</label>
          <input id="oc" className="input" value={q} onChange={(e) => { setQ(e.target.value); setContactId(null); }} />
          {!contactId && (contacts.data?.data ?? []).length > 0 && (
            <ul className="mt-1 rounded-lg border border-line">{contacts.data!.data.map((c) => (
              <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-canvas"
                onClick={() => { setContactId(c.id); setQ(c.name ?? `+${c.phone}`); }}>{c.name ?? '—'} · +{c.phone}</button></li>))}</ul>)}
        </div>
        {active.length === 0 ? <p className="text-sm text-muted">No active products. <Link className="text-brand" href="/products">Add products</Link> first.</p> : (
          <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">{active.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>{p.name}<span className="block text-xs text-muted">{money(Number(p.price_paise))}</span></span>
              <input type="number" min={0} max={10000} className="input w-20" aria-label={`Quantity of ${p.name}`} value={qty[p.id] ?? 0}
                onChange={(e) => setQty({ ...qty, [p.id]: Math.max(0, Number(e.target.value)) })} /></li>))}</ul>)}
        <div className="flex items-center justify-between"><span className="font-semibold">Total {money(total)}</span><button className="btn btn-primary">Create order</button></div>
      </form>
    </Modal>
  );
}
