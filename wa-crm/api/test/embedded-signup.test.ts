import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTenant } from '../src/db.js';
import { setup, signup, bearer, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
before(async () => {
  ctx = await setup({ META_APP_ID: '1234567890', META_ES_CONFIG_ID: '9876543210' });
  owner = await signup(ctx.app, 'es@example.com');
});
after(async () => { await ctx.close(); });

const meta = (failStep?: string) => (url: string) => {
  if (url.includes('/oauth/access_token')) return { ok: true, status: 200, body: { access_token: 'EAAB-business-token-xyz', token_type: 'bearer' } };
  if (url.includes('/subscribed_apps')) return { ok: true, status: 200, body: { success: true } };
  if (url.includes('/register')) return failStep === 'register'
    ? { ok: false, status: 400, body: { error: { message: 'Two-step verification PIN mismatch', code: 133005 } } }
    : { ok: true, status: 200, body: { success: true } };
  return { ok: true, status: 200, body: { display_phone_number: '+91 98765 00000', verified_name: 'Lakshmi Silks', quality_rating: 'GREEN' } };
};
const signupCall = (token: string, wabaId = '445566778899', phoneNumberId = '556677889900') => ctx.app.inject({
  method: 'POST', url: '/waba/embedded-signup', headers: bearer(token), payload: { code: 'AQD-one-time-code-123', wabaId, phoneNumberId } });

test('config tells the browser whether signup is available', async () => {
  const r = (await ctx.app.inject({ method: 'GET', url: '/waba/embedded-signup/config', headers: bearer(owner.token) })).json();
  assert.deepEqual([r.enabled, r.appId, r.configId], [true, '1234567890', '9876543210']);
});

test('signup exchanges the code, subscribes, registers and stores the number with an encrypted token', async () => {
  ctx.setMetaResponse(meta());
  const before = ctx.sent.length;
  const r = await signupCall(owner.token);
  assert.equal(r.statusCode, 201, r.body);
  assert.deepEqual(r.json(), { ok: true, displayPhone: '+91 98765 00000', verifiedName: 'Lakshmi Silks' });
  const calls = ctx.sent.slice(before);
  assert.match(calls[0]!.url, /oauth\/access_token\?client_id=1234567890&client_secret=.+&code=AQD-one-time-code-123/);
  assert.match(calls[1]!.url, /445566778899\/subscribed_apps$/);
  assert.equal(calls[1]!.headers.authorization, 'Bearer EAAB-business-token-xyz');
  assert.match(calls[2]!.url, /556677889900\/register$/);
  assert.match((calls[2]!.body as { pin: string }).pin, /^\d{6}$/);
  const row = await withTenant(ctx.db, owner.tenantId, (tx) => tx.query('SELECT access_token_enc FROM waba_accounts WHERE meta_waba_id = $1', ['445566778899']));
  assert.ok(!row.rows[0].access_token_enc.includes('EAAB'), 'token is stored encrypted');
  const numbers = (await ctx.app.inject({ method: 'GET', url: '/waba', headers: bearer(owner.token) })).json().data.flatMap((w: { numbers: unknown[] }) => w.numbers);
  assert.equal(numbers[0].verifiedName, 'Lakshmi Silks');
});

test('a WABA already connected to another workspace cannot be taken over', async () => {
  const other = await signup(ctx.app, 'es-other@example.com');
  ctx.setMetaResponse(meta());
  const r = await signupCall(other.token);
  assert.equal(r.statusCode, 409);
});

test('a failing Meta step reports which step failed and stores nothing', async () => {
  ctx.setMetaResponse(meta('register'));
  const r = await signupCall(owner.token, '111122223333', '444455556666');
  assert.equal(r.statusCode, 502);
  assert.equal(r.json().step, 'register_number');
  const n = await withTenant(ctx.db, owner.tenantId, (tx) => tx.query("SELECT 1 FROM waba_accounts WHERE meta_waba_id = '111122223333'"));
  assert.equal(n.rowCount, 0);
});

test('API keys cannot connect numbers', async () => {
  const k = (await ctx.app.inject({ method: 'POST', url: '/settings/api-keys', headers: bearer(owner.token), payload: { name: 'n8n' } })).json().key;
  for (const url of ['/waba/connect', '/waba/embedded-signup']) {
    const r = await ctx.app.inject({ method: 'POST', url, headers: { 'x-api-key': k }, payload: {} });
    assert.equal(r.statusCode, 403, url);
  }
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/waba', headers: { 'x-api-key': k } })).statusCode, 200);
});
