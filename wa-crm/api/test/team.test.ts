import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signup, bearer, signedWebhook, inboundText, connectNumber, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
const PNID = '777000333';

before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'team-owner@example.com');
  await connectNumber(ctx.app, owner.token, PNID, '999000333');
});
after(async () => { await ctx.close(); });

const api = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, token: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: bearer(token), ...(payload === undefined ? {} : { payload: payload as object }) });

async function addMember(email: string, role: 'admin' | 'agent') {
  const r = await api('POST', '/team', owner.token, { name: 'Member ' + email, email, role, password: 'member-password-1' });
  assert.equal(r.statusCode, 201, r.body);
  const login = await ctx.app.inject({ method: 'POST', url: '/auth/login',
    payload: { email, password: 'member-password-1', tenantId: owner.tenantId } });
  return { id: r.json().id as string, token: login.json().token as string };
}

async function inbound(phone: string, wamid: string) {
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText(PNID, phone, wamid, 'hello')) });
  const all = (await api('GET', '/conversations', owner.token)).json().data;
  return all.find((c: { contact_phone: string }) => c.contact_phone === phone) as { id: string; contact_id: string; assigned_user_id: string | null };
}

test('team: add, duplicate is 409, owner cannot be removed or demoted', async () => {
  const a = await addMember('agent1@example.com', 'agent');
  const dup = await api('POST', '/team', owner.token, { name: 'Again', email: 'agent1@example.com', role: 'agent', password: 'whatever-123' });
  assert.equal(dup.statusCode, 409);
  const team = (await api('GET', '/team', owner.token)).json().data;
  assert.equal(team.length, 2);
  const ownerId = team.find((m: { role: string }) => m.role === 'owner').id;
  assert.equal((await api('DELETE', `/team/${ownerId}`, owner.token)).statusCode, 404);
  assert.equal((await api('PATCH', `/team/${ownerId}`, owner.token, { role: 'agent' })).statusCode, 404);
  assert.equal((await api('GET', '/team', a.token)).statusCode, 403, 'agents cannot list the team');
});

test('assignment: agents see only their chats, can claim unassigned, cannot assign', async () => {
  const a = await addMember('agent2@example.com', 'agent');
  const b = await addMember('agent3@example.com', 'agent');
  const conv = await inbound('919500000001', 'wamid.TEAM1');

  assert.equal((await api('GET', '/conversations', a.token)).json().data.length, 0);
  assert.equal((await api('PATCH', `/conversations/${conv.id}/assign`, a.token, { userId: a.id })).statusCode, 403);
  assert.equal((await api('POST', `/conversations/${conv.id}/claim`, a.token)).statusCode, 200);
  assert.equal((await api('POST', `/conversations/${conv.id}/claim`, b.token)).statusCode, 409, 'already claimed');
  assert.equal((await api('GET', '/conversations', a.token)).json().data.length, 1);

  assert.equal((await api('PATCH', `/conversations/${conv.id}/assign`, owner.token, { userId: b.id })).statusCode, 200);
  assert.equal((await api('GET', '/conversations', a.token)).json().data.length, 0);
  assert.equal((await api('GET', `/conversations/${conv.id}/notes`, a.token)).statusCode, 404, 'not theirs any more');

  // Removing an agent unassigns their chats.
  assert.equal((await api('DELETE', `/team/${b.id}`, owner.token)).statusCode, 204);
  const after = (await api('GET', '/conversations', owner.token)).json().data.find((c: { id: string }) => c.id === conv.id);
  assert.equal(after.assigned_user_id, null);
});

test('assigning to someone outside the team is refused', async () => {
  const other = await signup(ctx.app, 'outsider@example.com');
  const conv = await inbound('919500000002', 'wamid.TEAM2');
  const me = (await api('GET', '/team', other.token)).json().data[0].id;
  const r = await api('PATCH', `/conversations/${conv.id}/assign`, owner.token, { userId: me });
  assert.equal(r.statusCode, 400);
});

test('notes and tags work, and tags from another tenant cannot be attached', async () => {
  const conv = await inbound('919500000003', 'wamid.TEAM3');
  assert.equal((await api('POST', `/conversations/${conv.id}/notes`, owner.token, { body: 'Called back, wants a quote' })).statusCode, 201);
  assert.equal((await api('GET', `/conversations/${conv.id}/notes`, owner.token)).json().data[0].body, 'Called back, wants a quote');

  const vip = (await api('POST', '/tags', owner.token, { label: 'VIP', color: '#f59e0b' })).json();
  assert.equal((await api('POST', '/tags', owner.token, { label: 'vip' })).statusCode, 409, 'labels are case-insensitive');
  assert.equal((await api('PUT', `/contacts/${conv.contact_id}/tags`, owner.token, { tagIds: [vip.id] })).statusCode, 200);
  const contacts = (await api('GET', '/contacts?search=919500000003', owner.token)).json().data;
  assert.deepEqual(contacts[0].tags.map((t: { label: string }) => t.label), ['VIP']);

  const other = await signup(ctx.app, 'tagger@example.com');
  const theirs = (await api('POST', '/tags', other.token, { label: 'Theirs' })).json();
  assert.equal((await api('PUT', `/contacts/${conv.contact_id}/tags`, owner.token, { tagIds: [theirs.id] })).statusCode, 404);
  assert.equal((await api('PUT', `/contacts/${conv.contact_id}/tags`, other.token, { tagIds: [theirs.id] })).statusCode, 404);
});

test('round-robin gives a new conversation to the least-busy agent', async () => {
  const t = await signup(ctx.app, 'rr@example.com');
  await connectNumber(ctx.app, t.token, '777000444', '999000444');
  assert.equal((await ctx.app.inject({ method: 'PATCH', url: '/settings/inbox', headers: bearer(t.token), payload: { autoAssign: true } })).statusCode, 200);
  const add = async (email: string) => (await ctx.app.inject({ method: 'POST', url: '/team', headers: bearer(t.token),
    payload: { name: email, email, role: 'agent', password: 'member-password-1' } })).json().id as string;
  const busy = await add('rr-busy@example.com');
  const free = await add('rr-free@example.com');
  const send = (phone: string, wamid: string) => ctx.app.inject({ method: 'POST', url: '/webhooks/meta',
    ...signedWebhook(inboundText('777000444', phone, wamid, 'hi')) });
  const list = async () => (await ctx.app.inject({ method: 'GET', url: '/conversations', headers: bearer(t.token) })).json().data;

  await send('919511111111', 'wamid.RR1');           // goes to busy (earliest member, both at 0)
  assert.equal((await list())[0].assigned_user_id, busy);
  await send('919522222222', 'wamid.RR2');           // busy has 1, free has 0 → free
  const second = (await list()).find((c: { contact_phone: string }) => c.contact_phone === '919522222222');
  assert.equal(second.assigned_user_id, free);
});

test('read endpoints for the web app: numbers without tokens, plans, inbox setting', async () => {
  const waba = (await api('GET', '/waba', owner.token)).json().data;
  assert.equal(waba[0].numbers[0].metaPhoneNumberId, PNID);
  assert.ok(!JSON.stringify(waba).includes('access_token'), 'tokens never leave the server');
  assert.equal((await api('GET', '/billing/plans', owner.token)).statusCode, 200);
  assert.deepEqual((await api('GET', '/settings/inbox', owner.token)).json(), { autoAssign: false });
});
