import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_INBOUND, FLOW_TIMER, flowInboundHandler, flowTimerHandler } from '../src/automation.js';
import { withTenant } from '../src/db.js';
import { claim, complete, type Handler } from '../src/jobs.js';
import { noopRealtime } from '../src/realtime.js';
import { setup, signup, bearer, signedWebhook, inboundText, connectNumber, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
let pipe: { id: string; stages: { id: string; name: string }[] };
const PNID = '444000111';
let n = 0;

before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'deals-bot@example.com');
  await connectNumber(ctx.app, owner.token, PNID, '444000999');
  ctx.setMetaResponse(() => ({ ok: true, status: 200, body: { messages: [{ id: `wamid.DB${++n}` }] } }));
  pipe = (await api('GET', '/pipelines')).json().data[0];
});
after(async () => { await ctx.close(); });

const api = (method: 'GET' | 'POST', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(owner.token), ...(payload ? { payload } : {}) });

async function drain() {
  const deps = { config: ctx.config, db: ctx.db, fetch: ctx.fetch, realtime: noopRealtime };
  const handlers: Record<string, Handler> = { [FLOW_INBOUND]: flowInboundHandler(deps), [FLOW_TIMER]: flowTimerHandler(deps) };
  for (let i = 0; i < 100; i++) {
    let handled = 0;
    for (const [q, h] of Object.entries(handlers)) {
      for (const job of await claim(ctx.db, q, 5)) { handled++; await h(job); await complete(ctx.db, job.id); }
    }
    if (!handled) return;
  }
}
let wam = 0;
async function say(phone: string, text: string) {
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText(PNID, phone, `wamid.DIN${++wam}`, text)) });
  await drain();
}
async function publish(keyword: string, stageId: string, title = '') {
  const r = await api('POST', '/flows', { name: `deal ${keyword}`, trigger: { type: 'keyword', keywords: [keyword], match: 'exact' }, graph: {
    nodes: [{ id: 's', type: 'start' }, { id: 'd', type: 'deal_stage', data: { pipelineId: pipe.id, stageId, title } }, { id: 'e', type: 'end' }],
    edges: [{ from: 's', to: 'd' }, { from: 'd', to: 'e' }] } });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal((await api('POST', `/flows/${r.json().id}/publish`)).statusCode, 200);
}
const dealsFor = (phone: string) => withTenant(ctx.db, owner.tenantId, async (tx) => (await tx.query<{ stage_id: string; title: string }>(
  `SELECT d.stage_id, d.title FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE c.phone_e164 = $1 AND d.status = 'open'`, [phone])).rows);

test('a flow opens a deal for a new lead, and a later flow moves the same deal', async () => {
  const [first, , third] = pipe.stages;
  await publish('price', first!.id, 'Price enquiry {{contact.phone}}');
  await publish('confirm', third!.id);

  await say('919800000001', 'price');
  let deals = await dealsFor('919800000001');
  assert.equal(deals.length, 1);
  assert.equal(deals[0]!.stage_id, first!.id);
  assert.match(deals[0]!.title, /^Price enquiry 919800000001$/);

  await say('919800000001', 'confirm');
  deals = await dealsFor('919800000001');
  assert.equal(deals.length, 1, 'the existing deal is moved, not duplicated');
  assert.equal(deals[0]!.stage_id, third!.id);
});

test('a stage that no longer exists fails the run instead of creating a stray deal', async () => {
  await publish('ghost', 'stage-that-was-deleted');
  await say('919800000002', 'ghost');
  assert.equal((await dealsFor('919800000002')).length, 0);
  const run = await withTenant(ctx.db, owner.tenantId, async (tx) => (await tx.query<{ status: string; error: string | null }>(
    `SELECT r.status, r.error FROM flow_runs r JOIN conversations cv ON cv.id = r.conversation_id JOIN contacts c ON c.id = cv.contact_id
     WHERE c.phone_e164 = '919800000002'`)).rows[0]);
  assert.equal(run?.status, 'failed');
  assert.match(run?.error ?? '', /no longer exists/);
});
