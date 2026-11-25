import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signup, bearer, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
let pipelineId: string;
before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'pipe@example.com');
});
after(async () => { await ctx.close(); });

const api = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object, token = owner.token) =>
  ctx.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

test('a workspace gets a default Sales pipeline on first view', async () => {
  const r = (await api('GET', '/pipelines')).json().data;
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'Sales');
  assert.deepEqual(r[0].stages.map((s: { id: string }) => s.id), ['new', 'contacted', 'quoted', 'negotiating', 'closing']);
  pipelineId = r[0].id;
  assert.equal((await api('GET', '/pipelines')).json().data.length, 1, 'not created twice');
});

test('deals move between stages, close as won, and the summary adds up', async () => {
  const contact = (await api('POST', '/contacts', { phone: '919400011111', name: 'Lakshmi Textiles' })).json();
  const d1 = (await api('POST', '/deals', { pipelineId, stageId: 'new', title: 'Bulk saree order', valuePaise: 4500000, contactId: contact.id })).json();
  const d2 = (await api('POST', '/deals', { pipelineId, stageId: 'new', title: 'Wedding set', valuePaise: 1200000 })).json();
  assert.equal((await api('POST', '/deals', { pipelineId, stageId: 'nope', title: 'x' })).statusCode, 400);

  assert.equal((await api('PATCH', `/deals/${d1.id}`, { stageId: 'quoted', position: 1 })).statusCode, 200);
  const board = (await api('GET', `/pipelines/${pipelineId}/deals`)).json().data;
  assert.equal(board.find((d: { id: string }) => d.id === d1.id).stage_id, 'quoted');
  assert.equal(board.find((d: { id: string }) => d.id === d1.id).contact_name, 'Lakshmi Textiles');

  assert.equal((await api('PATCH', `/deals/${d2.id}`, { status: 'won' })).statusCode, 200);
  const sum = (await api('GET', `/pipelines/${pipelineId}/summary`)).json();
  assert.deepEqual([sum.open_deals, Number(sum.open_value_paise), sum.won_30d, Number(sum.won_value_30d_paise)], [1, 4500000, 1, 1200000]);
  assert.ok(!(await api('GET', `/pipelines/${pipelineId}/deals`)).json().data.some((d: { id: string }) => d.id === d2.id), 'won deals leave the board');
});

test('a stage with deals cannot be removed', async () => {
  const r = await api('PUT', `/pipelines/${pipelineId}`, { name: 'Sales', stages: [{ id: 'new', name: 'New lead' }] });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().stage, 'quoted');
});

test('agents see only their own and unowned deals; another workspace sees none', async () => {
  await api('POST', '/team', { name: 'Agent P', email: 'agent-p@example.com', role: 'agent', password: 'member-password-1' });
  const agent = (await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'agent-p@example.com', password: 'member-password-1' } })).json().token;
  const team = (await api('GET', '/team')).json().data;
  const ownerId = team.find((m: { role: string }) => m.role === 'owner').id;
  const mine = (await api('POST', '/deals', { pipelineId, stageId: 'new', title: 'Owner-only deal', ownerUserId: ownerId })).json();
  const seen = (await api('GET', `/pipelines/${pipelineId}/deals`, undefined, agent)).json().data;
  assert.ok(!seen.some((d: { id: string }) => d.id === mine.id));
  assert.equal((await api('PATCH', `/deals/${mine.id}`, { stageId: 'closing' }, agent)).statusCode, 404);

  const other = await signup(ctx.app, 'pipe-other@example.com');
  assert.equal((await api('GET', `/pipelines/${pipelineId}/deals`, undefined, other.token)).json().data.length, 0);
  assert.equal((await api('PATCH', `/deals/${mine.id}`, { status: 'lost' }, other.token)).statusCode, 404);
});
