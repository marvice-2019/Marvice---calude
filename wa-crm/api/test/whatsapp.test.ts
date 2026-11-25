import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTenant } from '../src/db.js';
import {
  setup, signup, bearer, signedWebhook, inboundText, statusUpdate, connectNumber, VERIFY_TOKEN, type TestCtx,
} from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
const PNID = '555000111';

before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'wa@example.com');
  await connectNumber(ctx.app, owner.token, PNID, '777000111');
});
after(async () => { await ctx.close(); });

const post = (body: unknown) => ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(body) });

test('webhook verification echoes the challenge only with the right token', async () => {
  const ok = await ctx.app.inject({ method: 'GET',
    url: `/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=42` });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body, '42');
  const bad = await ctx.app.inject({ method: 'GET', url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42' });
  assert.equal(bad.statusCode, 403);
});

test('a webhook with a bad signature is rejected and stores nothing', async () => {
  const r = await ctx.app.inject({ method: 'POST', url: '/webhooks/meta',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
    payload: JSON.stringify(inboundText(PNID, '919700000009', 'wamid.FORGED', 'hi')) });
  assert.equal(r.statusCode, 401);
  const n = await withTenant(ctx.db, owner.tenantId, (tx) =>
    tx.query("SELECT count(*)::int AS n FROM messages WHERE wa_message_id = 'wamid.FORGED'"));
  assert.equal(n.rows[0].n, 0);
});

test('an inbound message creates contact, conversation and message; a retry is stored once', async () => {
  const body = inboundText(PNID, '919700000001', 'wamid.IN1', 'Hello, is this in stock?');
  assert.equal((await post(body)).statusCode, 200);
  assert.equal((await post(body)).statusCode, 200);   // Meta retries the same delivery

  const convs = (await ctx.app.inject({ method: 'GET', url: '/conversations', headers: bearer(owner.token) })).json();
  const conv = convs.data.find((c: { contact_phone: string }) => c.contact_phone === '919700000001');
  assert.ok(conv, 'conversation exists');
  assert.equal(conv.contact_name, 'Priya');
  assert.equal(conv.unread_count, 1, 'retry must not double-count');

  const msgs = (await ctx.app.inject({ method: 'GET', url: `/conversations/${conv.id}/messages`,
    headers: bearer(owner.token) })).json();
  assert.equal(msgs.data.length, 1);
  assert.equal(msgs.data[0].body, 'Hello, is this in stock?');
});

test('a message to an unknown phone number is acknowledged and ignored', async () => {
  const r = await post(inboundText('999999999', '919700000002', 'wamid.LOST', 'hi'));
  assert.equal(r.statusCode, 200);
});

test('a reply inside the 24-hour window is sent to Meta and saved; statuses only move forward', async () => {
  await post(inboundText(PNID, '919700000003', 'wamid.IN3', 'Need help'));
  const convs = (await ctx.app.inject({ method: 'GET', url: '/conversations', headers: bearer(owner.token) })).json();
  const conv = convs.data.find((c: { contact_phone: string }) => c.contact_phone === '919700000003');

  ctx.setMetaResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.OUT3' }] } });
  const r = await ctx.app.inject({ method: 'POST', url: `/conversations/${conv.id}/messages`,
    headers: bearer(owner.token), payload: { text: 'Sure, how can we help?' } });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().status, 'sent');
  const last = ctx.sent.at(-1)!;
  assert.match(last.url, new RegExp(`/${PNID}/messages$`));
  assert.deepEqual((last.body as { to: string; text: unknown }).to, '919700000003');

  await post(statusUpdate(PNID, 'wamid.OUT3', 'read'));
  await post(statusUpdate(PNID, 'wamid.OUT3', 'delivered'));   // arrives late
  const st = await withTenant(ctx.db, owner.tenantId, (tx) =>
    tx.query("SELECT status FROM messages WHERE wa_message_id = 'wamid.OUT3'"));
  assert.equal(st.rows[0].status, 'read');
});

test('a reply outside the 24-hour window is refused before calling Meta', async () => {
  await post(inboundText(PNID, '919700000004', 'wamid.IN4', 'old'));
  const convs = (await ctx.app.inject({ method: 'GET', url: '/conversations', headers: bearer(owner.token) })).json();
  const conv = convs.data.find((c: { contact_phone: string }) => c.contact_phone === '919700000004');
  await withTenant(ctx.db, owner.tenantId, (tx) =>
    tx.query("UPDATE conversations SET last_inbound_at = now() - interval '25 hours' WHERE id = $1", [conv.id]));
  const before = ctx.sent.length;
  const r = await ctx.app.inject({ method: 'POST', url: `/conversations/${conv.id}/messages`,
    headers: bearer(owner.token), payload: { text: 'hello again' } });
  assert.equal(r.statusCode, 422);
  assert.equal(ctx.sent.length, before);
});

test('a Meta error is saved as a failed message and returns 502', async () => {
  await post(inboundText(PNID, '919700000005', 'wamid.IN5', 'hi'));
  const convs = (await ctx.app.inject({ method: 'GET', url: '/conversations', headers: bearer(owner.token) })).json();
  const conv = convs.data.find((c: { contact_phone: string }) => c.contact_phone === '919700000005');
  ctx.setMetaResponse({ ok: false, status: 400, body: { error: { code: 131047, message: 'Re-engagement message' } } });
  const r = await ctx.app.inject({ method: 'POST', url: `/conversations/${conv.id}/messages`,
    headers: bearer(owner.token), payload: { text: 'hello' } });
  assert.equal(r.statusCode, 502);
  assert.equal(r.json().status, 'failed');
  assert.equal(r.json().error_code, '131047');
});

test('the stored WhatsApp access token is encrypted, never plain text', async () => {
  const r = await withTenant(ctx.db, owner.tenantId, (tx) => tx.query('SELECT access_token_enc FROM waba_accounts'));
  assert.ok(!r.rows[0].access_token_enc.startsWith('EAAG'));
});
