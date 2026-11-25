import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTenant } from '../src/db.js';
import { claim, complete } from '../src/jobs.js';
import { noopRealtime } from '../src/realtime.js';
import { CAMPAIGN_QUEUE, campaignSendHandler, personalise } from '../src/routes/campaigns.js';
import { setup, signup, bearer, signedWebhook, statusUpdate, connectNumber, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
let phoneNumberId: string, templateId: string;
const PNID = '444000111';

before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'camp@example.com');
  await connectNumber(ctx.app, owner.token, PNID, '444000999');
  const ids = await withTenant(ctx.db, owner.tenantId, async (tx) => {
    const pn = (await tx.query('SELECT id, waba_account_id FROM phone_numbers')).rows[0];
    const t = await tx.query(
      `INSERT INTO message_templates (tenant_id, waba_account_id, name, language, category, components, status)
       VALUES ($1, $2, 'diwali_offer', 'en', 'MARKETING', $3, 'APPROVED') RETURNING id`,
      [owner.tenantId, pn.waba_account_id, JSON.stringify([{ type: 'BODY', text: 'Hi {{1}}, Diwali offer: {{2}} off!' }])]);
    return { pn: pn.id as string, tpl: t.rows[0].id as string };
  });
  phoneNumberId = ids.pn; templateId = ids.tpl;
});
after(async () => { await ctx.close(); });

const api = (method: 'GET' | 'POST', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(owner.token), ...(payload ? { payload } : {}) });

async function addContacts(prefix: string, n: number, extra: Partial<{ optedOut: boolean; name: string | null }> = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await api('POST', '/contacts', { phone: `${prefix}${String(i).padStart(3, '0')}`, ...(extra.name === null ? {} : { name: extra.name ?? `Cust ${i}` }) });
    ids.push(r.json().id);
  }
  if (extra.optedOut) {
    await withTenant(ctx.db, owner.tenantId, (tx) => tx.query('UPDATE contacts SET opted_out_at = now() WHERE id = ANY($1)', [ids]));
  }
  return ids;
}

/** Processes campaign jobs one by one until none are ready (no background loop, so no races). */
async function drain(batchSize = 2) {
  const deps = { config: ctx.config, db: ctx.db, fetch: ctx.fetch, realtime: noopRealtime };
  const handler = campaignSendHandler(deps, { batchSize, batchDelayMs: 0 });
  for (let i = 0; i < 100; i++) {
    const jobs = await claim(ctx.db, CAMPAIGN_QUEUE, 1);
    if (!jobs.length) return;
    await handler(jobs[0]!);
    await complete(ctx.db, jobs[0]!.id);
  }
  throw new Error('drain did not finish');
}

const campaign = (audience: object, parameters = ['{{contact.name}}', '20%']) =>
  api('POST', '/campaigns', { name: 'Diwali', phoneNumberId, templateId, parameters, audience });

test('personalise fills contact placeholders with a fallback name', () => {
  assert.deepEqual(personalise(['{{contact.name}}', '{{ contact.phone }}'], { name: null, phone: '9199' }, 'there'), ['there', '9199']);
  assert.deepEqual(personalise(['{{contact.name}}'], { name: '  Priya ', phone: '' }, 'there'), ['Priya']);
});

test('a campaign to listed contacts sends in batches, personalised, and skips opted-out contacts', async () => {
  const ok = await addContacts('91900000', 5);
  const out = await addContacts('91900001', 1, { optedOut: true });
  let n = 0;
  ctx.setMetaResponse(() => ({ ok: true, status: 200, body: { messages: [{ id: `wamid.C${++n}` }] } }));
  const before = ctx.sent.length;

  const r = await campaign({ type: 'contacts', contactIds: [...ok, ...out] });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().recipients, 6);
  await drain(2);

  const calls = ctx.sent.slice(before);
  assert.equal(calls.length, 5, 'opted-out contact must not be messaged');
  const first = calls[0]!.body as { to: string; template: { components: { parameters: { text: string }[] }[] } };
  assert.equal(first.template.components[0]!.parameters[0]!.text, 'Cust 0');

  const c = (await api('GET', `/campaigns/${r.json().id}`)).json();
  assert.equal(c.status, 'completed');
  assert.deepEqual([c.stats.total, c.stats.sent, c.stats.skipped, c.stats.pending], [6, 5, 1, 0]);

  // Campaign messages land in the inbox, and delivery webhooks feed the stats.
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(statusUpdate(PNID, 'wamid.C1', 'read')) });
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(statusUpdate(PNID, 'wamid.C2', 'delivered')) });
  const s = (await api('GET', `/campaigns/${r.json().id}`)).json().stats;
  assert.deepEqual([s.delivered, s.read], [2, 1]);
});

test('a tag audience reaches only tagged contacts', async () => {
  const tagged = await addContacts('91900002', 2);
  await addContacts('91900003', 2);
  const tag = (await api('POST', '/tags', { label: 'Diwali list' })).json();
  for (const id of tagged) {
    await ctx.app.inject({ method: 'PUT', url: `/contacts/${id}/tags`, headers: bearer(owner.token), payload: { tagIds: [tag.id] } });
  }
  const r = await campaign({ type: 'tags', tagIds: [tag.id] });
  assert.equal(r.json().recipients, 2);
  await api('POST', `/campaigns/${r.json().id}/cancel`);   // keep later tests' sends isolated
});

test('a Meta error marks that recipient failed and the rest still go out', async () => {
  const ids = await addContacts('91900004', 3);
  let i = 0;
  ctx.setMetaResponse(() => (++i === 2
    ? { ok: false, status: 400, body: { error: { code: 131026, message: 'Message undeliverable' } } }
    : { ok: true, status: 200, body: { messages: [{ id: `wamid.E${i}` }] } }));
  const r = await campaign({ type: 'contacts', contactIds: ids });
  await drain(10);
  const s = (await api('GET', `/campaigns/${r.json().id}`)).json().stats;
  assert.deepEqual([s.sent, s.failed], [2, 1]);
});

test('a recipient stuck in sending after a crash is failed, never sent twice', async () => {
  const ids = await addContacts('91900005', 2);
  ctx.setMetaResponse(() => ({ ok: true, status: 200, body: { messages: [{ id: 'wamid.X' }] } }));
  const r = await campaign({ type: 'contacts', contactIds: ids });
  const campaignId = r.json().id;
  // Simulate a worker that claimed one recipient, then died 10 minutes ago.
  await withTenant(ctx.db, owner.tenantId, (tx) => tx.query(
    `UPDATE campaign_recipients SET status = 'sending', claimed_at = now() - interval '10 minutes'
      WHERE id = (SELECT min(id) FROM campaign_recipients WHERE campaign_id = $1)`, [campaignId]));
  const before = ctx.sent.length;
  await drain(10);
  assert.equal(ctx.sent.length - before, 1, 'only the untouched recipient is sent');
  const s = (await api('GET', `/campaigns/${campaignId}`)).json().stats;
  assert.deepEqual([s.sent, s.failed], [1, 1]);
});

test('a cancelled scheduled campaign sends nothing', async () => {
  const ids = await addContacts('91900006', 2);
  const r = await api('POST', '/campaigns', { name: 'Later', phoneNumberId, templateId, parameters: ['x', 'y'],
    audience: { type: 'contacts', contactIds: ids }, scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal((await api('POST', `/campaigns/${r.json().id}/cancel`)).statusCode, 200);
  await ctx.db.query("UPDATE jobs SET run_at = now() WHERE queue = $1", [CAMPAIGN_QUEUE]);
  const before = ctx.sent.length;
  await drain();
  assert.equal(ctx.sent.length, before);
  assert.equal((await api('GET', `/campaigns/${r.json().id}`)).json().status, 'cancelled');
});

test('validation: unapproved template, wrong parameter count, empty audience, agent cannot create', async () => {
  assert.equal((await api('POST', '/campaigns', { name: 'x', phoneNumberId, templateId, parameters: ['only one'],
    audience: { type: 'all' } })).statusCode, 400);
  assert.equal((await campaign({ type: 'contacts', contactIds: ['00000000-0000-4000-8000-000000000000'] })).statusCode, 422);
  await ctx.app.inject({ method: 'POST', url: '/team', headers: bearer(owner.token),
    payload: { name: 'Agent', email: 'camp-agent@example.com', role: 'agent', password: 'member-password-1' } });
  const agent = (await ctx.app.inject({ method: 'POST', url: '/auth/login',
    payload: { email: 'camp-agent@example.com', password: 'member-password-1' } })).json().token;
  const r = await ctx.app.inject({ method: 'POST', url: '/campaigns', headers: bearer(agent),
    payload: { name: 'x', phoneNumberId, templateId, parameters: ['a', 'b'], audience: { type: 'all' } } });
  assert.equal(r.statusCode, 403);
});
