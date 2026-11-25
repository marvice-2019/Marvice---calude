import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, signToken } from '../src/auth.js';
import { withPlatform } from '../src/db.js';
import { setup, signup, bearer, type TestCtx } from './helpers.js';

let ctx: TestCtx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

test('login works with the right password and fails with the wrong one', async () => {
  await signup(ctx.app, 'owner@example.com');
  const ok = await ctx.app.inject({ method: 'POST', url: '/auth/login',
    payload: { email: 'OWNER@example.com', password: 'correct-horse-1' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().role, 'owner');

  const bad = await ctx.app.inject({ method: 'POST', url: '/auth/login',
    payload: { email: 'owner@example.com', password: 'wrong-password' } });
  const unknown = await ctx.app.inject({ method: 'POST', url: '/auth/login',
    payload: { email: 'nobody@example.com', password: 'wrong-password' } });
  assert.equal(bad.statusCode, 401);
  assert.deepEqual(bad.json(), unknown.json(), 'unknown email and wrong password must look the same');
});

test('signup rejects a taken email and a short password', async () => {
  await signup(ctx.app, 'taken@example.com');
  const dup = await ctx.app.inject({ method: 'POST', url: '/auth/signup',
    payload: { businessName: 'X Co', name: 'Xavier', email: 'taken@example.com', password: 'correct-horse-1' } });
  assert.equal(dup.statusCode, 409);
  const weak = await ctx.app.inject({ method: 'POST', url: '/auth/signup',
    payload: { businessName: 'Y Co', name: 'Y', email: 'y@example.com', password: 'short' } });
  assert.equal(weak.statusCode, 400);
});

test('protected routes need a valid token', async () => {
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/contacts' })).statusCode, 401);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/contacts', headers: bearer('not-a-jwt') })).statusCode, 401);
  const forged = await signToken({ userId: crypto.randomUUID(), tenantId: crypto.randomUUID(), role: 'owner' },
    'y'.repeat(40));
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/contacts', headers: bearer(forged) })).statusCode, 401);
});

test('an agent cannot connect a WhatsApp number', async () => {
  const owner = await signup(ctx.app, 'boss@example.com');
  await withPlatform(ctx.db, async (tx) => {
    const u = await tx.query("INSERT INTO users (email, name, password_hash) VALUES ('agent@example.com', 'Agent', $1) RETURNING id",
      [await hashPassword('agent-password-1')]);
    await tx.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'agent')", [owner.tenantId, u.rows[0].id]);
  });
  const login = await ctx.app.inject({ method: 'POST', url: '/auth/login',
    payload: { email: 'agent@example.com', password: 'agent-password-1' } });
  const r = await ctx.app.inject({ method: 'POST', url: '/waba/connect', headers: bearer(login.json().token), payload: {
    metaWabaId: '1234567890', accessToken: 'EAAG' + 'x'.repeat(40), phoneNumberId: '1098765432', displayPhone: '+91 1' } });
  assert.equal(r.statusCode, 403);
});

test('CORS: only configured web origins get access headers', async () => {
  const c2 = await setup({ WEB_ORIGINS: 'https://app.example.com' });
  try {
    const ok = await c2.app.inject({ method: 'OPTIONS', url: '/contacts',
      headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    assert.equal(ok.headers['access-control-allow-origin'], 'https://app.example.com');
    const bad = await c2.app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example.net' } });
    assert.equal(bad.headers['access-control-allow-origin'], undefined);
  } finally { await c2.close(); }
});
