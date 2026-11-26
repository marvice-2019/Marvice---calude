'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addEdge, Background, Controls, Handle, Position, ReactFlow, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Alert, StatusBadge, useApi } from '@/components/ui';
import { api, errorText } from '@/lib/api';

type Kind = 'start' | 'send_text' | 'send_buttons' | 'send_list' | 'send_media' | 'send_template' | 'wait_reply' | 'delay' | 'condition'
  | 'set_var' | 'add_tag' | 'remove_tag' | 'assign_agent' | 'deal_stage' | 'book_appointment' | 'webhook' | 'close_conversation' | 'end';
interface Pipeline { id: string; name: string; stages: { id: string; name: string }[] }
type StepData = { kind: Kind; data: Record<string, unknown> };
type StepNode = Node<StepData, 'step'>;

const KINDS: { kind: Kind; label: string; group: string; init: Record<string, unknown> }[] = [
  { kind: 'send_text', label: 'Send text', group: 'Send', init: { text: 'Hi {{contact.name}}!' } },
  { kind: 'send_buttons', label: 'Buttons', group: 'Send', init: { text: 'How can we help?', buttons: [{ id: 'b1', title: 'Sales' }, { id: 'b2', title: 'Support' }] } },
  { kind: 'send_list', label: 'List menu', group: 'Send', init: { text: 'Pick an option', button: 'Options', rows: [{ id: 'r1', title: 'Option 1' }] } },
  { kind: 'send_media', label: 'Image / file', group: 'Send', init: { mediaType: 'image', url: 'https://', caption: '' } },
  { kind: 'send_template', label: 'Template', group: 'Send', init: { templateId: '', parameters: [] } },
  { kind: 'wait_reply', label: 'Wait for reply', group: 'Logic', init: { saveAs: 'answer', timeoutMinutes: 60 } },
  { kind: 'delay', label: 'Delay', group: 'Logic', init: { minutes: 10 } },
  { kind: 'condition', label: 'Condition', group: 'Logic', init: { left: '{{var.answer}}', op: 'contains', right: '' } },
  { kind: 'set_var', label: 'Set variable', group: 'Logic', init: { name: 'stage', value: '' } },
  { kind: 'add_tag', label: 'Add tag', group: 'CRM', init: { tagId: '' } },
  { kind: 'remove_tag', label: 'Remove tag', group: 'CRM', init: { tagId: '' } },
  { kind: 'assign_agent', label: 'Assign agent', group: 'CRM', init: { userId: 'round_robin' } },
  { kind: 'book_appointment', label: 'Book appointment', group: 'CRM', init: { text: 'Pick a time that suits you', button: 'See times', confirmText: 'You are booked for {{var.appointment}}. See you then!' } },
  { kind: 'deal_stage', label: 'Move deal', group: 'CRM', init: { pipelineId: '', stageId: '', title: '' } },
  { kind: 'webhook', label: 'Webhook', group: 'CRM', init: { url: 'https://', saveAs: '' } },
  { kind: 'close_conversation', label: 'Close chat', group: 'CRM', init: {} },
  { kind: 'end', label: 'End', group: 'CRM', init: {} },
];
const LABEL = Object.fromEntries(KINDS.map((k) => [k.kind, k.label])) as Record<Kind, string>;
LABEL.start = 'Start';

/** Outgoing connection points for a step. 'next' = the default path. */
function outputs(d: StepData): { id: string; label?: string }[] {
  const x = d.data as { buttons?: { id: string; title: string }[]; rows?: { id: string; title: string }[] };
  switch (d.kind) {
    case 'end': return [];
    case 'send_buttons': return [...(x.buttons ?? []).map((b) => ({ id: b.id, label: b.title })), { id: 'next', label: 'other reply' }];
    case 'send_list': return [...(x.rows ?? []).map((r) => ({ id: r.id, label: r.title })), { id: 'next', label: 'other reply' }];
    case 'condition': return [{ id: 'true', label: 'yes' }, { id: 'false', label: 'no' }];
    case 'wait_reply': return [{ id: 'next', label: 'reply' }, { id: 'timeout', label: 'no reply' }];
    case 'webhook': return [{ id: 'ok', label: 'ok' }, { id: 'error', label: 'error' }];
    case 'book_appointment': return [{ id: 'booked', label: 'booked' }, { id: 'failed', label: 'not booked' }];
    default: return [{ id: 'next' }];
  }
}

function summary(d: StepData): string {
  const x = d.data as Record<string, unknown>;
  switch (d.kind) {
    case 'send_text': case 'send_buttons': case 'send_list': case 'book_appointment': return String(x.text ?? '');
    case 'wait_reply': return `save as ${x.saveAs || '—'}${x.timeoutMinutes ? `, ${x.timeoutMinutes} min` : ''}`;
    case 'delay': return `${x.minutes} min`;
    case 'condition': return `${x.left} ${x.op} ${x.right}`;
    case 'set_var': return `${x.name} = ${x.value}`;
    case 'deal_stage': return x.stageId ? 'to the chosen stage' : 'choose a stage';
    case 'webhook': case 'send_media': return String(x.url ?? '');
    default: return '';
  }
}

function Step({ data, selected }: NodeProps<StepNode>) {
  const outs = outputs(data);
  return (
    <div className={`min-w-44 max-w-60 rounded-lg border bg-white text-xs shadow-sm ${selected ? 'border-brand ring-2 ring-brand-soft' : 'border-line'}`}>
      {data.kind !== 'start' && <Handle type="target" position={Position.Left} />}
      <div className={`rounded-t-lg px-3 py-1.5 font-semibold ${data.kind === 'start' ? 'bg-brand text-white' : 'bg-canvas'}`}>{LABEL[data.kind]}</div>
      {summary(data) && <div className="line-clamp-3 px-3 py-2 text-muted">{summary(data)}</div>}
      {outs.length > 0 && (
        <div className="space-y-1 px-3 pb-2">
          {outs.map((o) => (
            <div key={o.id} className="relative pr-3 text-right text-[10px] text-muted">{o.label ?? ''}
              <Handle type="source" id={o.id} position={Position.Right} style={{ top: '50%' }} /></div>
          ))}
        </div>
      )}
    </div>
  );
}
const nodeTypes = { step: Step };

interface ApiFlow { id: string; name: string; status: string; trigger: Trigger; nodes: { id: string; type: Kind; data: Record<string, unknown>; position?: { x: number; y: number } }[];
  edges: { from: string; to: string; handle?: string }[] }
type Trigger = { type: 'keyword'; keywords: string[]; match: 'exact' | 'contains' } | { type: 'new_conversation' } | { type: 'any_message' };

let seq = 0;
const newId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;

export default function FlowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';
  const flow = useApi<ApiFlow>(isNew ? null : `/flows/${id}`);
  const tags = useApi<{ data: { id: string; label: string }[] }>('/tags');
  const team = useApi<{ data: { id: string; name: string }[] }>('/team');
  const pipes = useApi<{ data: Pipeline[] }>('/pipelines');
  const tpls = useApi<{ data: { id: string; name: string; language: string }[] }>('/templates?status=APPROVED');

  const [name, setName] = useState('New flow');
  const [status, setStatus] = useState('draft');
  const [trigger, setTrigger] = useState<Trigger>({ type: 'keyword', keywords: ['hi'], match: 'exact' });
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([
    { id: 'start', type: 'step', position: { x: 40, y: 120 }, data: { kind: 'start', data: {} } }]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    const f = flow.data;
    if (!f) return;
    setName(f.name); setStatus(f.status); setTrigger(f.trigger);
    setNodes(f.nodes.map((n, i) => ({ id: n.id, type: 'step', position: n.position ?? { x: 40 + i * 240, y: 120 }, data: { kind: n.type, data: n.data ?? {} } })));
    setEdges(f.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, sourceHandle: e.handle ?? 'next', label: undefined })));
  }, [flow.data, setNodes, setEdges]);

  const onConnect = useCallback((c: Connection) => setEdges((es) =>
    // One connection per output: reconnecting an output replaces the old line.
    addEdge({ ...c, id: newId() }, es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? 'next') === (c.sourceHandle ?? 'next'))))), [setEdges]);

  const add = (kind: Kind) => {
    const k = KINDS.find((x) => x.kind === kind)!;
    const nid = newId();
    // New steps go to the right of the right-most step (or of the selected one), never on top of another.
    setNodes((ns) => {
      const anchor = ns.find((n) => n.id === selected) ?? ns.reduce((a, b) => (b.position.x > a.position.x ? b : a), ns[0]!);
      const x = anchor.position.x + 280;
      const taken = ns.filter((n) => Math.abs(n.position.x - x) < 200).length;
      return [...ns, { id: nid, type: 'step', position: { x, y: anchor.position.y + taken * 150 }, data: { kind, data: structuredClone(k.init) } }];
    });
    setSelected(nid);
  };
  const sel = nodes.find((n) => n.id === selected);
  const update = (data: Record<string, unknown>) => setNodes((ns) => ns.map((n) => (n.id === selected ? { ...n, data: { ...n.data, data } } : n)));

  const graph = useMemo(() => ({
    nodes: nodes.map((n) => ({ id: n.id, type: n.data.kind,
      // Blank optional fields are left out rather than sent as empty strings.
      data: Object.fromEntries(Object.entries(n.data.data).filter(([, v]) => v !== '' && v !== undefined && v !== null)), position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })),
    edges: edges.map((e) => ({ from: e.source, to: e.target, ...(e.sourceHandle && e.sourceHandle !== 'next' ? { handle: e.sourceHandle } : {}) })),
  }), [nodes, edges]);

  async function save(): Promise<string | null> {
    setMsg(null);
    try {
      if (isNew) {
        const r = await api<{ id: string }>('/flows', { body: { name, trigger, graph } });
        router.replace(`/flows/${r.id}`);
        return r.id;
      }
      await api(`/flows/${id}`, { method: 'PUT', body: { name, trigger, graph } });
      setMsg({ tone: 'success', text: 'Saved.' });
      return id;
    } catch (e) { setMsg({ tone: 'error', text: errorText(e) }); return null; }
  }
  async function setLive(action: 'publish' | 'pause') {
    // Pausing must always work, even when the current edits would not pass validation.
    const fid = action === 'pause' ? id : await save();
    if (!fid || isNew) return;
    try { const r = await api<{ status: string }>(`/flows/${fid}/${action}`, { body: {} }); setStatus(r.status); setMsg({ tone: 'success', text: action === 'publish' ? 'Flow is live.' : 'Flow paused.' }); }
    catch (e) { setMsg({ tone: 'error', text: errorText(e) }); }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col md:h-screen">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2.5">
        <input className="input w-56 font-medium" value={name} onChange={(e) => setName(e.target.value)} aria-label="Flow name" />
        <StatusBadge status={status} />
        <TriggerEditor trigger={trigger} onChange={setTrigger} />
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost btn" onClick={save}>Save</button>
          {!isNew && (status === 'published'
            ? <button className="btn-ghost btn" onClick={() => setLive('pause')}>Pause</button>
            : <button className="btn btn-primary" onClick={() => setLive('publish')}>Publish</button>)}
        </div>
      </header>
      {msg && <div className="px-4 pt-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="flex min-h-0 flex-1">
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-line bg-white p-3 text-sm" aria-label="Add a step">
          {['Send', 'Logic', 'CRM'].map((g) => (
            <div key={g} className="mb-3">
              <div className="mb-1 text-xs font-medium uppercase text-muted">{g}</div>
              {KINDS.filter((k) => k.group === g).map((k) => <button key={k.kind} onClick={() => add(k.kind)} className="block w-full rounded px-2 py-1.5 text-left hover:bg-canvas">+ {k.label}</button>)}
            </div>
          ))}
        </aside>
        <div className="min-w-0 flex-1">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)} fitView fitViewOptions={{ maxZoom: 1 }} deleteKeyCode={['Backspace', 'Delete']}>
            <Background /><Controls />
          </ReactFlow>
        </div>
        {sel && sel.data.kind !== 'start' && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-white p-4 text-sm" aria-label="Step settings">
            <div className="mb-3 flex items-center justify-between"><b>{LABEL[sel.data.kind]}</b>
              <button className="text-danger" onClick={() => { setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id)); setSelected(null); }}>Delete</button></div>
            <StepForm kind={sel.data.kind} data={sel.data.data} onChange={update} tags={tags.data?.data ?? []} team={team.data?.data ?? []} templates={tpls.data?.data ?? []} pipelines={pipes.data?.data ?? []} />
            <p className="mt-4 text-xs text-muted">Use {'{{contact.name}}'}, {'{{contact.phone}}'} or {'{{var.name}}'} in text.</p>
          </aside>
        )}
      </div>
    </div>
  );
}

function TriggerEditor({ trigger, onChange }: { trigger: Trigger; onChange: (t: Trigger) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted">Starts on</span>
      <select className="input w-auto" aria-label="Trigger" value={trigger.type} onChange={(e) => {
        const t = e.target.value as Trigger['type'];
        onChange(t === 'keyword' ? { type: 'keyword', keywords: ['hi'], match: 'exact' } : { type: t } as Trigger);
      }}>
        <option value="keyword">Keyword</option><option value="new_conversation">New chat</option><option value="any_message">Any message</option>
      </select>
      {trigger.type === 'keyword' && <>
        <input className="input w-48" aria-label="Keywords, comma separated" value={trigger.keywords.join(', ')}
          onChange={(e) => onChange({ ...trigger, keywords: e.target.value.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) })} />
        <select className="input w-auto" aria-label="Match" value={trigger.match} onChange={(e) => onChange({ ...trigger, match: e.target.value as 'exact' | 'contains' })}>
          <option value="exact">is exactly</option><option value="contains">contains</option></select>
      </>}
    </div>
  );
}

function StepForm({ kind, data, onChange, tags, team, templates, pipelines }: { pipelines: Pipeline[]; kind: Kind; data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void;
  tags: { id: string; label: string }[]; team: { id: string; name: string }[]; templates: { id: string; name: string; language: string }[] }) {
  const set = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  const field = (k: string, label: string, opts: { type?: string; textarea?: boolean } = {}) => (
    <div className="mb-3"><label className="label" htmlFor={`f-${k}`}>{label}</label>
      {opts.textarea
        ? <textarea id={`f-${k}`} className="input" rows={4} value={String(data[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
        : <input id={`f-${k}`} className="input" type={opts.type ?? 'text'} value={String(data[k] ?? '')}
            onChange={(e) => set(k, opts.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)} />}
    </div>
  );
  const options = (k: 'buttons' | 'rows', max: number, label: string) => {
    const list = (data[k] as { id: string; title: string }[]) ?? [];
    return (
      <div className="mb-3"><span className="label">{label} (max {max}, 24 characters each)</span>
        {list.map((o, i) => (
          <div key={o.id} className="mb-1 flex gap-1">
            <input className="input" maxLength={24} value={o.title} aria-label={`${label} ${i + 1}`}
              onChange={(e) => set(k, list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <button className="px-2 text-danger" onClick={() => set(k, list.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
          </div>
        ))}
        {list.length < max && <button className="text-brand" onClick={() => set(k, [...list, { id: newId(), title: `Option ${list.length + 1}` }])}>+ Add</button>}
      </div>
    );
  };
  switch (kind) {
    case 'send_text': return field('text', 'Message', { textarea: true });
    case 'send_buttons': return <>{field('text', 'Message', { textarea: true })}{options('buttons', 3, 'Buttons')}</>;
    case 'send_list': return <>{field('text', 'Message', { textarea: true })}{field('button', 'Menu button text')}{options('rows', 10, 'Rows')}</>;
    case 'send_media': return (<>
      <div className="mb-3"><label className="label" htmlFor="f-mt">Type</label>
        <select id="f-mt" className="input" value={String(data.mediaType)} onChange={(e) => set('mediaType', e.target.value)}>
          {['image', 'document', 'video', 'audio'].map((t) => <option key={t}>{t}</option>)}</select></div>
      {field('url', 'Public https link')}{field('caption', 'Caption')}</>);
    case 'send_template': return (
      <div className="mb-3"><label className="label" htmlFor="f-t">Approved template</label>
        <select id="f-t" className="input" value={String(data.templateId ?? '')} onChange={(e) => set('templateId', e.target.value)}>
          <option value="">Choose…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}</select></div>);
    case 'wait_reply': return <>{field('saveAs', 'Save the reply as variable')}{field('timeoutMinutes', 'Give up after (minutes, empty = wait forever)', { type: 'number' })}</>;
    case 'delay': return field('minutes', 'Wait (minutes)', { type: 'number' });
    case 'condition': return (<>
      {field('left', 'Check')}
      <div className="mb-3"><label className="label" htmlFor="f-op">Is</label>
        <select id="f-op" className="input" value={String(data.op)} onChange={(e) => set('op', e.target.value)}>
          {[['eq', 'equal to'], ['neq', 'not equal to'], ['contains', 'containing'], ['exists', 'not empty'], ['gt', 'greater than'], ['lt', 'less than']]
            .map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      {data.op !== 'exists' && field('right', 'Value')}</>);
    case 'set_var': return <>{field('name', 'Variable name')}{field('value', 'Value')}</>;
    case 'add_tag': case 'remove_tag': return (
      <div className="mb-3"><label className="label" htmlFor="f-tag">Tag</label>
        <select id="f-tag" className="input" value={String(data.tagId ?? '')} onChange={(e) => set('tagId', e.target.value)}>
          <option value="">Choose…</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>);
    case 'assign_agent': return (
      <div className="mb-3"><label className="label" htmlFor="f-ag">Assign to</label>
        <select id="f-ag" className="input" value={String(data.userId)} onChange={(e) => set('userId', e.target.value)}>
          <option value="round_robin">Least busy agent</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>);
    case 'book_appointment': return (<>
      {field('text', 'Message above the list of times')}
      {field('button', 'List button (max 20 characters)')}
      {field('confirmText', 'Confirmation ({{var.appointment}} = the booked time; empty = none)')}
      <p className="text-xs text-muted">Shows the next 10 free times from Appointments → Booking hours. "not booked" runs when the customer types instead of tapping, the time was just taken, or nothing is free.</p>
    </>);
    case 'deal_stage': {
      const pipe = pipelines.find((p) => p.id === data.pipelineId) ?? (pipelines.length === 1 ? pipelines[0] : undefined);
      return (<>
        {pipelines.length > 1 && <div className="mb-3"><label className="label" htmlFor="f-pl">Pipeline</label>
          <select id="f-pl" className="input" value={String(data.pipelineId ?? '')} onChange={(e) => onChange({ ...data, pipelineId: e.target.value, stageId: '' })}>
            <option value="">Choose…</option>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
        <div className="mb-3"><label className="label" htmlFor="f-st">Move the contact's open deal to</label>
          <select id="f-st" className="input" value={String(data.stageId ?? '')} onChange={(e) => onChange({ ...data, pipelineId: pipe?.id ?? '', stageId: e.target.value })}>
            <option value="">Choose…</option>{(pipe?.stages ?? []).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select></div>
        {field('title', 'If the contact has no open deal, create one named (empty = "WhatsApp: <name>")')}
      </>);
    }
    case 'webhook': return <>{field('url', 'https URL (receives the contact and variables as JSON)')}{field('saveAs', 'Save the response as variable')}</>;
    default: return <p className="text-muted">No settings.</p>;
  }
}
