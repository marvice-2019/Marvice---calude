import type pg from "pg";
import { purgeClosedAccounts } from "../data/account-lifecycle";
import type { Mailer } from "../mail/mailer";
import { setJobKick } from "./kick";
import { BATCH_SIZE, processDueNotifications } from "./worker";

// The job loop: sends due email every few seconds (or at once when the data layer kicks it) and purges closed accounts
// once an hour. Both jobs are safe to run on several servers at once.

const HOUR = 3_600_000;

export interface JobRunner { tick(): Promise<void>; stop(): void }

export function startJobRunner(opts: { pool: pg.Pool; mailer: Mailer; baseUrl: string; intervalMs?: number }): JobRunner {
  let busy = false;
  let again = false;
  let lastPurge = 0;

  async function purge(now: Date) {
    const client = await opts.pool.connect();
    try {
      await client.query("begin");
      const purged = await purgeClosedAccounts(client, now);
      await client.query("commit");
      if (purged) console.info(`[jobs] purged ${purged} closed ${purged === 1 ? "account" : "accounts"}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function tick() {
    if (busy) {
      again = true; // a kick during a run: go round once more instead of running twice in parallel
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        // A full batch means more may be due: keep going until a batch comes back short.
        for (;;) {
          const r = await processDueNotifications(opts.pool, opts.mailer, { baseUrl: opts.baseUrl });
          if (r.claimed < BATCH_SIZE) break;
        }
        if (Date.now() - lastPurge >= HOUR) {
          lastPurge = Date.now();
          await purge(new Date());
        }
      } while (again);
    } catch (error) {
      console.error("[jobs] run failed; next run in a few seconds", error);
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void tick(), opts.intervalMs ?? 15_000);
  timer.unref();
  setJobKick(() => void tick());
  void tick();
  return {
    tick,
    stop() {
      clearInterval(timer);
      setJobKick(null);
    },
  };
}
