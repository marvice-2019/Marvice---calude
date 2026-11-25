import type { Deps } from './app.js';
import { FLOW_INBOUND, FLOW_TIMER, flowInboundHandler, flowTimerHandler } from './automation.js';
import { IMPORT_QUEUE, importHandler, WEBHOOK_QUEUE, webhookDeliverHandler } from './integrations.js';
import { enqueue, startWorker } from './jobs.js';
import { billingGraceCheck } from './routes/billing.js';
import { CAMPAIGN_QUEUE, campaignSendHandler } from './routes/campaigns.js';

const GRACE_QUEUE = 'billing.grace-check';

/** Starts the job worker plus a small scheduler for daily jobs. Returns a stop function. */
export function startBackgroundWorker(deps: Deps) {
  const worker = startWorker(deps.db, {
    [CAMPAIGN_QUEUE]: campaignSendHandler(deps),
    [FLOW_INBOUND]: flowInboundHandler(deps),
    [FLOW_TIMER]: flowTimerHandler(deps),
    [IMPORT_QUEUE]: importHandler(deps),
    [WEBHOOK_QUEUE]: webhookDeliverHandler(deps),
    [GRACE_QUEUE]: billingGraceCheck(deps.db, deps.config.BILLING_GRACE_DAYS),
  }, { log: (m, e) => console.error(m, e) });

  // Once a day per date; the dedupe key makes repeated ticks (or several instances) harmless.
  const tick = () => {
    const day = new Date().toISOString().slice(0, 10);
    enqueue(deps.db, GRACE_QUEUE, {}, { dedupeKey: `grace:${day}` }).catch((e) => console.error('schedule failed', e));
  };
  tick();
  const timer = setInterval(tick, 60 * 60 * 1000);

  return async () => {
    clearInterval(timer);
    await worker.stop();
  };
}
