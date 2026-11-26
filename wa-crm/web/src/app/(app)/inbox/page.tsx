'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCheck, Clock, FileText, Send, Sparkles, StickyNote, UserPlus } from 'lucide-react';
import { Alert, Modal, StatusBadge, useApi } from '@/components/ui';
import { api, errorText, when } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Conversation { id: string; status: string; unread_count: number; last_message_at: string | null; assigned_user_id: string | null;
  contact_id: string; contact_name: string | null; contact_phone: string }
interface Message { id: string; direction: 'inbound' | 'outbound'; type: string; body: string | null; status: string; error_code: string | null; created_at: string }
interface Note { id: string; body: string; created_at: string; user_name: string | null }
interface Member { id: string; name: string; role: string }
interface Template { id: string; name: string; language: string; status: string; components: { type: string; text?: string }[] }

const WINDOW_MS = 24 * 3600 * 1000;
const vars = (text: string) => [...new Set([...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);

export default function InboxPage() {
  const { principal, socket } = useSession();
  const isManager = principal?.role !== 'agent';
  const [filter, setFilter] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [search, setSearch] = useState('');
  const convs = useApi<{ data: Conversation[] }>('/conversations');
  const team = useApi<{ data: Member[] }>(isManager ? '/team' : null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Deep link from Orders and other pages: /inbox?c=<conversation id>.
  useEffect(() => { const c = new URLSearchParams(window.location.search).get('c'); if (c && /^[0-9a-f-]{36}$/.test(c)) setActiveId(c); }, []);

  // Live updates: refresh the list on any event; the open thread handles its own messages.
  useEffect(() => {
    if (!socket) return;
    const refresh = () => convs.reload();
    socket.on('message.created', refresh);
    socket.on('conversation.assigned', refresh);
    socket.on('conversation.status', refresh);
    return () => { socket.off('message.created', refresh); socket.off('conversation.assigned', refresh); socket.off('conversation.status', refresh); };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => (convs.data?.data ?? []).filter((c) => {
    if (filter === 'mine' && c.assigned_user_id !== principal?.userId) return false;
    if (filter === 'unassigned' && c.assigned_user_id) return false;
    const q = search.trim().toLowerCase();
    return !q || (c.contact_name ?? '').toLowerCase().includes(q) || c.contact_phone.includes(q);
  }), [convs.data, filter, search, principal]);
  const active = list.find((c) => c.id === activeId) ?? convs.data?.data.find((c) => c.id === activeId) ?? null;
  const names = new Map((team.data?.data ?? []).map((m) => [m.id, m.name]));

  return (
    <div className="flex h-[calc(100vh-3.5rem)] md:h-screen">
      <section className={`flex w-full flex-col border-r border-line bg-white md:w-80 ${active ? 'hidden md:flex' : 'flex'}`} aria-label="Conversations">
        <div className="space-y-2 border-b border-line p-3">
          <input className="input" placeholder="Search name or number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search conversations" />
          <div className="flex gap-1 text-xs" role="tablist">
            {(['all', 'mine', 'unassigned'] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 capitalize ${filter === f ? 'bg-brand text-white' : 'bg-canvas text-muted hover:text-ink'}`}>{f}</button>
            ))}
          </div>
        </div>
        {convs.error && <div className="p-3"><Alert>{convs.error}</Alert></div>}
        <ul className="flex-1 overflow-y-auto">
          {list.map((c) => (
            <li key={c.id}>
              <button onClick={() => setActiveId(c.id)} className={`flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left hover:bg-canvas ${c.id === activeId ? 'bg-brand-soft/50' : ''}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">{(c.contact_name ?? c.contact_phone)[0]?.toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.contact_name ?? `+${c.contact_phone}`}</span>
                    {c.unread_count > 0 && <span className="badge bg-brand text-white">{c.unread_count}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {c.assigned_user_id ? (names.get(c.assigned_user_id) ?? 'Assigned') : 'Unassigned'} · {when(c.last_message_at)}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {convs.data && list.length === 0 && <li className="p-6 text-center text-sm text-muted">No conversations yet. New WhatsApp messages appear here.</li>}
        </ul>
      </section>
      {active ? <Thread key={active.id} conv={active} team={team.data?.data ?? []} isManager={isManager} onBack={() => setActiveId(null)} onChanged={convs.reload} />
        : <div className="hidden flex-1 place-items-center text-sm text-muted md:grid">Pick a conversation to start.</div>}
    </div>
  );
}

function Thread({ conv, team, isManager, onBack, onChanged }: { conv: Conversation; team: Member[]; isManager: boolean; onBack: () => void; onChanged: () => void }) {
  const { principal, socket } = useSession();
  const msgs = useApi<{ data: Message[] }>(`/conversations/${conv.id}/messages`);
  const notes = useApi<{ data: Note[] }>(`/conversations/${conv.id}/notes`);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket) return;
    const onMsg = (e: { conversationId: string }) => { if (e.conversationId === conv.id) msgs.reload(); };
    socket.on('message.created', onMsg);
    socket.on('message.status', onMsg);
    return () => { socket.off('message.created', onMsg); socket.off('message.status', onMsg); };
  }, [socket, conv.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [msgs.data]);

  const lastInbound = [...(msgs.data?.data ?? [])].reverse().find((m) => m.direction === 'inbound');
  const windowOpen = !!lastInbound && Date.now() - new Date(lastInbound.created_at).getTime() < WINDOW_MS;

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); msgs.reload(); onChanged(); } catch (e) { setError(errorText(e)); }
  }, [msgs, onChanged]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const body = text;
    setText('');
    await run(() => api(`/conversations/${conv.id}/messages`, { body: { text: body } }));
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2.5">
        <button className="btn-ghost btn px-2 md:hidden" onClick={onBack} aria-label="Back to list">←</button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{conv.contact_name ?? `+${conv.contact_phone}`}</div>
          <div className="text-xs text-muted">+{conv.contact_phone} · <StatusBadge status={conv.status} /></div>
        </div>
        {isManager ? (
          <select className="input w-auto" aria-label="Assign to" value={conv.assigned_user_id ?? ''}
            onChange={(e) => run(() => api(`/conversations/${conv.id}/assign`, { method: 'PATCH', body: { userId: e.target.value || null } }))}>
            <option value="">Unassigned</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        ) : !conv.assigned_user_id && (
          <button className="btn-ghost btn" onClick={() => run(() => api(`/conversations/${conv.id}/claim`, { body: {} }))}><UserPlus size={16} /> Take it</button>
        )}
        <button className="btn-ghost btn" title="Stop the chatbot for this chat" onClick={() => run(() => api(`/conversations/${conv.id}/stop-bot`, { body: {} }))}><Bot size={16} /></button>
        <button className="btn-ghost btn" onClick={() => setShowNotes(!showNotes)} aria-pressed={showNotes}><StickyNote size={16} /> Notes</button>
        <button className="btn-ghost btn" onClick={() => run(() => api(`/conversations/${conv.id}/status`, { method: 'PATCH',
          body: { status: conv.status === 'open' ? 'closed' : 'open' } }))}>{conv.status === 'open' ? 'Close' : 'Reopen'}</button>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col bg-[#efeae2]">
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {(msgs.data?.data ?? []).map((m) => (
              <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.direction === 'outbound' ? 'bg-bubble-out' : 'bg-bubble-in'}`}>
                  {m.type !== 'text' && <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted">{m.type}</div>}
                  <p className="whitespace-pre-wrap break-words">{m.body ?? <em className="text-muted">({m.type})</em>}</p>
                  <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted">
                    {new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    {m.direction === 'outbound' && (m.status === 'failed'
                      ? <span className="text-danger">failed{m.error_code ? ` (${m.error_code})` : ''}</span>
                      : m.status === 'read' ? <CheckCheck size={12} className="text-sky-500" aria-label="read" />
                      : m.status === 'delivered' ? <CheckCheck size={12} aria-label="delivered" /> : <Clock size={11} aria-label={m.status} />)}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>
          {error && <div className="px-4 pb-2"><Alert>{error}</Alert></div>}
          {windowOpen ? (
            <form onSubmit={send} className="flex gap-2 border-t border-line bg-white p-3">
              <button type="button" className="btn-ghost btn" onClick={() => setTplOpen(true)} title="Send a template"><FileText size={16} /></button>
              <button type="button" className="btn-ghost btn" title="Suggest a reply with AI" disabled={aiBusy} onClick={async () => {
                setAiBusy(true); setError(null);
                try { const r = await api<{ text: string }>(`/conversations/${conv.id}/suggest-reply`, { body: {} }); setText(r.text); }
                catch (e) { setError(errorText(e)); } finally { setAiBusy(false); } }}><Sparkles size={16} /></button>
              {text.trim() && (
                <select className="input w-auto" aria-label="Rewrite" value="" disabled={aiBusy} onChange={async (e) => {
                  const style = e.target.value; if (!style) return; setAiBusy(true); setError(null);
                  try { const r = await api<{ text: string }>('/ai/rewrite', { body: { text, style } }); setText(r.text); }
                  catch (err) { setError(errorText(err)); } finally { setAiBusy(false); } }}>
                  <option value="">Rewrite…</option><option value="polite">More polite</option><option value="shorter">Shorter</option>
                  <option value="fix">Fix spelling</option><option value="tamil">In Tamil</option><option value="hindi">In Hindi</option><option value="english">In English</option>
                </select>)}
              <textarea className="input min-h-[42px] flex-1 resize-none" rows={1} placeholder="Type a reply" value={text} aria-label="Reply"
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(e); } }} />
              <button className="btn btn-primary" aria-label="Send"><Send size={16} /></button>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-3 border-t border-line bg-amber-50 p-3 text-sm text-amber-900">
              <span>More than 24 hours since the customer wrote. WhatsApp only allows approved templates now.</span>
              <button className="btn btn-primary shrink-0" onClick={() => setTplOpen(true)}>Send template</button>
            </div>
          )}
        </div>
        {showNotes && (
          <aside className="flex w-72 flex-col border-l border-line bg-white" aria-label="Internal notes">
            <div className="border-b border-line px-4 py-3 text-sm font-medium">Internal notes <span className="text-xs font-normal text-muted">(customer never sees these)</span></div>
            <ul className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
              {(notes.data?.data ?? []).map((n) => <li key={n.id} className="rounded-lg bg-amber-50 p-2.5"><p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-muted">{n.user_name ?? 'Someone'} · {when(n.created_at)}</p></li>)}
            </ul>
            <NoteForm onAdd={(body) => run(async () => { await api(`/conversations/${conv.id}/notes`, { body: { body } }); notes.reload(); })} />
          </aside>
        )}
      </div>
      <TemplatePicker open={tplOpen} onClose={() => setTplOpen(false)}
        onSend={(templateId, parameters) => run(async () => { await api(`/conversations/${conv.id}/template-messages`, { body: { templateId, parameters } }); setTplOpen(false); })} />
      <span className="sr-only">{principal?.role}</span>
    </section>
  );
}

function NoteForm({ onAdd }: { onAdd: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  return (
    <form className="border-t border-line p-3" onSubmit={async (e) => { e.preventDefault(); if (body.trim()) { await onAdd(body.trim()); setBody(''); } }}>
      <textarea className="input mb-2" rows={2} placeholder="Add a note for your team" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Note" />
      <button className="btn btn-primary w-full">Add note</button>
    </form>
  );
}

function TemplatePicker({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (id: string, params: string[]) => Promise<void> }) {
  const tpls = useApi<{ data: Template[] }>(open ? '/templates?status=APPROVED' : null);
  const [id, setId] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const tpl = tpls.data?.data.find((t) => t.id === id);
  const body = tpl?.components.find((c) => c.type.toUpperCase() === 'BODY')?.text ?? '';
  const nums = vars(body);
  const preview = body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] || `{{${n}}}`);
  return (
    <Modal title="Send a template" open={open} onClose={onClose}>
      <div className="space-y-3">
        <select className="input" value={id} onChange={(e) => { setId(e.target.value); setParams([]); }} aria-label="Template">
          <option value="">Choose an approved template</option>
          {(tpls.data?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
        </select>
        {nums.map((n, i) => (
          <div key={n}><label className="label" htmlFor={`p${n}`}>Variable {`{{${n}}}`}</label>
            <input id={`p${n}`} className="input" value={params[i] ?? ''} onChange={(e) => { const p = [...params]; p[i] = e.target.value; setParams(p); }} /></div>
        ))}
        {tpl && <div className="rounded-lg bg-bubble-out p-3 text-sm whitespace-pre-wrap">{preview}</div>}
        <button className="btn btn-primary w-full" disabled={!tpl || nums.some((_, i) => !params[i]?.trim())} onClick={() => onSend(id, params.slice(0, nums.length))}>Send</button>
      </div>
    </Modal>
  );
}
