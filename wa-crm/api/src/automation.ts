import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { Deps } from './app.js';
import { decryptSecret } from './crypto.js';
import { withTenant, type Tx } from './db.js';
import { enqueue, PermanentJobError, type Handler } from './jobs.js';
import { bookSlot, BookingError, formatWhen, listFreeSlots, loadSettings } from './booking.js';
import { MetaApiError, sendRaw, sendTemplate, sendText } from './meta.js';

export const FLOW_INBOUND = 'flow.inbound';
export const FLOW_TIMER = 'flow.timer';
const MAX_STEPS_PER_EXECUTION = 30;
const MAX_STEPS_PER_RUN = 500;

// ---------- graph schema ----------

const id = z.string().min(1).max(64);
const text = z.string().min(1).max(4096);
const replyOption = z.object({ id: z.string().min(1).max(256), title: z.string().min(1).max(24) });

export const nodeSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('start'), data: z.object({}).default({}) }),
  z.object({ id, type: z.literal('send_text'), data: z.object({ text }) }),
  z.object({ id, type: z.literal('send_buttons'), data: z.object({ text: z.string().min(1).max(1024), buttons: z.array(replyOption).min(1).max(3) }) }),
  z.object({ id, type: z.literal('send_list'), data: z.object({ text: z.string().min(1).max(1024), button: z.string().min(1).max(20),
    rows: z.array(replyOption.extend({ description: z.string().max(72).optional() })).min(1).max(10) }) }),
  z.object({ id, type: z.literal('send_media'), data: z.object({ mediaType: z.enum(['image', 'document', 'video', 'audio']),
    url: z.string().url().startsWith('https://'), caption: z.string().max(1024).optional() }) }),
  z.object({ id, type: z.literal('send_template'), data: z.object({ templateId: z.string().uuid(), parameters: z.array(z.string().max(1024)).max(20).default([]) }) }),
  z.object({ id, type: z.literal('wait_reply'), data: z.object({ saveAs: z.string().regex(/^[a-z_][a-z0-9_]{0,39}$/).optional(),
    timeoutMinutes: z.number().int().min(1).max(10080).optional() }) }),
  z.object({ id, type: z.literal('delay'), data: z.object({ minutes: z.number().int().min(1).max(10080) }) }),
  z.object({ id, type: z.literal('condition'), data: z.object({ left: z.string().max(200), op: z.enum(['eq', 'neq', 'contains', 'exists', 'gt', 'lt']),
    right: z.string().max(200).default('') }) }),
  z.object({ id, type: z.literal('set_var'), data: z.object({ name: z.string().regex(/^[a-z_][a-z0-9_]{0,39}$/), value: z.string().max(1024) }) }),
  z.object({ id, type: z.literal('add_tag'), data: z.object({ tagId: z.string().uuid() }) }),
  z.object({ id, type: z.literal('remove_tag'), data: z.object({ tagId: z.string().uuid() }) }),
  z.object({ id, type: z.literal('assign_agent'), data: z.object({ userId: z.union([z.string().uuid(), z.literal('round_robin')]) }) }),
  z.object({ id, type: z.literal('webhook'), data: z.object({ url: z.string().url().startsWith('https://'), saveAs: z.string().regex(/^[a-z_][a-z0-9_]{0,39}$/).optional() }) }),
  z.object({ id, type: z.literal('deal_stage'), data: z.object({ pipelineId: z.string().uuid(), stageId: z.string().min(1).max(64),
    title: z.string().max(160).default('') }) }),
  z.object({ id, type: z.literal('book_appointment'), data: z.object({
    text: z.string().min(1).max(1024).default('Pick a time that suits you'),
    button: z.string().min(1).max(20).default('See times'),
    confirmText: z.string().max(1024).default('You are booked for {{var.appointment}}. See you then!') }) }),
  z.object({ id, type: z.literal('close_conversation'), data: z.object({}).default({}) }),
  z.object({ id, type: z.literal('end'), data: z.object({}).default({}) }),
]);
export type FlowNode = z.infer<typeof nodeSchema>;
const edgeSchema = z.object({ from: id, to: id, handle: z.string().max(256).optional() });
export type FlowEdge = z.infer<typeof edgeSchema>;

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('keyword'), keywords: z.array(z.string().trim().toLowerCase().min(1).max(60)).min(1).max(30),
    match: z.enum(['exact', 'contains']).default('exact') }),
  z.object({ type: z.literal('new_conversation') }),
  z.object({ type: z.literal('any_message') }),
]);
export type FlowTrigger = z.infer<typeof triggerSchema>;

// Canvas position is stored for the visual editor; the engine ignores it.
const positioned = z.intersection(nodeSchema, z.object({ position: z.object({ x: z.number(), y: z.number() }).optional() }));
export const graphSchema = z.object({ nodes: z.array(positioned).min(2).max(200), edges: z.array(edgeSchema).max(400) })
  .superRefine((g, ctx) => {
    const ids = new Set<string>();
    for (const n of g.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `duplicate node id ${n.id}` });
      ids.add(n.id);
    }
    if (g.nodes.filter((n) => n.type === 'start').length !== 1) ctx.addIssue({ code: 'custom', message: 'exactly one start node is required' });
    for (const e of g.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) ctx.addIssue({ code: 'custom', message: `edge ${e.from}->${e.to} points at a missing node` });
    }
    // Every step must be reachable from Start, or it can never run.
    const start = g.nodes.find((n) => n.type === 'start');
    if (start) {
      const seen = new Set([start.id]);
      const queue = [start.id];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const e of g.edges) if (e.from === cur && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
      }
      const orphans = g.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
      if (orphans.length) ctx.addIssue({ code: 'custom', message: `steps not connected to Start: ${orphans.join(', ')}` });
    }
    const endIds = new Set(g.nodes.filter((n) => n.type === 'end').map((n) => n.id));
    if (g.edges.some((e) => endIds.has(e.from))) ctx.addIssue({ code: 'custom', message: 'an end node cannot have outgoing edges' });
  });

// ---------- helpers ----------

interface Contact { id: string; name: string | null; phone: string }
type Vars = Record<string, string>;

export function render(tpl: string, contact: Contact, vars: Vars): string {
  return tpl.replace(/\{\{\s*contact\.name\s*\}\}/g, contact.name ?? '')
    .replace(/\{\{\s*contact\.phone\s*\}\}/g, contact.phone)
    .replace(/\{\{\s*var\.([a-z_][a-z0-9_]*)\s*\}\}/g, (_m, k: string) => vars[k] ?? '');
}

export function evaluate(op: string, left: string, right: string): boolean {
  const l = left.trim().toLowerCase(), r = right.trim().toLowerCase();
  switch (op) {
    case 'eq': return l === r;
    case 'neq': return l !== r;
    case 'contains': return l.includes(r);
    case 'exists': return l.length > 0;
    case 'gt': return Number(left) > Number(right);
    case 'lt': return Number(left) < Number(right);
    default: return false;
  }
}

/** Is `now` inside the opening hours? Missing day = closed. Hours like {"mon":[["09:00","18:00"]]}. */
export function isOpen(hours: Record<string, [string, string][]>, timezone: string, now = new Date()): boolean {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  const day = String(parts.weekday).slice(0, 3).toLowerCase();
  const hm = `${parts.hour}:${parts.minute}`;
  return (hours[day] ?? []).some(([from, to]) => hm >= from && hm < to);
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
/** Blocks obvious internal targets. DNS names that resolve to private IPs are not caught here (see README). */
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const ipv = isIP(host);
  if (ipv === 4) return !PRIVATE_V4.some((re) => re.test(host));
  if (ipv === 6) return !(host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:'));
  return true;
}

function nextEdge(edges: FlowEdge[], from: string, handle?: string | null): string | null {
  const out = edges.filter((e) => e.from === from);
  if (handle) {
    const hit = out.find((e) => e.handle === handle);
    if (hit) return hit.to;
  }
  return out.find((e) => !e.handle)?.to ?? null;
}

class FlowError extends Error {}

interface ConvCtx {
  conversation_id: string; contact_id: string; phone: string; name: string | null;
  assigned_user_id: string | null; pn_id: string; meta_pn: string; token: string; waba_account_id: string;
}

async function loadConv(tx: Tx, conversationId: string): Promise<ConvCtx | undefined> {
  return (await tx.query<ConvCtx>(
    `SELECT c.id AS conversation_id, ct.id AS contact_id, ct.phone_e164 AS phone, ct.name, c.assigned_user_id,
            pn.id AS pn_id, pn.meta_phone_number_id AS meta_pn, w.access_token_enc AS token, pn.waba_account_id
       FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
       JOIN phone_numbers pn ON pn.id = c.phone_number_id JOIN waba_accounts w ON w.id = pn.waba_account_id
      WHERE c.id = $1`, [conversationId])).rows[0];
}

/** Sends a message and records it in the inbox like any other outbound message. */
async function sendAndRecord(deps: Deps, tenantId: string, c: ConvCtx, type: string, bodyText: string,
  send: (token: string) => Promise<string>): Promise<void> {
  let wamid: string;
  try {
    wamid = await send(decryptSecret(c.token, deps.config.TOKEN_ENCRYPTION_KEY));
  } catch (err) {
    if (err instanceof MetaApiError) throw new FlowError(`meta ${err.status}: ${JSON.stringify(err.detail).slice(0, 300)}`);
    throw err;
  }
  const saved = await withTenant(deps.db, tenantId, async (tx) => {
    const m = await tx.query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, type, body, wa_message_id, status)
       VALUES ($1, $2, 'outbound', $3, $4, $5, 'sent') RETURNING id, direction, type, body, status, created_at`,
      [tenantId, c.conversation_id, type, bodyText, wamid]);
    await tx.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [c.conversation_id]);
    return m.rows[0];
  });
  deps.realtime.conversation(tenantId, c.assigned_user_id, 'message.created', { conversationId: c.conversation_id, message: saved });
}

// ---------- engine ----------

interface RunRow { id: string; nodes: FlowNode[]; edges: FlowEdge[]; current_node: string; vars: Vars; steps: number; conversation_id: string }

/**
 * Runs a flow from its current node until it waits, ends or fails.
 * `resumeHandle` picks the outgoing edge of the node being resumed (button id, 'timeout', ...).
 */
export async function execute(deps: Deps, tenantId: string, run: RunRow, resumeHandle?: string | null): Promise<void> {
  const vars: Vars = { ...run.vars };
  let current: string | null = run.current_node;
  let steps = run.steps;
  const ctx = await withTenant(deps.db, tenantId, (tx) => loadConv(tx, run.conversation_id));
  if (!ctx) throw new PermanentJobError('conversation gone');
  const contact: Contact = { id: ctx.contact_id, name: ctx.name, phone: ctx.phone };
  const save = (status: string, extra: { wait_token?: string | null; error?: string | null } = {}) =>
    withTenant(deps.db, tenantId, (tx) => tx.query(
      `UPDATE flow_runs SET current_node = $2, vars = $3, steps = $4, status = $5, wait_token = $6, error = $7 WHERE id = $1`,
      [run.id, current ?? run.current_node, JSON.stringify(vars), steps, status, extra.wait_token ?? null, extra.error ?? null]));

  // Leaving the node we were waiting on. A booking step keeps the reply and handles it itself.
  let slotReply: string | null | undefined;
  if (resumeHandle !== undefined) {
    const nodeNow = run.nodes.find((n) => n.id === current);
    if (nodeNow?.type === 'book_appointment') slotReply = resumeHandle;
    else current = nodeNow ? nextEdge(run.edges, nodeNow.id, resumeHandle) : null;
  }

  try {
    for (let i = 0; i < MAX_STEPS_PER_EXECUTION; i++) {
      if (!current) { await save('completed'); return; }
      const node = run.nodes.find((n) => n.id === current);
      if (!node) throw new FlowError(`missing node ${current}`);
      if (++steps > MAX_STEPS_PER_RUN) throw new FlowError('step limit reached (loop?)');
      const d = node.data as Record<string, unknown>;
      const r = (s: string) => render(s, contact, vars);

      switch (node.type) {
        case 'start':
          current = nextEdge(run.edges, node.id); break;
        case 'send_text': {
          const body = r(node.data.text);
          await sendAndRecord(deps, tenantId, ctx, 'text', body, (tok) => sendRaw(deps.fetch, deps.config.META_GRAPH_VERSION, ctx.meta_pn, tok, ctx.phone,
            { type: 'text', text: { body } }));
          current = nextEdge(run.edges, node.id); break;
        }
        case 'send_media': {
          const caption = node.data.caption ? r(node.data.caption) : undefined;
          await sendAndRecord(deps, tenantId, ctx, node.data.mediaType, caption ?? node.data.url, (tok) => sendRaw(deps.fetch,
            deps.config.META_GRAPH_VERSION, ctx.meta_pn, tok, ctx.phone,
            { type: node.data.mediaType, [node.data.mediaType]: { link: node.data.url, ...(caption && node.data.mediaType !== 'audio' ? { caption } : {}) } }));
          current = nextEdge(run.edges, node.id); break;
        }
        case 'send_buttons':
        case 'send_list': {
          const body = r(node.data.text);
          const interactive = node.type === 'send_buttons'
            ? { type: 'button', body: { text: body }, action: { buttons: node.data.buttons.map((b) => ({ type: 'reply', reply: b })) } }
            : { type: 'list', body: { text: body }, action: { button: node.data.button, sections: [{ title: node.data.button, rows: node.data.rows }] } };
          await sendAndRecord(deps, tenantId, ctx, 'interactive', body, (tok) => sendRaw(deps.fetch, deps.config.META_GRAPH_VERSION,
            ctx.meta_pn, tok, ctx.phone, { type: 'interactive', interactive }));
          await save('waiting_reply'); return;   // resumes on the customer's tap, edge chosen by the option id
        }
        case 'send_template': {
          const t = await withTenant(deps.db, tenantId, async (tx) => (await tx.query<{ name: string; language: string; status: string }>(
            'SELECT name, language, status FROM message_templates WHERE id = $1 AND waba_account_id = $2',
            [node.data.templateId, ctx.waba_account_id])).rows[0]);
          if (!t || t.status !== 'APPROVED') throw new FlowError('template missing or not approved');
          const params = node.data.parameters.map(r);
          const components = params.length ? [{ type: 'body', parameters: params.map((x) => ({ type: 'text', text: x })) }] : [];
          await sendAndRecord(deps, tenantId, ctx, 'template', `[template ${t.name}]`, (tok) => sendTemplate(deps.fetch,
            deps.config.META_GRAPH_VERSION, ctx.meta_pn, tok, ctx.phone, { name: t.name, language: t.language, components }));
          current = nextEdge(run.edges, node.id); break;
        }
        case 'wait_reply': {
          const token = randomUUID();
          await save('waiting_reply', { wait_token: token });
          if (node.data.timeoutMinutes) {
            await enqueue(deps.db, FLOW_TIMER, { runId: run.id, waitToken: token, kind: 'timeout' },
              { tenantId, runAt: new Date(Date.now() + node.data.timeoutMinutes * 60_000) });
          }
          return;
        }
        case 'delay': {
          const token = randomUUID();
          await save('waiting_timer', { wait_token: token });
          await enqueue(deps.db, FLOW_TIMER, { runId: run.id, waitToken: token, kind: 'delay' },
            { tenantId, runAt: new Date(Date.now() + node.data.minutes * 60_000) });
          return;
        }
        case 'condition':
          current = nextEdge(run.edges, node.id, evaluate(node.data.op, r(node.data.left), r(node.data.right)) ? 'true' : 'false'); break;
        case 'set_var':
          vars[node.data.name] = r(node.data.value); current = nextEdge(run.edges, node.id); break;
        case 'add_tag':
        case 'remove_tag':
          await withTenant(deps.db, tenantId, (tx) => node.type === 'add_tag'
            ? tx.query(`INSERT INTO contact_tags (tenant_id, contact_id, tag_id) SELECT $1, $2, id FROM tags WHERE id = $3
                        ON CONFLICT DO NOTHING`, [tenantId, ctx.contact_id, d.tagId])
            : tx.query('DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2', [ctx.contact_id, d.tagId]));
          current = nextEdge(run.edges, node.id); break;
        case 'assign_agent': {
          const userId = await withTenant(deps.db, tenantId, async (tx) => {
            const uid = node.data.userId === 'round_robin'
              ? (await tx.query<{ id: string | null }>('SELECT pick_round_robin_agent() AS id')).rows[0]?.id ?? null
              : (await tx.query<{ ok: boolean }>('SELECT is_tenant_member($1) AS ok', [node.data.userId])).rows[0]?.ok ? node.data.userId : null;
            if (uid) await tx.query('UPDATE conversations SET assigned_user_id = $2 WHERE id = $1', [ctx.conversation_id, uid]);
            return uid;
          });
          if (userId) {
            ctx.assigned_user_id = userId;
            deps.realtime.conversation(tenantId, userId, 'conversation.assigned', { conversationId: ctx.conversation_id, userId });
          }
          current = nextEdge(run.edges, node.id); break;
        }
        case 'webhook': {
          if (!isSafeWebhookUrl(node.data.url)) throw new FlowError('webhook url not allowed');
          const res = await deps.fetch(node.data.url, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ conversationId: ctx.conversation_id, contact: { name: ctx.name, phone: ctx.phone }, vars }) });
          if (node.data.saveAs) {
            const out = await res.json().catch(() => null);
            vars[node.data.saveAs] = res.ok && out !== null ? JSON.stringify(out).slice(0, 2000) : `error:${res.status}`;
          }
          current = nextEdge(run.edges, node.id, res.ok ? 'ok' : 'error'); break;
        }
        case 'deal_stage': {
          // Moves the contact's newest open deal in this pipeline to the stage, or opens a deal there if none exists.
          const { pipelineId, stageId } = node.data;
          const ok = await withTenant(deps.db, tenantId, async (tx) => {
            const p = await tx.query<{ ok: boolean }>('SELECT stages @> $2::jsonb AS ok FROM pipelines WHERE id = $1',
              [pipelineId, JSON.stringify([{ id: stageId }])]);
            if (!p.rows[0]?.ok) return false;
            const nextPos = '(SELECT COALESCE(max(position), 0) + 1 FROM deals WHERE pipeline_id = $1 AND stage_id = $2)';
            const moved = await tx.query(
              `UPDATE deals SET stage_id = $2, position = ${nextPos}
               WHERE id = (SELECT id FROM deals WHERE pipeline_id = $1 AND contact_id = $3 AND status = 'open' ORDER BY created_at DESC LIMIT 1)`,
              [pipelineId, stageId, ctx.contact_id]);
            if (!moved.rowCount) {
              const title = (r(node.data.title).trim() || `WhatsApp: ${ctx.name ?? `+${ctx.phone}`}`).slice(0, 160);
              await tx.query(
                `INSERT INTO deals (tenant_id, pipeline_id, stage_id, contact_id, title, owner_user_id, position)
                 VALUES ($4, $1, $2, $3, $5, $6, ${nextPos})`,
                [pipelineId, stageId, ctx.contact_id, tenantId, title, ctx.assigned_user_id]);
            }
            return true;
          });
          if (!ok) throw new FlowError('pipeline or stage no longer exists');
          current = nextEdge(run.edges, node.id); break;
        }
        case 'book_appointment': {
          if (slotReply !== undefined) {
            // The customer answered the list: book the tapped slot. Typed text or a slot taken meanwhile → 'failed'.
            const reply = slotReply; slotReply = undefined;
            const at = reply?.startsWith('slot:') ? new Date(reply.slice(5)) : null;
            let booked: { when: string } | null = null;
            if (at && !Number.isNaN(at.getTime())) {
              try {
                booked = await withTenant(deps.db, tenantId, (tx) => bookSlot(tx, tenantId, { contactId: ctx.contact_id, startsAt: at, source: 'flow' }));
              } catch (err) { if (!(err instanceof BookingError)) throw err; }
            }
            vars.appointment = booked?.when ?? '';
            if (booked && node.data.confirmText.trim()) {
              const body = render(node.data.confirmText, contact, vars);
              await sendAndRecord(deps, tenantId, ctx, 'text', body, (tok) => sendText(deps.fetch, deps.config.META_GRAPH_VERSION, ctx.meta_pn, tok, ctx.phone, body));
            }
            current = nextEdge(run.edges, node.id, booked ? 'booked' : 'failed'); break;
          }
          // Offer the next free slots as a WhatsApp list (10 rows at most).
          const slots = await withTenant(deps.db, tenantId, async (tx) => {
            const s = await loadSettings(tx);
            const now = new Date();
            return (await listFreeSlots(tx, now, now, new Date(now.getTime() + s.days_ahead * 86400000), 10))
              .map((d) => ({ id: `slot:${d.toISOString()}`, title: formatWhen(d, s.timezone).slice(0, 24) }));
          });
          if (!slots.length) { vars.appointment = ''; current = nextEdge(run.edges, node.id, 'failed'); break; }
          const body = r(node.data.text);
          await sendAndRecord(deps, tenantId, ctx, 'interactive', body, (tok) => sendRaw(deps.fetch, deps.config.META_GRAPH_VERSION,
            ctx.meta_pn, tok, ctx.phone, { type: 'interactive', interactive: { type: 'list', body: { text: body },
              action: { button: node.data.button, sections: [{ title: 'Available times', rows: slots }] } } }));
          await save('waiting_reply'); return;
        }
        case 'close_conversation':
          await withTenant(deps.db, tenantId, (tx) => tx.query("UPDATE conversations SET status = 'closed' WHERE id = $1", [ctx.conversation_id]));
          current = nextEdge(run.edges, node.id); break;
        case 'end':
          current = null; break;
      }
    }
    throw new FlowError('too many steps in one go (loop without a wait?)');
  } catch (err) {
    if (!(err instanceof FlowError)) throw err;
    await save('failed', { error: err.message.slice(0, 1000) });
  }
}

// ---------- job handlers ----------

/** Inbound message: resume a waiting run, else start a matching flow, else maybe send the away message. */
export function flowInboundHandler(deps: Deps): Handler {
  return async (job) => {
    const tenantId = job.tenant_id;
    const { conversationId, body, replyId, isNew } = job.payload as { conversationId?: string; body?: string | null; replyId?: string | null; isNew?: boolean };
    if (!tenantId || !conversationId) throw new PermanentJobError('bad payload');
    const text = (body ?? '').trim();

    // 1. A run waiting for this reply. The conditional update makes sure only one worker resumes it.
    const resumed = await withTenant(deps.db, tenantId, async (tx) => (await tx.query<RunRow & { saveAs: string | null }>(
      `UPDATE flow_runs SET status = 'running', wait_token = NULL
        WHERE conversation_id = $1 AND status = 'waiting_reply'
        RETURNING id, nodes, edges, current_node, vars, steps, conversation_id`, [conversationId])).rows[0]);
    if (resumed) {
      const node = resumed.nodes.find((n) => n.id === resumed.current_node);
      if (node?.type === 'wait_reply' && node.data.saveAs) resumed.vars = { ...resumed.vars, [node.data.saveAs]: text };
      resumed.vars = { ...resumed.vars, last_reply: text };
      await execute(deps, tenantId, resumed, replyId ?? text.toLowerCase());
      return;
    }

    // 2. Start a matching flow (not when a person is handling the chat).
    const start = await withTenant(deps.db, tenantId, async (tx) => {
      const conv = (await tx.query<{ assigned_user_id: string | null; phone_number_id: string }>(
        'SELECT assigned_user_id, phone_number_id FROM conversations WHERE id = $1', [conversationId])).rows[0];
      if (!conv || conv.assigned_user_id) return null;
      const flows = (await tx.query<{ id: string; trigger: FlowTrigger; nodes: FlowNode[]; edges: FlowEdge[] }>(
        `SELECT id, trigger, nodes, edges FROM flows
          WHERE status = 'published' AND (phone_number_id IS NULL OR phone_number_id = $1) ORDER BY created_at`, [conv.phone_number_id])).rows;
      const lower = text.toLowerCase();
      const pick = flows.find((f) => f.trigger.type === 'keyword' && f.trigger.keywords.some((k) =>
          f.trigger.type === 'keyword' && (f.trigger.match === 'contains' ? lower.includes(k) : lower === k)))
        ?? (isNew ? flows.find((f) => f.trigger.type === 'new_conversation') : undefined)
        ?? flows.find((f) => f.trigger.type === 'any_message');
      if (!pick) return null;
      const startNode = pick.nodes.find((n) => n.type === 'start')!;
      const r = await tx.query<RunRow>(
        `INSERT INTO flow_runs (tenant_id, flow_id, conversation_id, nodes, edges, current_node, vars)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (conversation_id) WHERE status IN ('running','waiting_reply','waiting_timer') DO NOTHING
         RETURNING id, nodes, edges, current_node, vars, steps, conversation_id`,
        [tenantId, pick.id, conversationId, JSON.stringify(pick.nodes), JSON.stringify(pick.edges), startNode.id,
         JSON.stringify({ first_message: text })]);
      return r.rows[0] ?? null;
    });
    if (start) { await execute(deps, tenantId, start); return; }

    // 3. Away message outside working hours (at most once per cooldown per conversation).
    const away = await withTenant(deps.db, tenantId, async (tx) => {
      const s = (await tx.query<{ timezone: string; hours: Record<string, [string, string][]>; away_enabled: boolean;
        away_message: string | null; away_cooldown_min: number }>('SELECT * FROM inbox_settings')).rows[0];
      if (!s?.away_enabled || !s.away_message || isOpen(s.hours, s.timezone)) return null;
      const claimed = await tx.query(
        `UPDATE conversations SET away_sent_at = now()
          WHERE id = $1 AND (away_sent_at IS NULL OR away_sent_at < now() - make_interval(mins => $2)) RETURNING id`,
        [conversationId, s.away_cooldown_min]);
      return claimed.rowCount ? { message: s.away_message, ctx: await loadConv(tx, conversationId) } : null;
    });
    if (away?.ctx) {
      const c = away.ctx;
      const body = render(away.message, { id: c.contact_id, name: c.name, phone: c.phone }, {});
      try {
        await sendAndRecord(deps, tenantId, c, 'text', body, (tok) => sendRaw(deps.fetch, deps.config.META_GRAPH_VERSION, c.meta_pn, tok, c.phone,
          { type: 'text', text: { body } }));
      } catch (err) {
        if (!(err instanceof FlowError)) throw err;   // away message is best effort
      }
    }
  };
}

/** Delay finished or reply wait timed out. Acts only if the run is still waiting on that same token. */
export function flowTimerHandler(deps: Deps): Handler {
  return async (job) => {
    const tenantId = job.tenant_id;
    const { runId, waitToken, kind } = job.payload as { runId?: string; waitToken?: string; kind?: string };
    if (!tenantId || !runId || !waitToken) throw new PermanentJobError('bad payload');
    const run = await withTenant(deps.db, tenantId, async (tx) => (await tx.query<RunRow>(
      `UPDATE flow_runs SET status = 'running', wait_token = NULL
        WHERE id = $1 AND wait_token = $2 AND status IN ('waiting_reply','waiting_timer')
        RETURNING id, nodes, edges, current_node, vars, steps, conversation_id`, [runId, waitToken])).rows[0]);
    if (!run) return;   // already resumed by a reply, or cancelled
    await execute(deps, tenantId, run, kind === 'timeout' ? 'timeout' : null);
  };
}
