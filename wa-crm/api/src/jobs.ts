import type { Db, Tx } from './db.js';

export interface Job {
  id: string;
  queue: string;
  tenant_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface EnqueueOptions {
  tenantId?: string;
  runAt?: Date;
  maxAttempts?: number;
  /** Same queue + key while queued or running = one job. */
  dedupeKey?: string;
}

/** Adds a job. Pass the caller's transaction so the job commits with the data it refers to. */
export async function enqueue(q: Db | Tx, queue: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}) {
  // Through enqueue_job() so tenant transactions can queue work without access to the jobs table.
  const r = await q.query<{ id: string | null }>(
    'SELECT enqueue_job($1, $2, $3, $4, $5, $6)::text AS id',
    [queue, opts.tenantId ?? null, JSON.stringify(payload), opts.runAt ?? null, opts.maxAttempts ?? 5, opts.dedupeKey ?? null]);
  return r.rows[0]?.id ?? null;
}

const STALE_LOCK = "interval '5 minutes'";

/** Atomically takes up to `limit` ready jobs. Jobs stuck in running for 5+ minutes are taken back. */
export async function claim(db: Db, queue: string, limit = 10): Promise<Job[]> {
  const r = await db.query<Job>(
    `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM jobs
         WHERE queue = $1 AND (
               (status = 'queued' AND run_at <= now())
            OR (status = 'running' AND locked_at < now() - ${STALE_LOCK}))
         ORDER BY run_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED)
     RETURNING id::text, queue, tenant_id, payload, attempts, max_attempts`, [queue, limit]);
  return r.rows;
}

export async function complete(db: Db, id: string): Promise<void> {
  await db.query("UPDATE jobs SET status = 'done', locked_at = NULL WHERE id = $1", [id]);
}

/** Retries with exponential backoff (30 s, 1 min, 2 min, ... capped at 1 h); fails for good after max_attempts. */
export async function fail(db: Db, job: Job, error: unknown, opts: { retry?: boolean } = {}): Promise<void> {
  const msg = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const giveUp = opts.retry === false || job.attempts >= job.max_attempts;
  const delaySec = Math.min(3600, 30 * 2 ** Math.max(0, job.attempts - 1));
  await db.query(
    `UPDATE jobs SET status = $2, last_error = $3, locked_at = NULL,
            run_at = CASE WHEN $2 = 'queued' THEN now() + make_interval(secs => $4::double precision) ELSE run_at END
      WHERE id = $1`,
    [job.id, giveUp ? 'failed' : 'queued', msg, delaySec]);
}

export type Handler = (job: Job) => Promise<void>;

export class PermanentJobError extends Error {}

/** Polls the listed queues until stop() is called. One handler per queue. */
export function startWorker(db: Db, handlers: Record<string, Handler>,
  opts: { pollMs?: number; batch?: number; log?: (m: string, e?: unknown) => void } = {}) {
  const pollMs = opts.pollMs ?? 1000, batch = opts.batch ?? 10;
  const log = opts.log ?? ((m, e) => console.error(m, e));
  let stopped = false;
  let wake: (() => void) | null = null;

  const runOnce = async (): Promise<number> => {
    let handled = 0;
    for (const [queue, handler] of Object.entries(handlers)) {
      for (const job of await claim(db, queue, batch)) {
        handled++;
        try {
          await handler(job);
          await complete(db, job.id);
        } catch (err) {
          log(`job ${job.id} (${queue}) failed`, err);
          await fail(db, job, err, { retry: !(err instanceof PermanentJobError) });
        }
      }
    }
    return handled;
  };

  const loop = (async () => {
    while (!stopped) {
      let n = 0;
      try { n = await runOnce(); } catch (err) { log('worker poll failed', err); }
      if (n === 0 && !stopped) await new Promise<void>((res) => { wake = res; setTimeout(res, pollMs); });
    }
  })();

  return {
    runOnce,
    stop: async () => { stopped = true; wake?.(); await loop; },
  };
}
