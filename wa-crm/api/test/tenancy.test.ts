import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTenant } from '../src/db.js';
import { setup, signup, bearer, type TestCtx } from './helpers.js';

let ctx: TestCtx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

test('a tenant only sees its own contacts through the API', async () => {
  const a = await signup(ctx.app, 'a@example.com');
  const b = await signup(ctx.app, 'b@example.com');
  for (const [t, phone] of [[a, '919800000001'], [b, '919800000002']] as const) {
    const r = await ctx.app.inject({ method: 'POST', url: '/contacts', headers: bearer(t.token), payload: { phone } });
    assert.equal(r.statusCode, 201, r.body);
  }
  const listA = (await ctx.app.inject({ method: 'GET', url: '/contacts', headers: bearer(a.token) })).json();
  assert.deepEqual(listA.data.map((c: { phone: string }) => c.phone), ['919800000001']);
  assert.equal(listA.total, 1);
});

test('row-level security blocks reads and writes across tenants, even with raw SQL', async () => {
  const a = await signup(ctx.app, 'rls-a@example.com');
  const b = await signup(ctx.app, 'rls-b@example.com');
  await ctx.app.inject({ method: 'POST', url: '/contacts', headers: bearer(b.token), payload: { phone: '919811111111' } });

  // Tenant A's session asks for everything, with no WHERE clause.
  const seen = await withTenant(ctx.db, a.tenantId, (tx) => tx.query('SELECT phone_e164 FROM contacts'));
  assert.ok(!seen.rows.some((r) => r.phone_e164 === '919811111111'), 'A must not see B\'s contact');

  // Tenant A tries to write a row tagged with B's tenant id.
  await assert.rejects(
    withTenant(ctx.db, a.tenantId, (tx) =>
      tx.query("INSERT INTO contacts (tenant_id, phone_e164) VALUES ($1, '919822222222')", [b.tenantId])),
    /row-level security/);
});

test('with no tenant set, tenant tables return nothing', async () => {
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_tenant');
    const r = await client.query('SELECT count(*)::int AS n FROM contacts');
    assert.equal(r.rows[0].n, 0);
    await client.query('ROLLBACK');
  } finally { client.release(); }
});

test('duplicate phone in the same tenant returns 409, the same phone in another tenant is fine', async () => {
  const a = await signup(ctx.app, 'dup-a@example.com');
  const b = await signup(ctx.app, 'dup-b@example.com');
  const add = (token: string) => ctx.app.inject({ method: 'POST', url: '/contacts', headers: bearer(token),
    payload: { phone: '+91 98333 33333' } });
  assert.equal((await add(a.token)).statusCode, 201);
  assert.equal((await add(a.token)).statusCode, 409);
  assert.equal((await add(b.token)).statusCode, 201);
});
