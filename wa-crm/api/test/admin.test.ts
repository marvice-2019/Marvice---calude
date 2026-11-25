import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, decodeJwt } from 'jose';
import { verifyToken } from '../src/auth.js';
import { withPlatform } from '../src/db.js';
import { createAdmin } from '../scripts/create-admin.js';
import { setup, signup, bearer, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let adminToken: string;
let adminId: string;
before(async () => {
  ctx = await setup();
  const a = await createAdmin(ctx.db, 'root@platform.test', 'Root');
  adminId = a.userId;
  const r = await ctx.app.inject({ method: 'POST', url: '/admin/auth/login',
    payload: { email: 'root@platform.test', password: a.password } });
  assert.equal(r.statusCode, 200, r.body);
  adminToken = r.json().token;
});
after(async () => { await ctx.close(); });

const admin = () => bearer(adminToken);

test('create-admin promotes an existing user without changing their password', async () => {
  await signup(ctx.app, 'promote-me@example.com');
  const out = await createAdmin(ctx.db, 'promote-me@example.com', 'Ignored');
  assert.equal(out.created, false);
  assert.equal(out.password, null);
  const r = await ctx.app.inject({ method: 'POST', url: '/admin/auth/login',
    payload: { email: 'promote-me@example.com', password: 'correct-horse-1' } });
  assert.equal(r.statusCode, 200);
});

test('a non-admin cannot log in to the admin API', async () => {
  await signup(ctx.app, 'plain@example.com');
  const r = await ctx.app.inject({ method: 'POST', url: '/admin/auth/login',
    payload: { email: 'plain@example.com', password: 'correct-horse-1' } });
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.json(), { error: 'invalid_credentials' });
});

test('a tenant token never opens /admin, even for a user who is a platform admin', async () => {
  const t = await signup(ctx.app, 'both@example.com');
  await createAdmin(ctx.db, 'both@example.com', 'Both');
  const r = await ctx.app.inject({ method: 'GET', url: '/admin/plans', headers: bearer(t.token) });
  assert.equal(r.statusCode, 401);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/admin/plans' })).statusCode, 401);
});

test('a platform-admin token never opens tenant routes', async () => {
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/contacts', headers: admin() })).statusCode, 401);
  // Even a hand-made token carrying tenant claims is refused once it has a scope.
  const t = await signup(ctx.app, 'scoped@example.com');
  const mixed = await new SignJWT({ scope: 'platform', tid: t.tenantId, role: 'owner' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(adminId).setIssuer('wa-crm').setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode('x'.repeat(40)));
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/contacts', headers: bearer(mixed) })).statusCode, 401);
});

test('a demoted admin loses access at once', async () => {
  const a = await createAdmin(ctx.db, 'temp-admin@platform.test', 'Temp');
  const login = await ctx.app.inject({ method: 'POST', url: '/admin/auth/login',
    payload: { email: 'temp-admin@platform.test', password: a.password } });
  await withPlatform(ctx.db, (tx) => tx.query('UPDATE users SET is_platform_admin = false WHERE id = $1', [a.userId]));
  const r = await ctx.app.inject({ method: 'GET', url: '/admin/plans', headers: bearer(login.json().token) });
  assert.equal(r.statusCode, 403);
});

test('plans: create with limits, update replaces the limit set', async () => {
  const c = await ctx.app.inject({ method: 'POST', url: '/admin/plans', headers: admin(), payload: {
    name: 'Starter', slug: 'starter', pricePaise: 99900, billingCycle: 'monthly',
    limits: { contacts: 1000, agents: 2 } } });
  assert.equal(c.statusCode, 201, c.body);
  const plan = c.json();
  assert.deepEqual(plan.limits, { contacts: 1000, agents: 2 });

  const u = await ctx.app.inject({ method: 'PATCH', url: `/admin/plans/${plan.id}`, headers: admin(),
    payload: { pricePaise: 149900, limits: { contacts: 5000, campaigns_per_month: 10 } } });
  assert.equal(u.statusCode, 200, u.body);
  assert.equal(u.json().price_paise, 149900);
  assert.equal(u.json().name, 'Starter');
  assert.deepEqual(u.json().limits, { contacts: 5000, campaigns_per_month: 10 });

  const dup = await ctx.app.inject({ method: 'POST', url: '/admin/plans', headers: admin(), payload: {
    name: 'Again', slug: 'starter', pricePaise: 1, billingCycle: 'yearly' } });
  assert.equal(dup.statusCode, 409);

  const list = (await ctx.app.inject({ method: 'GET', url: '/admin/plans', headers: admin() })).json();
  assert.ok(list.data.some((p: { id: string }) => p.id === plan.id));
});

test('a plan in use cannot be deactivated; an unused one can', async () => {
  const mk = async (slug: string) => (await ctx.app.inject({ method: 'POST', url: '/admin/plans', headers: admin(),
    payload: { name: slug, slug, pricePaise: 0, billingCycle: 'monthly' } })).json().id as string;
  const used = await mk('used-plan'), unused = await mk('unused-plan');
  const t = await signup(ctx.app, 'on-plan@example.com');
  const set = await ctx.app.inject({ method: 'PATCH', url: `/admin/tenants/${t.tenantId}`, headers: admin(),
    payload: { planId: used } });
  assert.equal(set.statusCode, 200, set.body);

  assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/admin/plans/${used}`, headers: admin() })).statusCode, 409);
  assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/admin/plans/${unused}`, headers: admin() })).statusCode, 204);
  const list = (await ctx.app.inject({ method: 'GET', url: '/admin/plans', headers: admin() })).json();
  assert.equal(list.data.find((p: { id: string }) => p.id === unused).is_active, false);
  // A deactivated plan cannot be given to a tenant.
  const r = await ctx.app.inject({ method: 'PATCH', url: `/admin/tenants/${t.tenantId}`, headers: admin(),
    payload: { planId: unused } });
  assert.equal(r.statusCode, 400);
});

test('tenant list shows owner email, plan name, contact and member counts', async () => {
  const t = await signup(ctx.app, 'counted@example.com');
  for (const phone of ['919700000001', '919700000002']) {
    await ctx.app.inject({ method: 'POST', url: '/contacts', headers: bearer(t.token), payload: { phone } });
  }
  const r = await ctx.app.inject({ method: 'GET', url: '/admin/tenants?search=counted', headers: admin() });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.total, 1);
  const row = body.data[0];
  assert.equal(row.id, t.tenantId);
  assert.equal(row.owner_email, 'counted@example.com');
  assert.equal(row.contact_count, 2);
  assert.equal(row.member_count, 1);
  assert.equal(row.plan_name, null);
});

test('suspending a tenant writes an audit log and filters the list', async () => {
  const t = await signup(ctx.app, 'naughty@example.com');
  const r = await ctx.app.inject({ method: 'PATCH', url: `/admin/tenants/${t.tenantId}`, headers: admin(),
    payload: { status: 'suspended' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, 'suspended');

  const logs = (await ctx.app.inject({ method: 'GET', headers: admin(),
    url: `/admin/audit-logs?tenantId=${t.tenantId}&action=admin.tenant.suspend` })).json();
  assert.equal(logs.total, 1);
  assert.equal(logs.data[0].user_id, adminId);

  const suspended = (await ctx.app.inject({ method: 'GET', url: '/admin/tenants?status=suspended', headers: admin() })).json();
  assert.deepEqual(suspended.data.map((x: { id: string }) => x.id), [t.tenantId]);

  const stats = (await ctx.app.inject({ method: 'GET', url: '/admin/stats', headers: admin() })).json();
  assert.equal(stats.tenants_by_status.suspended, 1);
  assert.ok(stats.tenants_by_status.active >= 1);
  assert.ok(stats.new_tenants_last_30d >= 2);
  assert.ok(stats.total_contacts >= 0);
  assert.deepEqual(Object.keys(stats.messages_last_30d).sort(), ['inbound', 'outbound']);
});

test('impersonation: 15-minute owner token for that tenant only, audited', async () => {
  const a = await signup(ctx.app, 'imp-a@example.com');
  const b = await signup(ctx.app, 'imp-b@example.com');
  await ctx.app.inject({ method: 'POST', url: '/contacts', headers: bearer(a.token), payload: { phone: '919600000001' } });
  await ctx.app.inject({ method: 'POST', url: '/contacts', headers: bearer(b.token), payload: { phone: '919600000002' } });

  const r = await ctx.app.inject({ method: 'POST', url: `/admin/tenants/${a.tenantId}/impersonate`, headers: admin() });
  assert.equal(r.statusCode, 200, r.body);
  const token = r.json().token as string;
  const claims = decodeJwt(token);
  assert.equal(claims.imp, adminId);
  assert.ok(claims.exp! - claims.iat! <= 15 * 60);
  assert.deepEqual(await verifyToken(token, 'x'.repeat(40)),
    { userId: claims.sub, tenantId: a.tenantId, role: 'owner', impersonatedBy: adminId });

  const list = (await ctx.app.inject({ method: 'GET', url: '/contacts', headers: bearer(token) })).json();
  assert.deepEqual(list.data.map((c: { phone: string }) => c.phone), ['919600000001']);
  // The impersonation token is a tenant token: it does not open /admin.
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/admin/plans', headers: bearer(token) })).statusCode, 401);

  const logs = (await ctx.app.inject({ method: 'GET', headers: admin(),
    url: `/admin/audit-logs?tenantId=${a.tenantId}&action=admin.impersonate` })).json();
  assert.equal(logs.total, 1);
  assert.equal(logs.data[0].user_id, adminId);
});
