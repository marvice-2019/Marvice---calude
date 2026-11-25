'use client';

import { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Alert, Empty, Modal, PageHeader, StatusBadge, useApi } from '@/components/ui';
import { api, errorText, when } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Waba } from '@/lib/types';

interface Template { id: string; name: string; language: string; category: string; status: string; rejected_reason: string | null;
  components: { type: string; text?: string }[]; updated_at: string }

export default function TemplatesPage() {
  const { principal } = useSession();
  const isManager = principal?.role !== 'agent';
  const tpls = useApi<{ data: Template[] }>('/templates');
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function sync() {
    setMsg(null);
    try {
      const r = await api<{ upserted: number; skipped: number }>('/templates/sync', { body: {} });
      setMsg({ tone: 'success', text: `Synced ${r.upserted} templates from Meta${r.skipped ? ` (${r.skipped} skipped)` : ''}.` });
      tpls.reload();
    } catch (e) { setMsg({ tone: 'error', text: errorText(e) }); }
  }

  return (
    <div className="p-6">
      <PageHeader title="Message templates" subtitle="Meta must approve a template before you can use it outside the 24-hour window or in campaigns."
        actions={isManager && <>
          <button className="btn-ghost btn" onClick={sync}><RefreshCw size={16} /> Sync from Meta</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New template</button>
        </>} />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {tpls.error && <Alert>{tpls.error}</Alert>}
      {tpls.data?.data.length === 0 ? <Empty title="No templates yet">Create one here, or sync the templates you already have in Meta.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(tpls.data?.data ?? []).map((t) => (
            <article key={t.id} className="card p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div><h3 className="font-medium">{t.name}</h3><p className="text-xs text-muted">{t.category.toLowerCase()} · {t.language}</p></div>
                <StatusBadge status={t.status} />
              </div>
              <p className="whitespace-pre-wrap rounded-lg bg-bubble-out p-3 text-sm">{t.components.find((c) => c.type.toUpperCase() === 'BODY')?.text ?? '—'}</p>
              {t.rejected_reason && <p className="mt-2 text-xs text-danger">Rejected: {t.rejected_reason}</p>}
              <p className="mt-2 text-xs text-muted">Updated {when(t.updated_at)}</p>
            </article>
          ))}
        </div>
      )}
      {creating && <CreateTemplate onClose={() => setCreating(false)} onDone={() => { setCreating(false); tpls.reload(); }} />}
    </div>
  );
}

function CreateTemplate({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const wabas = useApi<{ data: Waba[] }>('/waba');
  const [f, setF] = useState({ wabaAccountId: '', name: '', language: 'en', category: 'UTILITY', body: '', footer: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nums = [...new Set([...f.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const gap = nums.some((n, i) => n !== i + 1);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const components: Record<string, unknown>[] = [{ type: 'BODY', text: f.body,
      ...(nums.length ? { example: { body_text: [nums.map((n) => `sample${n}`)] } } : {}) }];
    if (f.footer.trim()) components.push({ type: 'FOOTER', text: f.footer.trim() });
    try {
      await api('/templates', { body: { wabaAccountId: f.wabaAccountId || wabas.data?.data[0]?.id, name: f.name, language: f.language, category: f.category, components } });
      onDone();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }

  return (
    <Modal title="New template" open onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        {(wabas.data?.data.length ?? 0) > 1 && (
          <div><label className="label" htmlFor="tw">WhatsApp account</label>
            <select id="tw" className="input" value={f.wabaAccountId} onChange={(e) => setF({ ...f, wabaAccountId: e.target.value })}>
              {wabas.data!.data.map((w) => <option key={w.id} value={w.id}>{w.name ?? w.meta_waba_id}</option>)}</select></div>
        )}
        <div><label className="label" htmlFor="tn">Name (lowercase, numbers, underscores)</label>
          <input id="tn" className="input" required pattern="[a-z0-9_]+" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="order_shipped" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="tl">Language</label>
            <select id="tl" className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
              {[['en', 'English'], ['en_US', 'English (US)'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['mr', 'Marathi'], ['bn', 'Bengali']]
                .map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label" htmlFor="tc">Category</label>
            <select id="tc" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="UTILITY">Utility (orders, updates)</option><option value="MARKETING">Marketing (offers)</option>
              <option value="AUTHENTICATION">Authentication (OTP)</option></select></div>
        </div>
        <div><label className="label" htmlFor="tb">Message (use {'{{1}}'}, {'{{2}}'} for variables)</label>
          <textarea id="tb" className="input" rows={5} required maxLength={1024} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}
            placeholder="Hi {{1}}, your order {{2}} has shipped." />
          {gap && <p className="mt-1 text-xs text-danger">Number variables in order with no gaps: {'{{1}}'}, {'{{2}}'}, …</p>}</div>
        <div><label className="label" htmlFor="tf">Footer (optional)</label>
          <input id="tf" className="input" maxLength={60} value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} /></div>
        <button className="btn btn-primary w-full" disabled={busy || gap}>{busy ? 'Submitting…' : 'Submit to Meta for review'}</button>
      </form>
    </Modal>
  );
}
