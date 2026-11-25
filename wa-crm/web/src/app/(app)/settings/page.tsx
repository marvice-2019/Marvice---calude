'use client';

import { useEffect, useState } from 'react';
import { Alert, PageHeader, useApi } from '@/components/ui';
import { api, API_URL, errorText } from '@/lib/api';
import type { Waba } from '@/lib/types';
import { IntegrationsSection } from '@/components/integrations';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']] as const;
type Hours = Partial<Record<(typeof DAYS)[number][0], [string, string][]>>;

export default function SettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Settings" />
      <WhatsAppSection />
      <InboxSection />
      <HoursSection />
      <IntegrationsSection />
    </div>
  );
}

function WhatsAppSection() {
  const wabas = useApi<{ data: Waba[] }>('/waba');
  const [f, setF] = useState({ metaWabaId: '', phoneNumberId: '', displayPhone: '', verifiedName: '', accessToken: '' });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const numbers = (wabas.data?.data ?? []).flatMap((w) => w.numbers);
  return (
    <section className="card p-5">
      <h2 className="font-semibold">WhatsApp numbers</h2>
      <p className="mb-4 text-sm text-muted">Point your Meta app webhook to <code className="rounded bg-canvas px-1">{API_URL}/webhooks/meta</code> and subscribe to <b>messages</b> and <b>message_template_status_update</b>.</p>
      {numbers.length > 0 && (
        <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
          {numbers.map((n) => <li key={n.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span><b>{n.verifiedName ?? 'Number'}</b> · {n.displayPhone}</span>
            <span className="text-xs text-muted">Quality: {n.qualityRating ?? 'unknown'}</span></li>)}
        </ul>
      )}
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <details className="text-sm" open={numbers.length === 0}>
        <summary className="cursor-pointer font-medium text-brand">Connect a number</summary>
        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setMsg(null);
          try { await api('/waba/connect', { body: { ...f, verifiedName: f.verifiedName || undefined } }); setMsg({ tone: 'success', text: 'Number connected.' });
            setF({ metaWabaId: '', phoneNumberId: '', displayPhone: '', verifiedName: '', accessToken: '' }); wabas.reload(); }
          catch (err) { setMsg({ tone: 'error', text: errorText(err) }); } }}>
          <div><label className="label" htmlFor="w1">WhatsApp Business Account ID</label><input id="w1" className="input" required pattern="\d+" value={f.metaWabaId} onChange={(e) => setF({ ...f, metaWabaId: e.target.value })} /></div>
          <div><label className="label" htmlFor="w2">Phone number ID</label><input id="w2" className="input" required pattern="\d+" value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })} /></div>
          <div><label className="label" htmlFor="w3">Display number</label><input id="w3" className="input" required placeholder="+91 98765 43210" value={f.displayPhone} onChange={(e) => setF({ ...f, displayPhone: e.target.value })} /></div>
          <div><label className="label" htmlFor="w4">Business name shown on WhatsApp</label><input id="w4" className="input" value={f.verifiedName} onChange={(e) => setF({ ...f, verifiedName: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="w5">Permanent access token (system user). Stored encrypted; never shown again.</label>
            <input id="w5" type="password" className="input" required minLength={20} autoComplete="off" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} /></div>
          <div className="md:col-span-2"><button className="btn btn-primary">Connect number</button></div>
        </form>
      </details>
    </section>
  );
}

function InboxSection() {
  const s = useApi<{ autoAssign: boolean }>('/settings/inbox');
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card p-5">
      <h2 className="font-semibold">Inbox</h2>
      {error && <Alert>{error}</Alert>}
      <label className="mt-3 flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1" checked={s.data?.autoAssign ?? false} disabled={!s.data}
          onChange={async (e) => { setError(null); try { await api('/settings/inbox', { method: 'PATCH', body: { autoAssign: e.target.checked } }); s.reload(); } catch (err) { setError(errorText(err)); } }} />
        <span><b>Auto-assign new chats</b><br /><span className="text-muted">Each new conversation goes to the agent with the fewest open chats.</span></span>
      </label>
    </section>
  );
}

function HoursSection() {
  const s = useApi<{ timezone: string; hours: Hours; away_enabled: boolean; away_message: string | null; away_cooldown_min: number }>('/settings/working-hours');
  const [f, setF] = useState<{ timezone: string; hours: Hours; awayEnabled: boolean; awayMessage: string; cooldown: number } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => { if (s.data) setF({ timezone: s.data.timezone, hours: s.data.hours, awayEnabled: s.data.away_enabled, awayMessage: s.data.away_message ?? '', cooldown: s.data.away_cooldown_min }); }, [s.data]);
  if (!f) return null;
  const setDay = (d: (typeof DAYS)[number][0], v: [string, string][] | undefined) => { const h = { ...f.hours }; if (v) h[d] = v; else delete h[d]; setF({ ...f, hours: h }); };
  return (
    <section className="card p-5">
      <h2 className="font-semibold">Working hours and away message</h2>
      <p className="mb-4 text-sm text-muted">Outside these hours, customers get your away message (at most once every {f.cooldown / 60} hours per chat).</p>
      <div className="space-y-2">
        {DAYS.map(([d, label]) => {
          const slot = f.hours[d]?.[0];
          return (
            <div key={d} className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex w-32 items-center gap-2"><input type="checkbox" checked={!!slot} onChange={(e) => setDay(d, e.target.checked ? [['09:30', '18:30']] : undefined)} /> {label}</label>
              {slot ? <>
                <input type="time" className="input w-32" value={slot[0]} onChange={(e) => setDay(d, [[e.target.value, slot[1]]])} aria-label={`${label} opens`} />
                <span>to</span>
                <input type="time" className="input w-32" value={slot[1]} onChange={(e) => setDay(d, [[slot[0], e.target.value]])} aria-label={`${label} closes`} />
              </> : <span className="text-muted">Closed</span>}
            </div>
          );
        })}
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.awayEnabled} onChange={(e) => setF({ ...f, awayEnabled: e.target.checked })} /> Send an away message when closed</label>
      <textarea className="input mt-2" rows={3} maxLength={1024} value={f.awayMessage} aria-label="Away message"
        placeholder="Thanks {{contact.name}}! We are closed now and will reply by 10 AM." onChange={(e) => setF({ ...f, awayMessage: e.target.value })} />
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <button className="btn btn-primary mt-3" onClick={async () => { setMsg(null);
        try { await api('/settings/working-hours', { method: 'PUT', body: { timezone: f.timezone, hours: f.hours, awayEnabled: f.awayEnabled,
          awayMessage: f.awayMessage || null, awayCooldownMinutes: f.cooldown } }); setMsg({ tone: 'success', text: 'Saved.' }); }
        catch (e) { setMsg({ tone: 'error', text: errorText(e) }); } }}>Save hours</button>
    </section>
  );
}
