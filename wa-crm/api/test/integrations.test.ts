import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withPlatform, withTenant } from '../src/db.js';
import { IMPORT_QUEUE, importHandler, normalisePhone, parseCsv, WEBHOOK_QUEUE, webhookDeliverHandler } from '../src/integrations.js';
import { claim, complete, fail, type Handler } from '../src/jobs.js';
import { noopRealtime } from '../src/realtime.js';
import { setup, signup, bearer, signedWebhook, inboundText, connectNumber, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'integr@example.com');
});
after(async () => { await ctx.close(); });

const api = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object, headers = bearer(owner.token)) =>
  ctx.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

async function run(queue: string, h: Handler) {
  for (let i = 0; i < 20; i++) {
    const jobs = await claim(ctx.db, queue, 5);
    if (!jobs.length) return;
    for (const j of jobs) { try { await h(j); await complete(ctx.db, j.id); } catch (e) { await fail(ctx.db, j, e); } }
  }
}
const deps = () => ({ config: ctx.config, db: ctx.db, fetch: ctx.fetch, realtime: noopRealtime });

test('CSV parser handles quotes, commas, newlines and a BOM', () => {
  assert.deepEqual(parseCsv('﻿phone,name\r\n"98765 43210","Sharma, Priya"\n9123456789,"He said ""hi""\nthere"\n\n'),
    [['phone', 'name'], ['98765 43210', 'Sharma, Priya'], ['9123456789', 'He said "hi"\nthere']]);
});

test('phone numbers: local 10-digit gets the country code; +, 00 and 0 prefixes handled', () => {
  assert.equal(normalisePhone('98765 43210', '91'), '919876543210');
  assert.equal(normalisePhone('+44 7700 900123', '91'), '447700900123');
  assert.equal(normalisePhone('0044 7700 900123', '91'), '447700900123');
  assert.equal(normalisePhone('09876543210', '91'), '919876543210');
  assert.equal(normalisePhone('12345', '91'), null);
});

test('CSV import creates, updates, tags, reports bad rows and respects the plan limit', async () => {
  const plan = await withPlatform(ctx.db, async (tx) => {
    const p = await tx.query("INSERT INTO plans (name, slug, price_paise, billing_cycle) VALUES ('Tiny', 'tiny-imp', 0, 'monthly') RETURNING id");
    await tx.query("INSERT INTO plan_limits VALUES ($1, 'contacts', 3)", [p.rows[0].id]);
    return p.rows[0].id;
  });
  await ctx.db.query('UPDATE tenants SET plan_id = $1 WHERE id = $2', [plan, owner.tenantId]);
  await api('POST', '/contacts', { phone: '919000000001', name: 'Old Name' });

  const csv = 'Phone,Name,Email,Tags\n9000000001,New Name,new@example.com,VIP;Chennai\n9000000002,Arun,,vip\nnot-a-number,Bad,,\n9000000003,Bala,,\n9000000004,Over Limit,,\n';
  const r = await api('POST', '/contacts/import', { fileName: 'diwali.csv', csv, optInSource: 'website form 2026' });
  assert.equal(r.statusCode, 202, r.body);
  await run(IMPORT_QUEUE, importHandler(deps()));

  const job = (await api('GET', '/contacts/import-jobs')).json().data[0];
  assert.deepEqual([job.status, job.total, job.created_count, job.updated_count, job.error_count], ['done', 5, 2, 1, 2]);
  assert.deepEqual(job.errors.map((e: { reason: string }) => e.reason).sort(), ['invalid phone number', 'plan contact limit reached']);
  const list = (await api('GET', '/contacts?search=9000000001')).json().data[0];
  assert.equal(list.name, 'New Name');
  assert.deepEqual(list.tags.map((t: { label: string }) => t.label).sort(), ['Chennai', 'VIP']);
  const tags = (await api('GET', '/tags')).json().data;
  assert.equal(tags.filter((t: { label: string }) => t.label.toLowerCase() === 'vip').length, 1, 'VIP and vip are one tag');
  await ctx.db.query('UPDATE tenants SET plan_id = NULL WHERE id = $1', [owner.tenantId]);
});

test('API keys: work on allowed paths, blocked elsewhere, stop working when revoked', async () => {
  const k = (await api('POST', '/settings/api-keys', { name: 'n8n' })).json();
  assert.match(k.key, /^wak_/);
  const useKey = (method: 'GET' | 'POST', url: string, payload?: object) => ctx.app.inject({ method, url, headers: { 'x-api-key': k.key }, ...(payload ? { payload } : {}) });
  assert.equal((await useKey('POST', '/contacts', { phone: '919011111111', name: 'From n8n' })).statusCode, 201);
  assert.equal((await useKey('GET', '/contacts')).statusCode, 200);
  assert.equal((await useKey('GET', '/team')).statusCode, 403, 'keys cannot reach team');
  assert.equal((await useKey('POST', '/settings/api-keys', { name: 'x' })).statusCode, 403, 'keys cannot mint keys');
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/contacts', headers: { 'x-api-key': 'wak_wrong' } })).statusCode, 401);
  const listed = (await api('GET', '/settings/api-keys')).json().data[0];
  assert.ok(!('key' in listed) && listed.prefix === k.key.slice(0, 10), 'only the prefix is ever listed');
  assert.equal((await api('DELETE', `/settings/api-keys/${k.id}`)).statusCode, 204);
  assert.equal((await useKey('GET', '/contacts')).statusCode, 401);
});

test('webhooks: events are signed, delivered, and retried on failure', async () => {
  await connectNumber(ctx.app, owner.token, '222000111', '222000999');
  const hook = (await api('POST', '/settings/webhooks', { url: 'https://hooks.example.com/wa', events: ['message.received', 'contact.created'] })).json();
  assert.match(hook.secret, /^whsec_/);
  assert.equal((await api('POST', '/settings/webhooks', { url: 'https://127.0.0.1/x', events: ['message.received'] })).statusCode, 400);

  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText('222000111', '919700000123', 'wamid.HOOK1', 'Need a quote')) });
  ctx.setMetaResponse({ ok: false, status: 500, body: {} });          // customer endpoint is down
  await run(WEBHOOK_QUEUE, webhookDeliverHandler(deps()));
  const retry = await ctx.db.query(`SELECT status, attempts FROM jobs WHERE queue = '${WEBHOOK_QUEUE}' ORDER BY id DESC LIMIT 1`);
  assert.deepEqual([retry.rows[0].status, retry.rows[0].attempts], ['queued', 1], 'failed delivery is queued again');

  ctx.setMetaResponse({ ok: true, status: 200, body: {} });
  await ctx.db.query(`UPDATE jobs SET run_at = now() WHERE queue = '${WEBHOOK_QUEUE}' AND status = 'queued'`);
  const before = ctx.sent.length;
  await run(WEBHOOK_QUEUE, webhookDeliverHandler(deps()));
  const call = ctx.sent.slice(before).find((s) => s.url === 'https://hooks.example.com/wa')!;
  assert.ok(call, 'delivered after retry');
  const raw = JSON.stringify(call.body);
  assert.equal(call.headers['x-wacrm-signature'], 'sha256=' + createHmac('sha256', hook.secret).update(raw).digest('hex'));
  assert.equal(call.headers['x-wacrm-event'], 'message.received');
  assert.equal((call.body as { data: { message: { body: string } } }).data.message.body, 'Need a quote');
  const status = (await api('GET', '/settings/webhooks')).json().data[0];
  assert.equal(status.last_status, 200);
});

test('another workspace never receives your events', async () => {
  const other = await signup(ctx.app, 'integr-other@example.com');
  await ctx.app.inject({ method: 'POST', url: '/settings/webhooks', headers: bearer(other.token),
    payload: { url: 'https://other.example.com/hook', events: ['contact.created'] } });
  await api('POST', '/contacts', { phone: '919022222222' });
  const q = await withTenant(ctx.db, other.tenantId, (tx) => tx.query('SELECT id FROM webhook_endpoints'));
  const jobs = await ctx.db.query(`SELECT payload->>'endpointId' AS ep FROM jobs WHERE queue = '${WEBHOOK_QUEUE}'`);
  assert.ok(!jobs.rows.some((j) => j.ep === q.rows[0].id));
});
