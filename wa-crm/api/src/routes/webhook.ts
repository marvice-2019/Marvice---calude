import type { FastifyPluginAsync } from 'fastify';
import { withPlatform, withTenant } from '../db.js';
import { isValidSignature, parseWebhook } from '../meta.js';
import type { AppDeps } from '../app.js';

// A status may arrive after a later one; never move a message backwards.
const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;

export const webhookRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  // Keep the raw bytes: the signature is computed over them, not over re-serialised JSON.
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => {
    done(null, body);
  });

  // Meta's one-time subscription check.
  app.get('/webhooks/meta', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === deps.config.META_WEBHOOK_VERIFY_TOKEN) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ error: 'verification_failed' });
  });

  app.post('/webhooks/meta', async (req, reply) => {
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw) || !isValidSignature(raw, req.headers['x-hub-signature-256'] as string | undefined,
        deps.config.META_APP_SECRET)) {
      req.log.warn('meta webhook: bad signature');
      return reply.code(401).send({ error: 'bad_signature' });
    }
    let payload: unknown;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return reply.code(400).send({ error: 'bad_json' }); }

    const { messages, statuses, templateUpdates } = parseWebhook(payload);
    const phoneIds = [...new Set([...messages, ...statuses].map((x) => x.phoneNumberId))];
    const routes = phoneIds.length === 0 ? new Map<string, { id: string; tenant_id: string }>() :
      await withPlatform(deps.db, async (tx) => {
        const r = await tx.query<{ id: string; tenant_id: string; meta_phone_number_id: string }>(
          'SELECT id, tenant_id, meta_phone_number_id FROM phone_numbers WHERE meta_phone_number_id = ANY($1)',
          [phoneIds]);
        return new Map(r.rows.map((row) => [row.meta_phone_number_id, row]));
      });

    for (const m of messages) {
      const route = routes.get(m.phoneNumberId);
      if (!route) { req.log.warn({ phoneNumberId: m.phoneNumberId }, 'meta webhook: unknown phone number'); continue; }
      await withTenant(deps.db, route.tenant_id, async (tx) => {
        const contact = await tx.query<{ id: string }>(
          `INSERT INTO contacts (tenant_id, phone_e164, name) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, phone_e164) DO UPDATE SET name = COALESCE(contacts.name, EXCLUDED.name)
           RETURNING id`, [route.tenant_id, m.from, m.profileName]);
        const conv = await tx.query<{ id: string }>(
          `INSERT INTO conversations (tenant_id, phone_number_id, contact_id) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, phone_number_id, contact_id) DO UPDATE SET status = 'open'
           RETURNING id`, [route.tenant_id, route.id, contact.rows[0]!.id]);
        const inserted = await tx.query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, type, body, payload, wa_message_id, status, created_at)
           VALUES ($1, $2, 'inbound', $3, $4, $5, $6, 'received', $7)
           ON CONFLICT (tenant_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [route.tenant_id, conv.rows[0]!.id, m.type, m.body, JSON.stringify(m.raw), m.waMessageId, m.timestamp]);
        if (inserted.rowCount) {
          await tx.query(
            `UPDATE conversations SET last_message_at = greatest(coalesce(last_message_at, $2), $2),
                    last_inbound_at = greatest(coalesce(last_inbound_at, $2), $2), unread_count = unread_count + 1
              WHERE id = $1`, [conv.rows[0]!.id, m.timestamp]);
        }
      });
    }

    for (const s of statuses) {
      const route = routes.get(s.phoneNumberId);
      if (!route) continue;
      await withTenant(deps.db, route.tenant_id, (tx) => tx.query(
        `UPDATE messages SET status = $2, error_code = coalesce($3, error_code)
          WHERE tenant_id = $4 AND wa_message_id = $1 AND direction = 'outbound'
            AND (CASE status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
                             WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END) < $5`,
        [s.waMessageId, s.status, s.errorCode, route.tenant_id, STATUS_RANK[s.status]]));
    }

    // Template review results: tenant found via the WABA id.
    for (const t of templateUpdates) {
      const owner = (await deps.db.query<{ tenant_id: string; id: string }>(
        'SELECT tenant_id, id FROM waba_accounts WHERE meta_waba_id = $1', [t.wabaId])).rows[0];
      if (!owner || !['APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'PENDING'].includes(t.event)) continue;
      await withTenant(deps.db, owner.tenant_id, (tx) => tx.query(
        `UPDATE message_templates SET status = $1, rejected_reason = CASE WHEN $1 = 'REJECTED' THEN $2 ELSE NULL END
          WHERE waba_account_id = $3 AND (meta_template_id = $4 OR (name = $5 AND language = $6))`,
        [t.event, t.reason, owner.id, t.metaTemplateId, t.name, t.language]));
    }

    // Meta retries anything that isn't a 200, so acknowledge once stored.
    return reply.code(200).send({ ok: true });
  });
};
