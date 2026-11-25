import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { claim, enqueue, fail, startWorker, PermanentJobError } from '../src/jobs.js';
import { setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

test('two workers claiming at once never get the same job', async () => {
  for (let i = 0; i < 20; i++) await enqueue(ctx.db, 'q-race', { i });
  const [a, b] = await Promise.all([claim(ctx.db, 'q-race', 15), claim(ctx.db, 'q-race', 15)]);
  const ids = [...a, ...b].map((j) => j.id);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
});

test('a dedupe key makes a repeated enqueue a no-op while pending', async () => {
  const first = await enqueue(ctx.db, 'q-dedupe', {}, { dedupeKey: 'k1' });
  const second = await enqueue(ctx.db, 'q-dedupe', {}, { dedupeKey: 'k1' });
  assert.ok(first);
  assert.equal(second, null);
});

test('a failed job is retried later, then marked failed after max attempts', async () => {
  await enqueue(ctx.db, 'q-retry', {}, { maxAttempts: 2 });
  const [job1] = await claim(ctx.db, 'q-retry');
  await fail(ctx.db, job1!, new Error('boom'));
  assert.equal((await claim(ctx.db, 'q-retry')).length, 0, 'not ready again until backoff passes');
  await ctx.db.query("UPDATE jobs SET run_at = now() WHERE queue = 'q-retry'");
  const [job2] = await claim(ctx.db, 'q-retry');
  assert.equal(job2!.attempts, 2);
  await fail(ctx.db, job2!, new Error('boom again'));
  const r = await ctx.db.query("SELECT status, last_error FROM jobs WHERE queue = 'q-retry'");
  assert.equal(r.rows[0].status, 'failed');
  assert.equal(r.rows[0].last_error, 'boom again');
});

test('the worker runs handlers, completes jobs and does not retry permanent errors', async () => {
  const seen: number[] = [];
  await enqueue(ctx.db, 'q-work', { n: 1 });
  await enqueue(ctx.db, 'q-work', { n: 2, bad: true });
  const w = startWorker(ctx.db, {
    'q-work': async (job) => {
      if (job.payload.bad) throw new PermanentJobError('invalid payload');
      seen.push(job.payload.n as number);
    },
  }, { pollMs: 20, log: () => {} });
  await w.runOnce();
  await w.stop();
  assert.deepEqual(seen, [1]);
  const r = await ctx.db.query("SELECT payload->>'n' AS n, status FROM jobs WHERE queue = 'q-work' ORDER BY id");
  assert.deepEqual(r.rows.map((x) => [x.n, x.status]), [['1', 'done'], ['2', 'failed']]);
});
