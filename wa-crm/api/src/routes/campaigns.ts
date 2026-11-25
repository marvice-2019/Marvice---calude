import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { decryptSecret } from '../crypto.js';
import { withTenant, type Tx } from '../db.js';
import { enqueue, PermanentJobError, type Handler } from '../jobs.js';
import { requireActiveTenant } from '../limits.js';
import { MetaApiError, sendTemplate } from '../meta.js';
import { variableNumbers } from './templates.js';
import { queueEvent } from '../integrations.js';
import type { Deps } from '../app.js';

export const CAMPAIGN_QUEUE = 'campaign.send';

const audience = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('tags'), tagIds: z.array(z.string().uuid()).min(1).max(20) }),
  z.object({ type: z.literal('contacts'), contactIds: z.array(z.string().uuid()).min(1).max(10_000) }),
]);

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  phoneNumberId: z.string().uuid(),
  templateId: z.string().uuid(),
  parameters: z.array(z.string().min(1).max(1024)).max(20).default([]),
  fallbackName: z.string().trim().min(1).max(60).default('there'),
  audience,
  scheduledAt: z.coerce.date().optional(),
});

/** Fills {{contact.name}} / {{contact.phone}} in campaign parameters for one recipient. */
export function personalise(params: string[], contact: { name: string | null; phone: string }, fallbackName: string): string[] {
  return params.map((p) => p.replace(/\{\{\s*contact\.name\s*\}\}/g, contact.name?.trim() || fallbackName)
    .replace(/\{\{\s*contact\.phone\s*\}\}/g, contact.phone));
}

async function statsFor(tx: Tx, ids: string[]) {
  const r = await tx.query<{ campaign_id: string; total: number; pending: number; sent: number; failed: number; skipped: number;
    delivered: number; read: number }>(
    `SELECT r.campaign_id,
            count(*)::int AS total,
            count(*) FILTER (WHERE r.status IN ('pending','sending'))::int AS pending,
            count(*) FILTER (WHERE r.status = 'sent')::int AS sent,
            count(*) FILTER (WHERE r.status = 'failed' OR m.status = 'failed')::int AS failed,
            count(*) FILTER (WHERE r.status = 'skipped')::int AS skipped,
            count(*) FILTER (WHERE m.status IN ('delivered','read'))::int AS delivered,
            count(*) FILTER (WHERE m.status = 'read')::int AS read
       FROM campaign_recipients r LEFT JOIN messages m ON m.id = r.message_id
      WHERE r.campaign_id = ANY($1) GROUP BY r.campaign_id`, [ids]);
  return new Map(r.rows.map((x) => [x.campaign_id, x]));
}

export const campaignRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const managers = { preHandler: requireRole('owner', 'admin') };

  app.post('/campaigns', managers, async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    const b = body.data, p = req.principal!;
    const out = await withTenant(deps.db, p.tenantId, async (tx) => {
      const t = (await tx.query<{ status: string; components: { type: string; text?: string }[] }>(
        `SELECT t.status, t.components FROM message_templates t JOIN phone_numbers pn ON pn.waba_account_id = t.waba_account_id
          WHERE t.id = $1 AND pn.id = $2`, [b.templateId, b.phoneNumberId])).rows[0];
      if (!t) return { error: 404, body: { error: 'template_or_number_not_found' } };
      if (t.status !== 'APPROVED') return { error: 422, body: { error: 'template_not_approved' } };
      const expected = variableNumbers(t.components.find((c) => c.type?.toUpperCase() === 'BODY')?.text ?? '').length;
      if (b.parameters.length !== expected) return { error: 400, body: { error: 'parameter_count', expected, got: b.parameters.length } };

      const c = await tx.query<{ id: string }>(
        `INSERT INTO campaigns (tenant_id, name, phone_number_id, template_id, parameters, audience, scheduled_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7, now()), $8) RETURNING id`,
        [p.tenantId, b.name, b.phoneNumberId, b.templateId, JSON.stringify(b.parameters),
         JSON.stringify({ ...b.audience, fallbackName: b.fallbackName }), b.scheduledAt ?? null, p.userId]);
      const campaignId = c.rows[0]!.id;
      // Audience is frozen now; opted-out contacts are recorded as skipped so the count is honest.
      const where = b.audience.type === 'all' ? 'TRUE'
        : b.audience.type === 'tags' ? 'EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = ct0.id AND ct.tag_id = ANY($3))'
        : 'ct0.id = ANY($3)';
      const ids = b.audience.type === 'tags' ? b.audience.tagIds : b.audience.type === 'contacts' ? b.audience.contactIds : [];
      const ins = await tx.query(
        `INSERT INTO campaign_recipients (tenant_id, campaign_id, contact_id, status)
         SELECT $1, $2, ct0.id, CASE WHEN ct0.opted_out_at IS NULL THEN 'pending' ELSE 'skipped' END
           FROM contacts ct0 WHERE ${where}`, [p.tenantId, campaignId, ids]);
      if (!ins.rowCount) return { error: 422, body: { error: 'empty_audience' } };
      await enqueue(tx, CAMPAIGN_QUEUE, { campaignId }, { tenantId: p.tenantId, runAt: b.scheduledAt, dedupeKey: `campaign:${campaignId}` });
      await tx.query("INSERT INTO audit_logs (tenant_id, user_id, action, target) VALUES ($1, $2, 'campaign.create', $3)",
        [p.tenantId, p.userId, campaignId]);
      return { id: campaignId, recipients: ins.rowCount };
    });
    if ('error' in out) return reply.code(out.error as number).send(out.body);
    return reply.code(201).send(out);
  });

  app.get('/campaigns', async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `SELECT c.id, c.name, c.status, c.scheduled_at, c.started_at, c.completed_at, c.created_at, t.name AS template_name
         FROM campaigns c JOIN message_templates t ON t.id = c.template_id ORDER BY c.created_at DESC LIMIT 100`);
    const stats = await statsFor(tx, r.rows.map((x) => x.id));
    return { data: r.rows.map((c) => ({ ...c, stats: stats.get(c.id) ?? null })) };
  }));

  app.get('/campaigns/:id', async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const out = await withTenant(deps.db, req.principal!.tenantId, async (tx) => {
      const c = (await tx.query('SELECT id, name, status, audience, parameters, scheduled_at, started_at, completed_at FROM campaigns WHERE id = $1',
        [id.data])).rows[0];
      if (!c) return null;
      return { ...c, stats: (await statsFor(tx, [id.data])).get(id.data) ?? null };
    });
    return out ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/campaigns/:id/cancel', managers, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const r = await withTenant(deps.db, req.principal!.tenantId, async (tx) => {
      const u = await tx.query("UPDATE campaigns SET status = 'cancelled', completed_at = now() WHERE id = $1 AND status IN ('scheduled','sending') RETURNING id", [id.data]);
      if (u.rowCount) await tx.query("UPDATE campaign_recipients SET status = 'skipped' WHERE campaign_id = $1 AND status = 'pending'", [id.data]);
      return u.rowCount;
    });
    return r ? { ok: true } : reply.code(409).send({ error: 'not_cancellable' });
  });
};

/**
 * Job handler: sends one batch, then queues the next batch after a short pause.
 * Each recipient is moved pending → sending in its own committed step before the Meta call,
 * so a crash or a second worker can never send the same recipient twice.
 */
export function campaignSendHandler(deps: Deps, opts: { batchSize?: number; batchDelayMs?: number } = {}): Handler {
  const batchSize = opts.batchSize ?? 40, delayMs = opts.batchDelayMs ?? 1000;
  return async (job) => {
    const tenantId = job.tenant_id, campaignId = job.payload.campaignId;
    if (!tenantId || typeof campaignId !== 'string') throw new PermanentJobError('bad campaign job payload');

    const ctx = await withTenant(deps.db, tenantId, async (tx) => {
      const c = (await tx.query<{ status: string; parameters: string[]; audience: { fallbackName?: string };
        tpl_name: string; tpl_lang: string; tpl_components: { type: string; text?: string }[];
        pn_id: string; meta_pn: string; token: string }>(
        `SELECT c.status, c.parameters, c.audience, t.name AS tpl_name, t.language AS tpl_lang, t.components AS tpl_components,
                pn.id AS pn_id, pn.meta_phone_number_id AS meta_pn, w.access_token_enc AS token
           FROM campaigns c JOIN message_templates t ON t.id = c.template_id
           JOIN phone_numbers pn ON pn.id = c.phone_number_id JOIN waba_accounts w ON w.id = pn.waba_account_id
          WHERE c.id = $1 FOR UPDATE OF c`, [campaignId])).rows[0];
      if (!c || c.status === 'cancelled' || c.status === 'completed') return null;
      if (c.status === 'scheduled') await tx.query("UPDATE campaigns SET status = 'sending', started_at = now() WHERE id = $1", [campaignId]);
      // Rows left in 'sending' by a crashed worker: outcome unknown, so fail them rather than risk a duplicate.
      await tx.query(`UPDATE campaign_recipients SET status = 'failed', error_code = 'interrupted'
                       WHERE campaign_id = $1 AND status = 'sending' AND claimed_at < now() - interval '5 minutes'`, [campaignId]);
      const batch = (await tx.query<{ id: string; contact_id: string; phone: string; name: string | null }>(
        `UPDATE campaign_recipients r SET status = 'sending', claimed_at = now()
          FROM contacts ct
         WHERE r.id IN (SELECT id FROM campaign_recipients WHERE campaign_id = $1 AND status = 'pending'
                         ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED)
           AND ct.id = r.contact_id
        RETURNING r.id, r.contact_id, ct.phone_e164 AS phone, ct.name`, [campaignId, batchSize])).rows;
      return { c, batch };
    });
    if (!ctx) return;

    const { c, batch } = ctx;
    const token = decryptSecret(c.token, deps.config.TOKEN_ENCRYPTION_KEY);
    const bodyText = c.tpl_components.find((x) => x.type?.toUpperCase() === 'BODY')?.text ?? '';
    for (const r of batch) {
      const params = personalise(c.parameters, r, c.audience.fallbackName ?? 'there');
      const components = params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [];
      const rendered = bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '');
      let wamid: string | null = null, errorCode: string | null = null;
      try {
        wamid = await sendTemplate(deps.fetch, deps.config.META_GRAPH_VERSION, c.meta_pn, token, r.phone,
          { name: c.tpl_name, language: c.tpl_lang, components });
      } catch (err) {
        if (!(err instanceof MetaApiError)) throw err;
        errorCode = String((err.detail as { code?: unknown } | null)?.code ?? err.status);
      }
      await withTenant(deps.db, tenantId, async (tx) => {
        let messageId: string | null = null;
        if (wamid) {
          const conv = await tx.query<{ id: string }>(
            `INSERT INTO conversations (tenant_id, phone_number_id, contact_id, last_message_at) VALUES ($1, $2, $3, now())
             ON CONFLICT (tenant_id, phone_number_id, contact_id) DO UPDATE SET last_message_at = now() RETURNING id`,
            [tenantId, c.pn_id, r.contact_id]);
          messageId = (await tx.query<{ id: string }>(
            `INSERT INTO messages (tenant_id, conversation_id, direction, type, body, wa_message_id, status, campaign_id)
             VALUES ($1, $2, 'outbound', 'template', $3, $4, 'sent', $5) RETURNING id`,
            [tenantId, conv.rows[0]!.id, rendered, wamid, campaignId])).rows[0]!.id;
        }
        await tx.query('UPDATE campaign_recipients SET status = $2, message_id = $3, error_code = $4 WHERE id = $1',
          [r.id, wamid ? 'sent' : 'failed', messageId, errorCode]);
      });
    }

    await withTenant(deps.db, tenantId, async (tx) => {
      const left = (await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM campaign_recipients WHERE campaign_id = $1 AND status IN ('pending','sending')", [campaignId])).rows[0]!.n;
      if (left === 0) {
        const done = await tx.query("UPDATE campaigns SET status = 'completed', completed_at = now() WHERE id = $1 AND status = 'sending' RETURNING id", [campaignId]);
        if (done.rowCount) await queueEvent(tx, tenantId, 'campaign.completed', { campaignId, stats: (await statsFor(tx, [campaignId])).get(campaignId) ?? null });
      } else {
        await enqueue(tx, CAMPAIGN_QUEUE, { campaignId }, { tenantId, runAt: delayMs > 0 ? new Date(Date.now() + delayMs) : undefined });
      }
    });
  };
}
