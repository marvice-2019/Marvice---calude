'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Modal, PageHeader, useApi } from '@/components/ui';
import { api, errorText, money } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Pipeline { id: string; name: string; stages: { id: string; name: string }[] }
interface Deal { id: string; stage_id: string; title: string; value_paise: number; position: number; contact_name: string | null; contact_phone: string | null; owner_name: string | null }
interface Summary { open_deals: number; open_value_paise: number; won_30d: number; won_value_30d_paise: number; lost_30d: number }

export default function PipelinePage() {
  const { principal } = useSession();
  const pipes = useApi<{ data: Pipeline[] }>('/pipelines');
  const pipe = pipes.data?.data[0];
  const deals = useApi<{ data: Deal[] }>(pipe ? `/pipelines/${pipe.id}/deals` : null);
  const summary = useApi<Summary>(pipe && principal?.role !== 'agent' ? `/pipelines/${pipe.id}/summary` : null);
  const [adding, setAdding] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(dealId: string, stageId: string) {
    const inStage = (deals.data?.data ?? []).filter((d) => d.stage_id === stageId);
    const position = (inStage.at(-1)?.position ?? 0) + 1;
    deals.setData((cur) => cur && { data: cur.data.map((d) => (d.id === dealId ? { ...d, stage_id: stageId, position } : d)) });   // instant feedback
    try { await api(`/deals/${dealId}`, { method: 'PATCH', body: { stageId, position } }); } catch (e) { setError(errorText(e)); }
    deals.reload(); summary.reload();
  }
  async function close(dealId: string, status: 'won' | 'lost') {
    try { await api(`/deals/${dealId}`, { method: 'PATCH', body: { status } }); deals.reload(); summary.reload(); } catch (e) { setError(errorText(e)); }
  }

  const s = summary.data;
  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader title={pipe?.name ?? 'Pipeline'} subtitle="Drag deals between stages. Won and lost deals leave the board and count in the totals." />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Open deals', String(s.open_deals)], ['Open value', money(Number(s.open_value_paise))], ['Won (30 days)', `${s.won_30d} · ${money(Number(s.won_value_30d_paise))}`], ['Lost (30 days)', String(s.lost_30d)]]
            .map(([k, v]) => <div key={k} className="card p-3"><div className="text-xs text-muted">{k}</div><div className="font-semibold">{v}</div></div>)}
        </div>
      )}
      {(error || deals.error) && <div className="mb-3"><Alert>{error ?? deals.error}</Alert></div>}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {(pipe?.stages ?? []).map((st) => {
          const list = (deals.data?.data ?? []).filter((d) => d.stage_id === st.id);
          const total = list.reduce((a, d) => a + Number(d.value_paise), 0);
          return (
            <section key={st.id} aria-label={st.name} className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100"
              onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId) void move(dragId, st.id); setDragId(null); }}>
              <header className="flex items-center justify-between px-3 py-2.5">
                <div><div className="text-sm font-semibold">{st.name} <span className="font-normal text-muted">{list.length}</span></div>
                  <div className="text-xs text-muted">{money(total)}</div></div>
                <button className="rounded p-1 text-muted hover:bg-white hover:text-ink" onClick={() => setAdding(st.id)} aria-label={`Add deal to ${st.name}`}><Plus size={16} /></button>
              </header>
              <ul className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {list.map((d) => (
                  <li key={d.id} draggable onDragStart={() => setDragId(d.id)} className="card cursor-grab p-3 text-sm shadow-sm active:cursor-grabbing">
                    <div className="font-medium">{d.title}</div>
                    <div className="mt-0.5 text-xs text-muted">{d.contact_name ?? (d.contact_phone ? `+${d.contact_phone}` : 'No contact')}{d.owner_name ? ` · ${d.owner_name}` : ''}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-semibold text-brand-dark">{money(Number(d.value_paise))}</span>
                      <span className="flex gap-2 text-xs">
                        <button className="text-emerald-700 hover:underline" onClick={() => close(d.id, 'won')}>Won</button>
                        <button className="text-danger hover:underline" onClick={() => close(d.id, 'lost')}>Lost</button>
                      </span>
                    </div>
                    <label className="sr-only" htmlFor={`mv-${d.id}`}>Move {d.title}</label>
                    <select id={`mv-${d.id}`} className="sr-only" value={d.stage_id} onChange={(e) => move(d.id, e.target.value)}>
                      {pipe!.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {adding && pipe && <AddDeal pipelineId={pipe.id} stageId={adding} onClose={() => setAdding(null)} onDone={() => { setAdding(null); deals.reload(); summary.reload(); }} />}
    </div>
  );
}

function AddDeal({ pipelineId, stageId, onClose, onDone }: { pipelineId: string; stageId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [rupees, setRupees] = useState('');
  const [q, setQ] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const contacts = useApi<{ data: { id: string; name: string | null; phone: string }[] }>(q.trim().length >= 2 ? `/contacts?search=${encodeURIComponent(q.trim())}&pageSize=5` : null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="New deal" open onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setError(null);
        try { await api('/deals', { body: { pipelineId, stageId, title, valuePaise: Math.round(Number(rupees || 0) * 100), contactId } }); onDone(); }
        catch (err) { setError(errorText(err)); } }}>
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="dt">What is being sold</label><input id="dt" className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="200 printed sarees" /></div>
        <div><label className="label" htmlFor="dv">Value in ₹</label><input id="dv" className="input" type="number" min="0" step="1" value={rupees} onChange={(e) => setRupees(e.target.value)} /></div>
        <div><label className="label" htmlFor="dc">Contact (search name or number)</label>
          <input id="dc" className="input" value={q} onChange={(e) => { setQ(e.target.value); setContactId(null); }} />
          {!contactId && (contacts.data?.data ?? []).length > 0 && (
            <ul className="mt-1 rounded-lg border border-line">{contacts.data!.data.map((c) => (
              <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-canvas"
                onClick={() => { setContactId(c.id); setQ(c.name ?? `+${c.phone}`); }}>{c.name ?? '—'} · +{c.phone}</button></li>))}</ul>)}
        </div>
        <button className="btn btn-primary w-full">Add deal</button>
      </form>
    </Modal>
  );
}
