import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTenant } from '../src/db.js';
import { setup, signup, bearer, signedWebhook, inboundText, connectNumber, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
let wabaAccountId: string;
const PNID = '666000111', WABA = '888000111';

before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'tpl@example.com');
  await connectNumber(ctx.app, owner.token, PNID, WABA);
  wabaAccountId = (await withTenant(ctx.db, owner.tenantId, (tx) => tx.query('SELECT id FROM waba_accounts'))).rows[0].id;
});
after(async () => { await ctx.close(); });

const orderBody = (text = 'Hi {{1}}, your order {{2}} has shipped.') =>
  ({ wabaAccountId, name: 'order_shipped', language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text }] });

async function createApproved(name: string, text: string) {
  ctx.setMetaResponse({ ok: true, status: 200, body: { id: `tpl_${name}`, status: 'APPROVED', category: 'UTILITY' } });
  const r = await ctx.app.inject({ method: 'POST', url: '/templates', headers: bearer(owner.token),
    payload: { ...orderBody(text), name } });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id as string;
}

async function conversationFor(phone: string, wamid: string) {
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText(PNID, phone, wamid, 'hi')) });
  const convs = (await ctx.app.inject({ method: 'GET', url: '/conversations', headers: bearer(owner.token) })).json();
  return convs.data.find((c: { contact_phone: string }) => c.contact_phone === phone).id as string;
}

test('creating a template submits it to Meta and stores it as PENDING', async () => {
  ctx.setMetaResponse({ ok: true, status: 200, body: { id: '123456', status: 'PENDING', category: 'UTILITY' } });
  const r = await ctx.app.inject({ method: 'POST', url: '/templates', headers: bearer(owner.token), payload: orderBody() });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().status, 'PENDING');
  const call = ctx.sent.at(-1)!;
  assert.match(call.url, new RegExp(`/${WABA}/message_templates$`));
  assert.deepEqual(call.body, { name: 'order_shipped', language: 'en', category: 'UTILITY',
    components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} has shipped.' }] });
});

test('badly numbered variables are rejected before calling Meta', async () => {
  const before = ctx.sent.length;
  const r = await ctx.app.inject({ method: 'POST', url: '/templates', headers: bearer(owner.token),
    payload: { ...orderBody('Hi {{1}}, order {{3}}'), name: 'gappy' } });
  assert.equal(r.statusCode, 400);
  assert.equal(ctx.sent.length, before);
});

test('sync pulls every page from Meta and updates statuses', async () => {
  ctx.setMetaResponse((url) => url.includes('after=p2')
    ? { ok: true, status: 200, body: { data: [{ id: '2', name: 'welcome', language: 'ta', status: 'APPROVED', category: 'MARKETING',
        components: [{ type: 'BODY', text: 'வணக்கம்' }] }], paging: {} } }
    : { ok: true, status: 200, body: { data: [
        { id: '123456', name: 'order_shipped', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [] },
        { id: '9', name: 'weird', language: 'en', status: 'IN_APPEAL', category: 'UTILITY', components: [] }],
        paging: { next: `https://graph.facebook.com/v21.0/${WABA}/message_templates?after=p2` } } });
  const r = await ctx.app.inject({ method: 'POST', url: '/templates/sync', headers: bearer(owner.token) });
  assert.deepEqual(r.json(), { upserted: 2, skipped: 1 });
  const list = (await ctx.app.inject({ method: 'GET', url: '/templates?status=APPROVED', headers: bearer(owner.token) })).json().data;
  assert.deepEqual(list.map((t: { name: string }) => t.name).sort(), ['order_shipped', 'welcome']);
});

test('an approved template can be sent outside the 24-hour window, with parameters filled in', async () => {
  const tplId = await createApproved('delivery_update', 'Hi {{1}}, order {{2}} is out for delivery.');
  const convId = await conversationFor('919600000001', 'wamid.T1');
  await withTenant(ctx.db, owner.tenantId, (tx) =>
    tx.query("UPDATE conversations SET last_inbound_at = now() - interval '3 days' WHERE id = $1", [convId]));

  ctx.setMetaResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.TPL1' }] } });
  const r = await ctx.app.inject({ method: 'POST', url: `/conversations/${convId}/template-messages`,
    headers: bearer(owner.token), payload: { templateId: tplId, parameters: ['Priya', 'MM-1042'] } });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().body, 'Hi Priya, order MM-1042 is out for delivery.');
  assert.deepEqual((ctx.sent.at(-1)!.body as { template: unknown }).template, { name: 'delivery_update', language: { code: 'en' },
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'Priya' }, { type: 'text', text: 'MM-1042' }] }] });
});

test('unapproved templates and wrong parameter counts are refused', async () => {
  ctx.setMetaResponse({ ok: true, status: 200, body: { id: 'tpl_pending', status: 'PENDING' } });
  const pending = (await ctx.app.inject({ method: 'POST', url: '/templates', headers: bearer(owner.token),
    payload: { ...orderBody('Hello {{1}}'), name: 'still_pending' } })).json().id;
  const approved = await createApproved('one_var', 'Hello {{1}}');
  const convId = await conversationFor('919600000002', 'wamid.T2');
  const send = (templateId: string, parameters: string[]) => ctx.app.inject({ method: 'POST',
    url: `/conversations/${convId}/template-messages`, headers: bearer(owner.token), payload: { templateId, parameters } });
  assert.equal((await send(pending, ['a'])).statusCode, 422);
  assert.equal((await send(approved, [])).statusCode, 400);
});

test('a webhook review result moves a template to APPROVED or REJECTED with the reason', async () => {
  ctx.setMetaResponse({ ok: true, status: 200, body: { id: '5550001', status: 'PENDING' } });
  await ctx.app.inject({ method: 'POST', url: '/templates', headers: bearer(owner.token), payload: { ...orderBody('Promo {{1}}'), name: 'promo_one' } });
  const review = (event: string, reason?: string) => ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook({
    object: 'whatsapp_business_account', entry: [{ id: WABA, changes: [{ field: 'message_template_status_update',
      value: { event, message_template_id: 5550001, message_template_name: 'promo_one', message_template_language: 'en', reason } }] }] }) });
  const status = async () => (await withTenant(ctx.db, owner.tenantId, (tx) =>
    tx.query("SELECT status, rejected_reason FROM message_templates WHERE name = 'promo_one'"))).rows[0];

  await review('REJECTED', 'INVALID_FORMAT');
  assert.deepEqual(await status(), { status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' });
  await review('APPROVED');
  assert.deepEqual(await status(), { status: 'APPROVED', rejected_reason: null });
});

test('another tenant cannot use your template', async () => {
  const tplId = await createApproved('private_tpl', 'Hi there');
  const other = await signup(ctx.app, 'tpl-other@example.com');
  await connectNumber(ctx.app, other.token, '666000222', '888000222');
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText('666000222', '919600000009', 'wamid.TX', 'hi')) });
  const conv = (await ctx.app.inject({ method: 'GET', url: '/conversations', headers: bearer(other.token) })).json().data[0];
  const r = await ctx.app.inject({ method: 'POST', url: `/conversations/${conv.id}/template-messages`,
    headers: bearer(other.token), payload: { templateId: tplId, parameters: [] } });
  assert.equal(r.statusCode, 404);
});
