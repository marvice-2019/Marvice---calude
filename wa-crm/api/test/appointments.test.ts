import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bookSlot, DEFAULT_BOOKING, freeSlots, reminderHandler, REMINDER_QUEUE, zonedTime } from '../src/booking.js';
import { withTenant } from '../src/db.js';
import { noopRealtime } from '../src/realtime.js';
import { setup, signup, bearer, signedWebhook, inboundText, connectNumber, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
const PNID = '555000111';
const ALL_DAY = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['00:00', '23:30']]]));
let n = 0;

before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'booking@example.com');
  await connectNumber(ctx.app, owner.token, PNID, '555000999');
  ctx.setMetaResponse(() => ({ ok: true, status: 200, body: { messages: [{ id: `wamid.AP${++n}` }] } }));
});
after(async () => { await ctx.close(); });

const api = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(owner.token), ...(payload ? { payload } : {}) });
let wam = 0;
async function customer(phone: string) {
  await ctx.app.inject({ method: 'POST', url: '/webhooks/meta', ...signedWebhook(inboundText(PNID, phone, `wamid.APIN${++wam}`, 'hi')) });
  return withTenant(ctx.db, owner.tenantId, async (tx) =>
    (await tx.query<{ id: string }>('SELECT id FROM contacts WHERE phone_e164 = $1', [phone])).rows[0]!.id);
}
const settings = (over: object = {}) => api('PUT', '/settings/booking', { timezone: 'Asia/Kolkata', hours: ALL_DAY, slotMinutes: 30, capacity: 1,
  minNoticeMinutes: 0, daysAhead: 7, reminderMinutes: 60, reminderTemplateId: null, ...over });

test('slot maths: opening hours in the business time zone, notice period, capacity, daylight saving', () => {
  const s = { ...DEFAULT_BOOKING, hours: { mon: [['10:00', '12:00']] as [string, string][] }, min_notice_minutes: 60 };
  const now = new Date('2026-11-23T03:00:00Z');   // Monday 08:30 in India
  const booked = [{ starts_at: new Date('2026-11-23T05:00:00Z'), ends_at: new Date('2026-11-23T05:30:00Z') }];   // 10:30 IST taken
  const slots = freeSlots(s, booked, now, now, new Date('2026-11-24T00:00:00Z')).map((d) => d.toISOString());
  assert.deepEqual(slots, ['2026-11-23T04:30:00.000Z', '2026-11-23T05:30:00.000Z', '2026-11-23T06:00:00.000Z']);
  // Notice period: at 10:15 IST with 60 minutes' notice, 11:30 is the first bookable slot.
  const late = freeSlots(s, [], new Date('2026-11-23T04:45:00Z'), new Date('2026-11-23T04:45:00Z'), new Date('2026-11-24T00:00:00Z'));
  assert.equal(late[0]!.toISOString(), '2026-11-23T06:00:00.000Z');
  // London moves to summer time on 29 March 2026: 09:00 local is 08:00 UTC that day, 09:00 UTC the day before.
  assert.equal(zonedTime('2026-03-29', '09:00', 'Europe/London').toISOString(), '2026-03-29T08:00:00.000Z');
  assert.equal(zonedTime('2026-03-28', '09:00', 'Europe/London').toISOString(), '2026-03-28T09:00:00.000Z');
});

test('booking takes a slot; the same slot is refused until the first booking is cancelled', async () => {
  assert.equal((await settings()).statusCode, 200);
  const contactId = await customer('919700000001');
  const slots = (await api('GET', '/appointments/slots')).json().data as { startsAt: string; label: string }[];
  assert.ok(slots.length > 10);
  const startsAt = slots[3]!.startsAt;
  const first = await api('POST', '/appointments', { contactId, startsAt });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal((await api('POST', '/appointments', { contactId, startsAt })).statusCode, 409);
  const after = (await api('GET', '/appointments/slots')).json().data as { startsAt: string }[];
  assert.ok(!after.some((s) => s.startsAt === startsAt), 'taken slot is no longer offered');
  // An off-grid time is never bookable.
  const offGrid = new Date(Date.parse(startsAt) + 7 * 60000).toISOString();
  assert.equal((await api('POST', '/appointments', { contactId, startsAt: offGrid })).statusCode, 409);

  assert.equal((await api('PATCH', `/appointments/${first.json().id}`, { status: 'cancelled' })).statusCode, 200);
  assert.equal((await api('POST', '/appointments', { contactId, startsAt })).statusCode, 201);
});

test('two customers asking for the last place at the same moment: exactly one gets it', async () => {
  await settings({ capacity: 1 });
  const [a, b] = [await customer('919700000002'), await customer('919700000003')];
  const startsAt = new Date(((await api('GET', '/appointments/slots')).json().data as { startsAt: string }[]).at(-1)!.startsAt);
  // Hold A's transaction open after its insert, then let B try the same slot before A commits.
  let releaseA!: () => void;
  const gate = new Promise<void>((r) => { releaseA = r; });
  const pA = withTenant(ctx.db, owner.tenantId, async (tx) => { await bookSlot(tx, owner.tenantId, { contactId: a, startsAt, source: 'agent' }); await gate; });
  await new Promise((r) => setTimeout(r, 150));
  const pB = withTenant(ctx.db, owner.tenantId, (tx) => bookSlot(tx, owner.tenantId, { contactId: b, startsAt, source: 'agent' }))
    .then(() => 'booked', (e: Error) => e.message);
  await new Promise((r) => setTimeout(r, 300));
  releaseA();
  await pA;
  assert.equal(await pB, 'slot_unavailable');
  const count = await withTenant(ctx.db, owner.tenantId, async (tx) => (await tx.query(
    "SELECT 1 FROM appointments WHERE starts_at = $1 AND status = 'booked'", [startsAt])).rowCount);
  assert.equal(count, 1);
});

test('reminder: queued before the appointment, sent as text inside the 24-hour window, skipped once cancelled', async () => {
  await settings({ reminderMinutes: 60 });
  const contactId = await customer('919700000004');
  const slot = ((await api('GET', '/appointments/slots')).json().data as { startsAt: string }[])[10]!.startsAt;
  const appt = (await api('POST', '/appointments', { contactId, startsAt: slot })).json();
  const job = (await ctx.db.query<{ tenant_id: string; payload: Record<string, unknown>; run_at: Date }>(
    'SELECT tenant_id, payload, run_at FROM jobs WHERE queue = $1 AND payload->>\'appointmentId\' = $2', [REMINDER_QUEUE, appt.id])).rows[0]!;
  assert.equal(job.run_at.getTime(), Date.parse(slot) - 60 * 60000);

  const deps = { config: ctx.config, db: ctx.db, fetch: ctx.fetch, realtime: noopRealtime };
  const run = () => reminderHandler(deps)({ id: 'x', queue: REMINDER_QUEUE, tenant_id: job.tenant_id, payload: job.payload, attempts: 1, max_attempts: 5 });
  const before = ctx.sent.length;
  await run();
  const sent = ctx.sent.slice(before).map((s) => s.body as { to: string; text?: { body: string } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, '919700000004');
  assert.match(sent[0]!.text!.body, /^Reminder: your appointment is on /);
  await run();   // a retried job does not send twice
  assert.equal(ctx.sent.length, before + 1);

  const other = (await api('POST', '/appointments', { contactId, startsAt: ((await api('GET', '/appointments/slots')).json().data as { startsAt: string }[])[12]!.startsAt })).json();
  await api('PATCH', `/appointments/${other.id}`, { status: 'cancelled' });
  const b2 = ctx.sent.length;
  await reminderHandler(deps)({ id: 'y', queue: REMINDER_QUEUE, tenant_id: owner.tenantId, payload: { appointmentId: other.id, startsAt: other.starts_at }, attempts: 1, max_attempts: 5 });
  assert.equal(ctx.sent.length, b2, 'no reminder for a cancelled appointment');
});
