'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Empty, Modal, PageHeader, StatusBadge, useApi } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Appt { id: string; starts_at: string; ends_at: string; status: string; notes: string | null; source: string;
  reminder_sent_at: string | null; contact_name: string | null; contact_phone: string }
interface Booking { timezone: string; hours: Partial<Record<string, [string, string][]>>; slotMinutes: number; capacity: number;
  minNoticeMinutes: number; daysAhead: number; reminderMinutes: number; reminderTemplateId: string | null }

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']] as const;

export default function AppointmentsPage() {
  const { principal } = useSession();
  const list = useApi<{ data: Appt[] }>('/appointments');
  const settings = useApi<Booking>('/settings/booking');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tz = settings.data?.timezone ?? 'Asia/Kolkata';
  const day = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const groups = new Map<string, Appt[]>();
  for (const a of list.data?.data ?? []) groups.set(day(a.starts_at), [...(groups.get(day(a.starts_at)) ?? []), a]);
  const noHours = settings.data && Object.keys(settings.data.hours).length === 0;

  async function setStatus(id: string, status: string) {
    try { await api(`/appointments/${id}`, { method: 'PATCH', body: { status } }); list.reload(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Appointments" subtitle={`Times shown in ${tz}.`}
        actions={<button className="btn btn-primary" onClick={() => setAdding(true)} disabled={!!noHours}><Plus size={16} aria-hidden /> Book</button>} />
      {noHours && <Alert tone="info">Set your booking hours below before customers or agents can book.</Alert>}
      {(error || list.error) && <Alert>{error ?? list.error}</Alert>}
      {list.data && list.data.data.length === 0 && <Empty title="No appointments yet">Add a “Book appointment” step to an Automation flow, or book here.</Empty>}
      {[...groups].map(([d, items]) => (
        <section key={d}>
          <h2 className="mb-2 text-sm font-semibold text-muted">{d}</h2>
          <ul className="card divide-y divide-line">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="w-20 font-semibold">{time(a.starts_at)}</span>
                <span className="min-w-0 flex-1"><b>{a.contact_name ?? '—'}</b> · +{a.contact_phone}
                  {a.notes && <span className="block truncate text-xs text-muted">{a.notes}</span>}</span>
                <span className="text-xs text-muted">{a.source === 'flow' ? 'booked in chat' : a.source === 'api' ? 'via API' : 'booked by team'}{a.reminder_sent_at ? ' · reminded' : ''}</span>
                <StatusBadge status={a.status} />
                {a.status === 'booked' && <span className="flex gap-2 text-xs">
                  <button className="text-emerald-700 hover:underline" onClick={() => setStatus(a.id, 'completed')}>Done</button>
                  <button className="text-amber-700 hover:underline" onClick={() => setStatus(a.id, 'no_show')}>No-show</button>
                  <button className="text-danger hover:underline" onClick={() => setStatus(a.id, 'cancelled')}>Cancel</button></span>}
              </li>))}
          </ul>
        </section>))}
      {principal?.role !== 'agent' && settings.data && <BookingSettings initial={settings.data} onSaved={() => settings.reload()} />}
      {adding && <BookModal onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />}
    </div>
  );
}

function BookModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const slots = useApi<{ data: { startsAt: string; label: string }[] }>('/appointments/slots');
  const [q, setQ] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const contacts = useApi<{ data: { id: string; name: string | null; phone: string }[] }>(q.trim().length >= 2 ? `/contacts?search=${encodeURIComponent(q.trim())}&pageSize=5` : null);
  return (
    <Modal title="Book an appointment" open onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setError(null);
        if (!contactId) { setError('Pick a contact from the list.'); return; }
        try { await api('/appointments', { body: { contactId, startsAt, notes: notes || null } }); onDone(); }
        catch (err) { setError(errorText(err)); slots.reload(); } }}>
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="ac">Contact (search name or number)</label>
          <input id="ac" className="input" value={q} onChange={(e) => { setQ(e.target.value); setContactId(null); }} />
          {!contactId && (contacts.data?.data ?? []).length > 0 && (
            <ul className="mt-1 rounded-lg border border-line">{contacts.data!.data.map((c) => (
              <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-canvas"
                onClick={() => { setContactId(c.id); setQ(c.name ?? `+${c.phone}`); }}>{c.name ?? '—'} · +{c.phone}</button></li>))}</ul>)}
        </div>
        <div><label className="label" htmlFor="as">Time</label>
          <select id="as" className="input" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)}>
            <option value="">{slots.data && slots.data.data.length === 0 ? 'No free times' : 'Choose…'}</option>
            {(slots.data?.data ?? []).map((s) => <option key={s.startsAt} value={s.startsAt}>{s.label}</option>)}</select></div>
        <div><label className="label" htmlFor="an">Notes</label><input id="an" className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <button className="btn btn-primary w-full">Book</button>
      </form>
    </Modal>
  );
}

function BookingSettings({ initial, onSaved }: { initial: Booking; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  useEffect(() => setF(initial), [initial]);
  const templates = useApi<{ data: { id: string; name: string; language: string }[] }>('/templates?status=APPROVED');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  // Opened once on first visit; saving must not fold it shut and hide the confirmation.
  const [startOpen] = useState(Object.keys(initial.hours).length === 0);
  const setDay = (d: string, v: [string, string][] | undefined) => { const h = { ...f.hours }; if (v) h[d] = v; else delete h[d]; setF({ ...f, hours: h }); };
  const num = (k: keyof Booking, label: string, min: number, max: number) => (
    <div><label className="label" htmlFor={`b-${k}`}>{label}</label>
      <input id={`b-${k}`} type="number" className="input" min={min} max={max} value={Number(f[k])} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} /></div>);
  return (
    <details className="card p-5" open={startOpen}>
      <summary className="cursor-pointer font-semibold">Booking hours and reminders</summary>
      <div className="mt-4 space-y-2">
        {DAYS.map(([d, label]) => {
          const w = f.hours[d]?.[0];
          return (
            <div key={d} className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex w-32 items-center gap-2"><input type="checkbox" checked={!!w} onChange={(e) => setDay(d, e.target.checked ? [['10:00', '18:00']] : undefined)} /> {label}</label>
              {w ? <>
                <input type="time" className="input w-32" value={w[0]} onChange={(e) => setDay(d, [[e.target.value, w[1]]])} aria-label={`${label} first slot`} />
                <span>to</span>
                <input type="time" className="input w-32" value={w[1]} onChange={(e) => setDay(d, [[w[0], e.target.value]])} aria-label={`${label} last slot ends`} />
              </> : <span className="text-muted">No bookings</span>}
            </div>);
        })}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {num('slotMinutes', 'Slot length (minutes)', 5, 480)}
        {num('capacity', 'Bookings per slot', 1, 100)}
        {num('minNoticeMinutes', 'Minimum notice (minutes)', 0, 10080)}
        {num('daysAhead', 'Bookable days ahead', 1, 90)}
        {num('reminderMinutes', 'Reminder before (minutes, 0 = off)', 0, 10080)}
        <div><label className="label" htmlFor="b-tpl">Reminder template</label>
          <select id="b-tpl" className="input" value={f.reminderTemplateId ?? ''} onChange={(e) => setF({ ...f, reminderTemplateId: e.target.value || null })}>
            <option value="">None: text, only within 24 h of their last message</option>
            {(templates.data?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}</select></div>
      </div>
      <p className="mt-2 text-xs text-muted">Template variables: {'{{1}}'} = customer name, {'{{2}}'} = date and time. Use a Utility template so it is delivered outside the 24-hour window.</p>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <button className="btn btn-primary mt-3" onClick={async () => { setMsg(null);
        try { await api('/settings/booking', { method: 'PUT', body: f }); setMsg({ tone: 'success', text: 'Saved.' }); onSaved(); }
        catch (e) { setMsg({ tone: 'error', text: errorText(e) }); } }}>Save booking settings</button>
    </details>
  );
}
