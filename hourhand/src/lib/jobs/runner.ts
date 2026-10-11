import type pg from "pg";
import { syncDueConnections } from "../calendar/sync";
import { queueRenewalReminders } from "../billing/reminders";
import { purgeClosedAccounts } from "../data/account-lifecycle";
import type { Mailer } from "../mail/mailer";
import { processRefunds, reconcilePayments, type PaymentCheckDeps } from "../payments/booking-payments";
import { setJobKick } from "./kick";
import { BATCH_SIZE, processDueNotifications, type CalendarDeps } from "./worker";

// The job loop: every few seconds (or at once when kicked) it syncs due Google calendars, settles pending booking payments, then runs due queue rows
// (email and calendar writes); once an hour it queues plan renewal reminders and purges closed accounts. All of it is safe on several servers at once.

const HOUR = 3_600_000;

export interface JobRunner { tick(): Promise<void>; stop(): void }

export function startJobRunner(opts: { pool: pg.Pool; mailer: Mailer; baseUrl: string; calendar?: CalendarDeps | null; payments?: PaymentCheckDeps | null; intervalMs?: number }): JobRunner {
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
        if (opts.calendar) await syncDueConnections(opts.pool, opts.calendar.google, opts.calendar.key);
        // Its own catch: a payment check that fails must not hold up the emails below.
        if (opts.payments) await reconcilePayments({ pool: opts.pool, ...opts.payments }, new Date()).catch((error) => console.error("[jobs] payment check failed", error));
        if (opts.payments) await processRefunds({ pool: opts.pool, ...opts.payments }, new Date()).catch((error) => console.error("[jobs] refunds failed", error));
        // A full batch means more may be due: keep going until a batch comes back short.
        for (;;) {
          const r = await processDueNotifications(opts.pool, opts.mailer, { baseUrl: opts.baseUrl, calendar: opts.calendar });
          if (r.claimed < BATCH_SIZE && r.released === 0) break;
        }
        if (Date.now() - lastPurge >= HOUR) {
          lastPurge = Date.now();
          const reminders = await queueRenewalReminders(opts.pool, new Date());
          if (reminders) console.info(`[jobs] queued ${reminders} renewal ${reminders === 1 ? "reminder" : "reminders"}`);
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
