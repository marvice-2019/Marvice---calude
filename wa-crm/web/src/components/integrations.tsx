'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Alert, Modal, useApi } from '@/components/ui';
import { api, API_URL, errorText, when } from '@/lib/api';

const EVENTS = [['message.received', 'Message received'], ['message.status', 'Delivery status'], ['contact.created', 'Contact created'],
  ['campaign.completed', 'Campaign completed']] as const;

/** Contacts → Import CSV. */
export function ImportContacts({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [cc, setCc] = useState('91');
  const [source, setSource] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const jobs = useApi<{ data: { id: string; file_name: string; status: string; total: number; created_count: number; updated_count: number;
    error_count: number; errors: { row: number; reason: string }[]; created_at: string }[] }>(open ? '/contacts/import-jobs' : null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!file) return;
    if (file.size > 5_000_000) { setMsg({ tone: 'error', text: 'File is over 5 MB. Split it into smaller files.' }); return; }
    try {
      await api('/contacts/import', { body: { fileName: file.name, csv: await file.text(), defaultCountryCode: cc, optInSource: source } });
      setMsg({ tone: 'success', text: 'Import started. Refresh this list in a minute to see the result.' });
      jobs.reload(); onDone();
    } catch (err) { setMsg({ tone: 'error', text: errorText(err) }); }
  }
  return (
    <>
      <button className="btn-ghost btn" onClick={() => setOpen(true)}><Upload size={16} /> Import CSV</button>
      <Modal title="Import contacts from CSV" open={open} onClose={() => setOpen(false)}>
        <form className="space-y-3" onSubmit={submit}>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <p className="text-sm text-muted">Columns: <b>phone</b> (required), name, email, tags (separate with ;). Existing numbers are updated, not duplicated.</p>
          <input type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="CSV file" className="text-sm" />
          <div><label className="label" htmlFor="icc">Country code for 10-digit numbers</label>
            <input id="icc" className="input w-24" value={cc} onChange={(e) => setCc(e.target.value.replace(/\D/g, ''))} /></div>
          <div><label className="label" htmlFor="isrc">How did these people agree to WhatsApp messages? (required by WhatsApp)</label>
            <input id="isrc" className="input" required minLength={3} placeholder="Website sign-up form, March 2026" value={source} onChange={(e) => setSource(e.target.value)} /></div>
          <button className="btn btn-primary w-full" disabled={!file}>Start import</button>
        </form>
        {(jobs.data?.data.length ?? 0) > 0 && (
          <div className="mt-5"><div className="mb-2 flex items-center justify-between"><b className="text-sm">Recent imports</b>
            <button className="text-sm text-brand" onClick={jobs.reload}>Refresh</button></div>
            <ul className="space-y-2 text-sm">{jobs.data!.data.slice(0, 5).map((j) => (
              <li key={j.id} className="rounded-lg border border-line p-2.5">
                <div className="flex justify-between"><span className="font-medium">{j.file_name}</span><span className="text-muted">{j.status}</span></div>
                {j.status === 'done' && <div className="text-muted">{j.created_count} added · {j.updated_count} updated · {j.error_count} skipped</div>}
                {j.errors.slice(0, 3).map((er) => <div key={er.row} className="text-xs text-danger">Row {er.row}: {er.reason}</div>)}
                <div className="text-xs text-muted">{when(j.created_at)}</div>
              </li>))}</ul>
          </div>
        )}
      </Modal>
    </>
  );
}

/** Settings → API keys and outgoing webhooks. */
export function IntegrationsSection() {
  const keys = useApi<{ data: { id: string; name: string; prefix: string; last_used_at: string | null; revoked_at: string | null; created_at: string }[] }>('/settings/api-keys');
  const hooks = useApi<{ data: { id: string; url: string; events: string[]; last_status: number | null; last_error: string | null; last_sent_at: string | null }[] }>('/settings/webhooks');
  const [keyName, setKeyName] = useState('');
  const [hookUrl, setHookUrl] = useState('');
  const [hookEvents, setHookEvents] = useState<string[]>(['message.received']);
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); keys.reload(); hooks.reload(); } catch (e) { setError(errorText(e)); } };

  return (
    <section className="card p-5">
      <h2 className="font-semibold">Integrations</h2>
      <p className="mb-4 text-sm text-muted">Connect n8n, your website or CRM. API base URL: <code className="rounded bg-canvas px-1">{API_URL}</code>, header <code className="rounded bg-canvas px-1">x-api-key</code>.
        Keys can manage contacts, conversations, templates, tags and campaigns, but not team, billing or settings.</p>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {shown && <div className="mb-3"><Alert tone="success">{shown.label}: <code className="break-all font-mono">{shown.value}</code><br />Copy it now. It will not be shown again.</Alert></div>}

      <h3 className="mb-2 text-sm font-medium">API keys</h3>
      <ul className="mb-3 divide-y divide-line rounded-lg border border-line text-sm">
        {(keys.data?.data ?? []).map((k) => (
          <li key={k.id} className="flex items-center justify-between px-3 py-2">
            <span><b>{k.name}</b> <code className="text-muted">{k.prefix}…</code></span>
            <span className="text-xs text-muted">{k.revoked_at ? 'revoked' : `last used ${when(k.last_used_at)}`}
              {!k.revoked_at && <button className="ml-3 text-danger" onClick={() => act(() => api(`/settings/api-keys/${k.id}`, { method: 'DELETE' }))}>Revoke</button>}</span>
          </li>))}
        {keys.data?.data.length === 0 && <li className="px-3 py-2 text-muted">No keys yet.</li>}
      </ul>
      <form className="mb-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); void act(async () => {
        const r = await api<{ key: string }>('/settings/api-keys', { body: { name: keyName } }); setShown({ label: 'New API key', value: r.key }); setKeyName(''); }); }}>
        <input className="input" required placeholder="Key name, e.g. n8n" value={keyName} onChange={(e) => setKeyName(e.target.value)} aria-label="Key name" />
        <button className="btn btn-primary shrink-0">Create key</button>
      </form>

      <h3 className="mb-2 text-sm font-medium">Outgoing webhooks</h3>
      <ul className="mb-3 divide-y divide-line rounded-lg border border-line text-sm">
        {(hooks.data?.data ?? []).map((h) => (
          <li key={h.id} className="px-3 py-2">
            <div className="flex items-center justify-between gap-2"><code className="truncate">{h.url}</code>
              <span className="shrink-0 text-xs"><button className="mr-3 text-brand" onClick={() => act(() => api(`/settings/webhooks/${h.id}/test`, { body: {} }))}>Send test</button>
                <button className="text-danger" onClick={() => act(() => api(`/settings/webhooks/${h.id}`, { method: 'DELETE' }))}>Delete</button></span></div>
            <div className="text-xs text-muted">{h.events.join(', ')} · {h.last_sent_at ? `last ${h.last_status ?? 'error'} at ${when(h.last_sent_at)}` : 'nothing sent yet'}{h.last_error ? ` · ${h.last_error}` : ''}</div>
          </li>))}
        {hooks.data?.data.length === 0 && <li className="px-3 py-2 text-muted">No webhooks yet.</li>}
      </ul>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void act(async () => {
        const r = await api<{ secret: string }>('/settings/webhooks', { body: { url: hookUrl, events: hookEvents } }); setShown({ label: 'Signing secret', value: r.secret }); setHookUrl(''); }); }}>
        <input className="input" required type="url" pattern="https://.*" placeholder="https://your-n8n.example.com/webhook/whatsapp" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} aria-label="Webhook URL" />
        <div className="flex flex-wrap gap-3 text-sm">{EVENTS.map(([v, l]) => (
          <label key={v} className="flex items-center gap-1.5"><input type="checkbox" checked={hookEvents.includes(v)}
            onChange={(e) => setHookEvents(e.target.checked ? [...hookEvents, v] : hookEvents.filter((x) => x !== v))} />{l}</label>))}</div>
        <button className="btn btn-primary" disabled={hookEvents.length === 0}>Add webhook</button>
      </form>
      <p className="mt-3 text-xs text-muted">Each request carries <code>X-Wacrm-Signature: sha256=HMAC(secret, body)</code>. Failed deliveries are retried up to 6 times.</p>
    </section>
  );
}
