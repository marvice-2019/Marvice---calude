import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTenant } from '../src/db.js';
import { setup, signup, bearer, signedWebhook, inboundText, connectNumber, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
const PNID = '666000111';
let n = 0;

before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'shop@example.com');
  await connectNumber(ctx.app, owner.token, PNID, '666000999');
  ctx.setMetaResponse(() => ({ ok: true, status: 200, body: { messages: [{ id: `wamid.SHOP${++n}` }] } }));
});
after(async () => { await ctx.close(); });

const api = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(owner.token), ...(payload ? { payload } : {}) });

function cartWebhook(phone: string, wamid: string) {
  const body = inboundText(PNID, phone, wamid, '');
  const m = body.entry[0]!.changes[0]!.value.messages[0]! as Record<string, unknown>;
  m.type = 'order'; delete m.text;
  m.order = { catalog_id: 'CAT1', text: 'Please deliver after 6 pm', product_items: [
    { product_retailer_id: 'SAREE-RED', quantity: 2, item_price: 1499.5, currency: 'INR' },
    { product_retailer_id: 'UNKNOWN-SKU', quantity: '1', item_price: 250, currency: 'INR' }] };
  return signedWebhook(body);
}
const orders = () => withTenant(ctx.db, owner.tenantId, async (tx) => (await tx.query<{ number: number; items: { name: string; unitPaise: number; totalPaise: number; productId: string | null }[];
  subtotal_paise: string; source: string; note: string | null }>('SELECT number, items, subtotal_paise, source, note FROM orders ORDER BY number')).rows);

test('products: create, duplicate SKU refused, list', async () => {
  const r = await api('POST', '/products', { retailerId: 'SAREE-RED', name: 'Red Kanchipuram saree', pricePaise: 149950 });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal((await api('POST', '/products', { retailerId: 'SAREE-RED', name: 'dup', pricePaise: 1 })).statusCode, 409);
  assert.equal((await api('POST', '/products', { retailerId: 'OLD', name: 'Discontinued', pricePaise: 100, isActive: false })).statusCode, 201);
  assert.equal((await api('GET', '/products')).json().data.length, 2);
});

test('a WhatsApp cart becomes order #1001 once, even if Meta delivers the webhook twice', async () => {
  for (let i = 0; i < 2; i++) {
    const w = cartWebhook('919600000001', 'wamid.CART1');
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...w })).statusCode, 200);
  }
  const o = await orders();
  assert.equal(o.length, 1);
  assert.equal(o[0]!.number, 1001);
  assert.equal(o[0]!.source, 'whatsapp');
  assert.equal(o[0]!.note, 'Please deliver after 6 pm');
  assert.deepEqual(o[0]!.items.map((i) => [i.name, i.unitPaise, i.totalPaise, !!i.productId]),
    [['Red Kanchipuram saree', 149950, 299900, true], ['UNKNOWN-SKU', 25000, 25000, false]]);
  assert.equal(Number(o[0]!.subtotal_paise), 324900);
  const inbox = (await api('GET', '/orders?search=919600000001')).json().data;
  assert.equal(inbox.length, 1);
});

test('manual order uses catalog prices; inactive products are refused; numbers keep counting', async () => {
  const products = (await api('GET', '/products')).json().data as { id: string; retailer_id: string }[];
  const red = products.find((p) => p.retailer_id === 'SAREE-RED')!.id, old = products.find((p) => p.retailer_id === 'OLD')!.id;
  const contactId = (await api('POST', '/contacts', { phone: '919600000002', name: 'Kavya' })).json().id;
  assert.equal((await api('POST', '/orders', { contactId, items: [{ productId: old, quantity: 1 }] })).statusCode, 409);
  const r = await api('POST', '/orders', { contactId, items: [{ productId: red, quantity: 3 }] });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().number, 1002);
  assert.equal(Number(r.json().subtotal_paise), 449850);
  const s = (await api('GET', '/orders/summary')).json();
  assert.equal(s.new_orders, 2);
  assert.equal(Number(s.value_30d_paise), 324900 + 449850);
});

test('status change tells the customer once inside the 24-hour window; outside it, nothing is sent', async () => {
  const [cart] = (await api('GET', '/orders?search=1001')).json().data as { id: string }[];
  const before = ctx.sent.length;
  const r = await api('PATCH', `/orders/${cart!.id}`, { status: 'shipped', notify: true });
  assert.deepEqual(r.json().notified, { sent: true });
  const sent = ctx.sent.slice(before).map((s) => s.body as { to: string; text: { body: string } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, '919600000001');
  assert.equal(sent[0]!.text.body, 'Good news: order #1001 has been shipped.');
  await api('PATCH', `/orders/${cart!.id}`, { status: 'shipped', notify: true });   // same status again
  assert.equal(ctx.sent.length, before + 1, 'no second message for an unchanged status');

  // Kavya never messaged us, so there is no open window to text in.
  const [manual] = (await api('GET', '/orders?search=1002')).json().data as { id: string }[];
  const r2 = await api('PATCH', `/orders/${manual!.id}`, { status: 'confirmed', notify: true });
  assert.equal(r2.json().status, 'confirmed');
  assert.equal(r2.json().notified.sent, false);
  assert.equal(ctx.sent.length, before + 1);
});
