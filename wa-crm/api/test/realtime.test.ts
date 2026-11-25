import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect, type Socket } from 'socket.io-client';
import { attachSocketIo, type Realtime } from '../src/realtime.js';
import { setup, signup, bearer, signedWebhook, inboundText, connectNumber, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let url: string;
let owner: { token: string; tenantId: string };
let closeIo: () => Promise<void>;
const sockets: Socket[] = [];
const PNID = '777000555';

before(async () => {
  let live: Realtime | null = null;
  ctx = await setup({}, { realtime: { conversation: (...a) => live?.conversation(...a), toUser: (...a) => live?.toUser(...a) } });
  const { realtime, io } = attachSocketIo(ctx.app.server, ctx.config.JWT_SECRET);
  live = realtime;
  closeIo = () => new Promise((res) => { void io.close(() => res()); });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = ctx.app.server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
  owner = await signup(ctx.app, 'live@example.com');
  await connectNumber(ctx.app, owner.token, PNID, '999000555');
});
after(async () => {
  for (const s of sockets) s.disconnect();
  await closeIo();
  await ctx.close();
});

function open(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
}

/** Collects events of one name for a short window. */
function collect(s: Socket, event: string, ms = 400): Promise<unknown[]> {
  const got: unknown[] = [];
  s.on(event, (d) => got.push(d));
  return new Promise((res) => setTimeout(() => res(got), ms));
}

async function agent(email: string) {
  const r = await ctx.app.inject({ method: 'POST', url: '/team', headers: bearer(owner.token),
    payload: { name: email, email, role: 'agent', password: 'member-password-1' } });
  const login = await ctx.app.inject({ method: 'POST', url: '/auth/login',
    payload: { email, password: 'member-password-1', tenantId: owner.tenantId } });
  return { id: r.json().id as string, token: login.json().token as string };
}

test('a bad token cannot connect', async () => {
  await assert.rejects(open('not-a-token'), /unauthorized/);
});

test('managers see new messages; agents only see chats assigned to them', async () => {
  const a = await agent('live-a@example.com');
  const mgr = await open(owner.token);
  const agentSock = await open(a.token);
  const mgrGot = collect(mgr, 'message.created');
  const agentGot = collect(agentSock, 'message.created');
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText(PNID, '919400000001', 'wamid.LIVE1', 'hi')) });
  assert.equal((await mgrGot).length, 1);
  assert.equal((await agentGot).length, 0, 'unassigned chat must not reach an agent');

  // After assignment the agent gets both the assignment and later messages.
  const conv = (await ctx.app.inject({ method: 'GET', url: '/conversations', headers: bearer(owner.token) })).json()
    .data.find((c: { contact_phone: string }) => c.contact_phone === '919400000001');
  const assigned = collect(agentSock, 'conversation.assigned');
  await ctx.app.inject({ method: 'PATCH', url: `/conversations/${conv.id}/assign`, headers: bearer(owner.token), payload: { userId: a.id } });
  assert.equal((await assigned).length, 1);
  const later = collect(agentSock, 'message.created');
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText(PNID, '919400000001', 'wamid.LIVE2', 'again')) });
  assert.equal((await later).length, 1);
});

test('another tenant\'s manager hears nothing', async () => {
  const other = await signup(ctx.app, 'live-other@example.com');
  const s = await open(other.token);
  const got = collect(s, 'message.created');
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText(PNID, '919400000002', 'wamid.LIVE3', 'hi')) });
  assert.equal((await got).length, 0);
});
