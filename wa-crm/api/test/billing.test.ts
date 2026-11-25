import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { computeGst, financialYear, splitInclusive } from '../src/gst.js';
import { billingGraceCheck } from '../src/routes/billing.js';
import { withPlatform } from '../src/db.js';
import { setup, signup, bearer, type TestCtx } from './helpers.js';

const WH_SECRET = 'rzp-webhook-secret';
let ctx: TestCtx;
before(async () => {
  ctx = await setup({ RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'rzp_test_secret', RAZORPAY_WEBHOOK_SECRET: WH_SECRET });
});
after(async () => { await ctx.close(); });

// ---------- GST ----------

test('GST: same state splits into CGST + SGST, other state is IGST, parts always sum', () => {
  const intra = computeGst(99_900, '29', '29');
  assert.deepEqual([intra.cgstPaise, intra.sgstPaise, intra.igstPaise, intra.totalPaise], [8991, 8991, 0, 117_882]);
  const inter = computeGst(99_900, '29', '27');
  assert.deepEqual([inter.cgstPaise, inter.sgstPaise, inter.igstPaise, inter.totalPaise], [0, 0, 17_982, 117_882]);
  for (const total of [1, 99, 118, 117_883, 9_999_999]) {
    const s = splitInclusive(total, '29', '29');
    assert.equal(s.taxablePaise + s.cgstPaise + s.sgstPaise + s.igstPaise, total, `sum for ${total}`);
    assert.ok(Math.abs(s.cgstPaise - s.sgstPaise) <= 1);
  }
  assert.throws(() => computeGst(10.5, '29', '29'));
});

test('financial year runs April to March', () => {
  assert.equal(financialYear(new Date('2027-03-31T12:00:00Z')), '2026-27');
  assert.equal(financialYear(new Date('2027-04-01T00:00:00Z')), '2027-28');
  assert.equal(financialYear(new Date('2099-12-01T00:00:00Z')), '2099-00');
});

// ---------- helpers ----------

async function makePlan(limits: Record<string, number> = {}) {
  return withPlatform(ctx.db, async (tx) => {
    const p = await tx.query<{ id: string }>(
      `INSERT INTO plans (name, slug, price_paise, billing_cycle, razorpay_plan_id)
       VALUES ('Growth', 'growth-' || gen_random_uuid(), 99900, 'monthly', 'plan_' || gen_random_uuid()) RETURNING id`);
    for (const [resource, max] of Object.entries(limits)) {
      await tx.query('INSERT INTO plan_limits (plan_id, resource, max_value) VALUES ($1, $2, $3)', [p.rows[0]!.id, resource, max]);
    }
    return p.rows[0]!.id;
  });
}

function rzp(event: string, subId: string, extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event, payload: {
    subscription: { entity: { id: subId, status: extra.status ?? 'active', current_start: extra.start ?? now,
      current_end: extra.end ?? now + 30 * 86400 } },
    ...(extra.paymentId ? { payment: { entity: { id: extra.paymentId, amount: extra.amount ?? 117_882,
      created_at: extra.paidAt ?? now } } } : {}),
  } });
  const sig = createHmac('sha256', WH_SECRET).update(body).digest('hex');
  return ctx.app.inject({ method: 'POST', url: '/webhooks/razorpay', payload: body,
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig } });
}

async function subscribe(token: string, planId: string, rzpId: string) {
  ctx.setMetaResponse({ ok: true, status: 200, body: { id: rzpId, short_url: 'https://rzp.io/i/x', status: 'created' } });
  const r = await ctx.app.inject({ method: 'POST', url: '/billing/subscribe', headers: bearer(token), payload: { planId } });
  assert.equal(r.statusCode, 201, r.body);
}

// ---------- limits ----------

test('the contact limit returns 402 once the plan is full', async () => {
  const t = await signup(ctx.app, 'limit@example.com');
  const plan = await makePlan({ contacts: 2 });
  await ctx.db.query('UPDATE tenants SET plan_id = $1 WHERE id = $2', [plan, t.tenantId]);
  const add = (phone: string) => ctx.app.inject({ method: 'POST', url: '/contacts', headers: bearer(t.token), payload: { phone } });
  assert.equal((await add('919000000001')).statusCode, 201);
  assert.equal((await add('919000000002')).statusCode, 201);
  const third = await add('919000000003');
  assert.equal(third.statusCode, 402);
  assert.deepEqual(third.json(), { error: 'plan_limit', resource: 'contacts', limit: 2, used: 2 });
});

// ---------- Razorpay ----------

test('subscribe calls Razorpay with Basic auth and the plan id', async () => {
  const t = await signup(ctx.app, 'sub@example.com');
  const plan = await makePlan();
  await subscribe(t.token, plan, 'sub_A1');
  const call = ctx.sent.at(-1)!;
  assert.equal(call.url, 'https://api.razorpay.com/v1/subscriptions');
  assert.equal(call.headers.authorization, 'Basic ' + Buffer.from('rzp_test_key:rzp_test_secret').toString('base64'));
  assert.match((call.body as { plan_id: string }).plan_id, /^plan_/);
});

test('a webhook with a bad signature is rejected', async () => {
  const r = await ctx.app.inject({ method: 'POST', url: '/webhooks/razorpay', payload: '{"event":"subscription.charged"}',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'a'.repeat(64) } });
  assert.equal(r.statusCode, 401);
});

test('subscription.charged issues one gap-free invoice; a replay does not duplicate it', async () => {
  const t = await signup(ctx.app, 'charged@example.com');
  await ctx.db.query("UPDATE tenants SET state_code = '27', gstin = '27ABCDE1234F1Z5' WHERE id = $1", [t.tenantId]);
  await subscribe(t.token, await makePlan(), 'sub_C1');
  const paidAt = Math.floor(new Date('2026-05-10T10:00:00Z').getTime() / 1000);
  assert.equal((await rzp('subscription.charged', 'sub_C1', { paymentId: 'pay_1', paidAt })).statusCode, 200);
  assert.equal((await rzp('subscription.charged', 'sub_C1', { paymentId: 'pay_1', paidAt })).statusCode, 200);
  assert.equal((await rzp('subscription.charged', 'sub_C1', { paymentId: 'pay_2', paidAt })).statusCode, 200);

  const inv = (await ctx.app.inject({ method: 'GET', url: '/billing/invoices', headers: bearer(t.token) })).json().data;
  assert.equal(inv.length, 2, 'pay_1 replay must not create a second invoice');
  const nums = inv.map((i: { number: string }) => i.number).sort();
  assert.deepEqual(nums, ['MM/2026-27/0001', 'MM/2026-27/0002']);
  const one = inv[0];
  assert.equal(one.igst_paise + one.taxable_paise, 117_882, 'inter-state (27 vs 29) is IGST');
  assert.equal(one.customer_gstin, '27ABCDE1234F1Z5');
});

test('invoice numbers restart in a new financial year', async () => {
  const t = await signup(ctx.app, 'fy@example.com');
  await subscribe(t.token, await makePlan(), 'sub_FY');
  await rzp('subscription.charged', 'sub_FY', { paymentId: 'pay_fy_mar', paidAt: Date.parse('2027-03-31T10:00:00Z') / 1000 });
  await rzp('subscription.charged', 'sub_FY', { paymentId: 'pay_fy_apr', paidAt: Date.parse('2027-04-02T10:00:00Z') / 1000 });
  const inv = (await ctx.app.inject({ method: 'GET', url: '/billing/invoices', headers: bearer(t.token) })).json().data;
  const nums = inv.map((i: { number: string }) => i.number);
  assert.ok(nums.some((n: string) => n.startsWith('MM/2026-27/')));
  assert.ok(nums.includes('MM/2027-28/0001'));
});

test('a halted subscription past the grace period suspends the tenant; billing stays reachable', async () => {
  const t = await signup(ctx.app, 'halt@example.com');
  await subscribe(t.token, await makePlan(), 'sub_H1');
  const longAgo = Math.floor(Date.now() / 1000) - 40 * 86400;
  await rzp('subscription.halted', 'sub_H1', { status: 'halted', start: longAgo - 30 * 86400, end: longAgo });
  await billingGraceCheck(ctx.db, 7)({ id: '0', queue: 'billing.grace-check', tenant_id: null, payload: {}, attempts: 1, max_attempts: 5 });

  assert.equal((await ctx.app.inject({ method: 'GET', url: '/contacts', headers: bearer(t.token) })).statusCode, 402);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/billing/subscription', headers: bearer(t.token) })).statusCode, 200);

  // Paying again reactivates.
  await rzp('subscription.charged', 'sub_H1', { paymentId: 'pay_h1' });
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/contacts', headers: bearer(t.token) })).statusCode, 200);
});

test('a tenant cannot see another tenant\'s invoices', async () => {
  const other = await signup(ctx.app, 'other-inv@example.com');
  const r = (await ctx.app.inject({ method: 'GET', url: '/billing/invoices', headers: bearer(other.token) })).json();
  assert.equal(r.data.length, 0);
});
