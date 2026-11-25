'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Empty, Modal, PageHeader, StatusBadge, useApi } from '@/components/ui';
import { api, errorText, when } from '@/lib/api';
import type { Waba } from '@/lib/types';

interface Stats { total: number; pending: number; sent: number; failed: number; skipped: number; delivered: number; read: number }
interface Campaign { id: string; name: string; status: string; template_name: string; scheduled_at: string; completed_at: string | null; stats: Stats | null }
interface Template { id: string; name: string; language: string; components: { type: string; text?: string }[] }
interface TagT { id: string; label: string; contact_count: number }

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export default function CampaignsPage() {
  const list = useApi<{ data: Campaign[] }>('/campaigns');
  const [creating, setCreating] = useState(false);
  return (
    <div className="p-6">
      <PageHeader title="Campaigns" subtitle="Send an approved template to many contacts. Opted-out contacts are skipped automatically."
        actions={<button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New campaign</button>} />
      {list.error && <Alert>{list.error}</Alert>}
      {list.data?.data.length === 0 ? <Empty title="No campaigns yet">Create one to broadcast an offer or update to a tag or your whole list.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Campaign</th><th className="th">Status</th><th className="th">Recipients</th><th className="th">Sent</th>
              <th className="th">Delivered</th><th className="th">Read</th><th className="th">Failed</th></tr></thead>
            <tbody>
              {(list.data?.data ?? []).map((c) => {
                const s = c.stats;
                return (
                  <tr key={c.id}>
                    <td className="td"><div className="font-medium">{c.name}</div><div className="text-xs text-muted">{c.template_name} · {when(c.scheduled_at)}</div></td>
                    <td className="td"><StatusBadge status={c.status} /></td>
                    <td className="td">{s?.total ?? 0}{s?.skipped ? <span className="text-xs text-muted"> ({s.skipped} skipped)</span> : null}</td>
                    <td className="td">{s?.sent ?? 0}</td>
                    <td className="td">{s?.delivered ?? 0} <span className="text-xs text-muted">{pct(s?.delivered ?? 0, s?.sent ?? 0)}</span></td>
                    <td className="td">{s?.read ?? 0} <span className="text-xs text-muted">{pct(s?.read ?? 0, s?.sent ?? 0)}</span></td>
                    <td className="td">{s?.failed ? <span className="text-danger">{s.failed}</span> : 0}
                      {(c.status === 'scheduled' || c.status === 'sending') && (
                        <button className="ml-3 text-xs text-danger" onClick={async () => { await api(`/campaigns/${c.id}/cancel`, { body: {} }).catch(() => {}); list.reload(); }}>Cancel</button>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <CreateCampaign onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); }} />}
    </div>
  );
}

function CreateCampaign({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const wabas = useApi<{ data: Waba[] }>('/waba');
  const tpls = useApi<{ data: Template[] }>('/templates?status=APPROVED');
  const tags = useApi<{ data: TagT[] }>('/tags');
  const numbers = (wabas.data?.data ?? []).flatMap((w) => w.numbers);
  const [f, setF] = useState({ name: '', phoneNumberId: '', templateId: '', audience: 'all', tagIds: [] as string[], scheduledAt: '', fallbackName: 'there' });
  const [params, setParams] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tpl = tpls.data?.data.find((t) => t.id === f.templateId);
  const body = tpl?.components.find((c) => c.type.toUpperCase() === 'BODY')?.text ?? '';
  const nums = [...new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      await api('/campaigns', { body: {
        name: f.name, phoneNumberId: f.phoneNumberId || numbers[0]?.id, templateId: f.templateId, parameters: params.slice(0, nums.length),
        fallbackName: f.fallbackName, audience: f.audience === 'all' ? { type: 'all' } : { type: 'tags', tagIds: f.tagIds },
        ...(f.scheduledAt ? { scheduledAt: new Date(f.scheduledAt).toISOString() } : {}) } });
      onDone();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }

  return (
    <Modal title="New campaign" open onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="cn">Campaign name</label><input id="cn" className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Diwali offer 2026" /></div>
        {numbers.length > 1 && (
          <div><label className="label" htmlFor="cpn">Send from</label>
            <select id="cpn" className="input" value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })}>
              {numbers.map((n) => <option key={n.id} value={n.id}>{n.verifiedName ?? ''} {n.displayPhone}</option>)}</select></div>
        )}
        <div><label className="label" htmlFor="ct">Template</label>
          <select id="ct" className="input" required value={f.templateId} onChange={(e) => { setF({ ...f, templateId: e.target.value }); setParams([]); }}>
            <option value="">Choose an approved template</option>
            {(tpls.data?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}</select></div>
        {nums.map((n, i) => (
          <div key={n}><label className="label" htmlFor={`cv${n}`}>Variable {`{{${n}}}`} — type {'{{contact.name}}'} to use each person's name</label>
            <input id={`cv${n}`} className="input" required value={params[i] ?? ''} onChange={(e) => { const p = [...params]; p[i] = e.target.value; setParams(p); }} /></div>
        ))}
        {tpl && <p className="whitespace-pre-wrap rounded-lg bg-bubble-out p-3 text-sm">{body}</p>}
        <fieldset><legend className="label">Send to</legend>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={f.audience === 'all'} onChange={() => setF({ ...f, audience: 'all' })} /> All contacts</label>
            <label className="flex items-center gap-2"><input type="radio" checked={f.audience === 'tags'} onChange={() => setF({ ...f, audience: 'tags' })} /> Contacts with tags</label>
          </div>
          {f.audience === 'tags' && <div className="mt-2 flex flex-wrap gap-2">{(tags.data?.data ?? []).map((t) => (
            <label key={t.id} className="badge cursor-pointer gap-1 border border-line bg-white px-3 py-1 text-ink">
              <input type="checkbox" checked={f.tagIds.includes(t.id)} onChange={(e) => setF({ ...f, tagIds: e.target.checked ? [...f.tagIds, t.id] : f.tagIds.filter((x) => x !== t.id) })} />
              {t.label} ({t.contact_count})</label>))}</div>}
        </fieldset>
        <div><label className="label" htmlFor="cs">Schedule (leave empty to send now)</label>
          <input id="cs" type="datetime-local" className="input" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></div>
        <button className="btn btn-primary w-full" disabled={busy || !tpl || (f.audience === 'tags' && f.tagIds.length === 0)}>
          {busy ? 'Creating…' : f.scheduledAt ? 'Schedule campaign' : 'Send campaign'}</button>
      </form>
    </Modal>
  );
}
