import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_INBOUND, FLOW_TIMER, flowInboundHandler, flowTimerHandler, isOpen, isSafeWebhookUrl, render } from '../src/automation.js';
import { withTenant } from '../src/db.js';
import { claim, complete, type Handler } from '../src/jobs.js';
import { noopRealtime } from '../src/realtime.js';
import { setup, signup, bearer, signedWebhook, inboundText, connectNumber, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
const PNID = '333000111';
let n = 0;

before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'bot@example.com');
  await connectNumber(ctx.app, owner.token, PNID, '333000999');
  ctx.setMetaResponse(() => ({ ok: true, status: 200, body: { messages: [{ id: `wamid.BOT${++n}` }] } }));
});
after(async () => { await ctx.close(); });

const api = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(owner.token), ...(payload ? { payload } : {}) });

/** Runs automation jobs until none are ready. */
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
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText(PNID, phone, `wamid.IN${++wam}`, text)) });
  await drain();
}
async function tap(phone: string, replyId: string, title: string) {
  const body = inboundText(PNID, phone, `wamid.IN${++wam}`, '');
  const msg = body.entry[0]!.changes[0]!.value.messages[0]! as Record<string, unknown>;
  msg.type = 'interactive';
  delete msg.text;
  msg.interactive = { type: 'button_reply', button_reply: { id: replyId, title } };
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(body) });
  await drain();
}
const textsTo = (phone: string) => ctx.sent
  .filter((s) => (s.body as { to?: string }).to === phone)
  .map((s) => { const b = s.body as { text?: { body: string }; interactive?: { body: { text: string } } }; return b.text?.body ?? b.interactive?.body.text; });

async function publish(name: string, trigger: object, nodes: object[], edges: object[]) {
  const r = await api('POST', '/flows', { name, trigger, graph: { nodes, edges } });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal((await api('POST', `/flows/${r.json().id}/publish`)).statusCode, 200);
  return r.json().id as string;
}

test('helpers: render, opening hours and webhook URL safety', () => {
  assert.equal(render('Hi {{contact.name}}, {{var.city}}!', { id: 'x', name: 'Priya', phone: '91' }, { city: 'Chennai' }), 'Hi Priya, Chennai!');
  const mon10 = new Date('2026-11-23T04:30:00Z');   // Monday 10:00 IST
  assert.equal(isOpen({ mon: [['09:00', '18:00']] }, 'Asia/Kolkata', mon10), true);
  assert.equal(isOpen({ mon: [['11:00', '18:00']] }, 'Asia/Kolkata', mon10), false);
  assert.equal(isOpen({}, 'Asia/Kolkata', mon10), false);
  for (const bad of ['http://example.com', 'https://localhost/x', 'https://127.0.0.1/', 'https://10.1.2.3/', 'https://192.168.0.5/',
    'https://169.254.169.254/latest/meta-data', 'https://[::1]/', 'https://user:pw@example.com/', 'https://db.internal/']) {
    assert.equal(isSafeWebhookUrl(bad), false, bad);
  }
  assert.equal(isSafeWebhookUrl('https://hooks.example.com/wa'), true);
});

test('an invalid graph is rejected', async () => {
  const noStart = await api('POST', '/flows', { name: 'x', trigger: { type: 'any_message' },
    graph: { nodes: [{ id: 'a', type: 'send_text', data: { text: 'hi' } }, { id: 'b', type: 'end' }], edges: [{ from: 'a', to: 'b' }] } });
  assert.equal(noStart.statusCode, 400);
  const dangling = await api('POST', '/flows', { name: 'x', trigger: { type: 'any_message' },
    graph: { nodes: [{ id: 's', type: 'start' }, { id: 'b', type: 'end' }], edges: [{ from: 's', to: 'nowhere' }] } });
  assert.equal(dangling.statusCode, 400);
});

test('a keyword flow replies, personalised; other messages do not trigger it', async () => {
  await publish('Price', { type: 'keyword', keywords: ['price', 'rate'] },
    [{ id: 's', type: 'start' }, { id: 't', type: 'send_text', data: { text: 'Hi {{contact.name}}, our plans start at ₹999/month.' } }],
    [{ from: 's', to: 't' }]);
  await say('919100000001', 'hello');
  assert.deepEqual(textsTo('919100000001'), []);
  await say('919100000001', ' PRICE ');
  assert.deepEqual(textsTo('919100000001'), ['Hi Priya, our plans start at ₹999/month.']);
});

test('buttons branch on the option the customer taps', async () => {
  await publish('Menu', { type: 'keyword', keywords: ['menu'] }, [
    { id: 's', type: 'start' },
    { id: 'm', type: 'send_buttons', data: { text: 'How can we help?', buttons: [{ id: 'sales', title: 'Sales' }, { id: 'support', title: 'Support' }] } },
    { id: 'a', type: 'send_text', data: { text: 'Connecting you to sales.' } },
    { id: 'b', type: 'send_text', data: { text: 'Support is on the way.' } },
  ], [{ from: 's', to: 'm' }, { from: 'm', to: 'a', handle: 'sales' }, { from: 'm', to: 'b', handle: 'support' }]);
  await say('919100000002', 'menu');
  await tap('919100000002', 'support', 'Support');
  assert.deepEqual(textsTo('919100000002'), ['How can we help?', 'Support is on the way.']);
});

test('wait for reply saves the answer and a late timer after the reply does nothing', async () => {
  await publish('Lead', { type: 'keyword', keywords: ['demo'] }, [
    { id: 's', type: 'start' },
    { id: 'q', type: 'send_text', data: { text: 'Which city are you in?' } },
    { id: 'w', type: 'wait_reply', data: { saveAs: 'city', timeoutMinutes: 30 } },
    { id: 'c', type: 'condition', data: { left: '{{var.city}}', op: 'eq', right: 'chennai' } },
    { id: 'yes', type: 'send_text', data: { text: 'Our Chennai team will call you.' } },
    { id: 'no', type: 'send_text', data: { text: 'Thanks, {{var.city}} noted.' } },
    { id: 'late', type: 'send_text', data: { text: 'Still there?' } },
  ], [{ from: 's', to: 'q' }, { from: 'q', to: 'w' }, { from: 'w', to: 'c' }, { from: 'w', to: 'late', handle: 'timeout' },
      { from: 'c', to: 'yes', handle: 'true' }, { from: 'c', to: 'no', handle: 'false' }]);
  await say('919100000003', 'demo');
  await say('919100000003', 'Chennai');
  await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE queue = '${FLOW_TIMER}' AND status = 'queued'`);
  await drain();
  assert.deepEqual(textsTo('919100000003'), ['Which city are you in?', 'Our Chennai team will call you.']);
});

test('no reply in time follows the timeout branch', async () => {
  await say('919100000004', 'demo');
  await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE queue = '${FLOW_TIMER}' AND status = 'queued'`);
  await drain();
  assert.deepEqual(textsTo('919100000004'), ['Which city are you in?', 'Still there?']);
});

test('the bot does not start when a person is handling the chat', async () => {
  await say('919100000005', 'hello');
  const conv = (await api('GET', '/conversations')).json().data.find((c: { contact_phone: string }) => c.contact_phone === '919100000005');
  const me = (await api('GET', '/team')).json().data[0].id;
  await ctx.app.inject({ method: 'PATCH', url: `/conversations/${conv.id}/assign`, headers: bearer(owner.token), payload: { userId: me } });
  await say('919100000005', 'price');
  assert.deepEqual(textsTo('919100000005'), []);
});

test('outside working hours the away message goes once per cooldown', async () => {
  const t = await signup(ctx.app, 'away@example.com');
  await connectNumber(ctx.app, t.token, '333000222', '333000888');
  const r = await ctx.app.inject({ method: 'PUT', url: '/settings/working-hours', headers: bearer(t.token), payload: {
    timezone: 'Asia/Kolkata', hours: {}, awayEnabled: true, awayMessage: 'We are closed now, {{contact.name}}. We reply by 10 AM.',
    awayCooldownMinutes: 240 } });
  assert.equal(r.statusCode, 200, r.body);
  const send = async (text: string) => {
    await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText('333000222', '919100000006', `wamid.AW${++wam}`, text)) });
    await drain();
  };
  await send('hello?');
  await send('anyone?');
  assert.deepEqual(textsTo('919100000006'), ['We are closed now, Priya. We reply by 10 AM.']);
});

test('node positions from the visual editor are saved and returned', async () => {
  const r = await api('POST', '/flows', { name: 'Layout', trigger: { type: 'any_message' }, graph: {
    nodes: [{ id: 's', type: 'start', position: { x: 10, y: 20 } }, { id: 'e', type: 'end', position: { x: 300, y: 20 } }],
    edges: [{ from: 's', to: 'e' }] } });
  assert.equal(r.statusCode, 201, r.body);
  const f = (await api('GET', `/flows/${r.json().id}`)).json();
  assert.deepEqual(f.nodes[0].position, { x: 10, y: 20 });
});
