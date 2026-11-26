import type { FastifyPluginAsync } from 'fastify';
import { withPlatform, withTenant } from '../db.js';
import { isValidSignature, parseWebhook } from '../meta.js';
import { FLOW_INBOUND } from '../automation.js';
import { orderFromCart } from '../commerce.js';
import { enqueue } from '../jobs.js';
import { queueEvent } from '../integrations.js';
import type { Deps } from '../app.js';

// A status may arrive after a later one; never move a message backwards.
const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;

export const webhookRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
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

    const autoAssign = new Map<string, boolean>();
    for (const m of messages) {
      const route = routes.get(m.phoneNumberId);
      if (!route) { req.log.warn({ phoneNumberId: m.phoneNumberId }, 'meta webhook: unknown phone number'); continue; }
      if (!autoAssign.has(route.tenant_id)) {
        const t = await deps.db.query<{ auto_assign: boolean }>('SELECT auto_assign FROM tenants WHERE id = $1', [route.tenant_id]);
        autoAssign.set(route.tenant_id, t.rows[0]?.auto_assign ?? false);
      }
      const event = await withTenant(deps.db, route.tenant_id, async (tx) => {
        const contact = await tx.query<{ id: string }>(
          `INSERT INTO contacts (tenant_id, phone_e164, name) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, phone_e164) DO UPDATE SET name = COALESCE(contacts.name, EXCLUDED.name)
           RETURNING id`, [route.tenant_id, m.from, m.profileName]);
        const conv = await tx.query<{ id: string; assigned_user_id: string | null; created: boolean }>(
          `INSERT INTO conversations (tenant_id, phone_number_id, contact_id) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, phone_number_id, contact_id) DO UPDATE SET status = 'open'
           RETURNING id, assigned_user_id, (xmax = 0) AS created`, [route.tenant_id, route.id, contact.rows[0]!.id]);
        const c = conv.rows[0]!;
        let assignee = c.assigned_user_id;
        if (c.created && autoAssign.get(route.tenant_id)) {
          const pick = await tx.query<{ id: string | null }>('SELECT pick_round_robin_agent() AS id');
          assignee = pick.rows[0]?.id ?? null;
          if (assignee) await tx.query('UPDATE conversations SET assigned_user_id = $2 WHERE id = $1', [c.id, assignee]);
        }
        const inserted = await tx.query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, type, body, payload, wa_message_id, status, created_at)
           VALUES ($1, $2, 'inbound', $3, $4, $5, $6, 'received', $7)
           ON CONFLICT (tenant_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
           RETURNING id, direction, type, body, status, created_at`,
          [route.tenant_id, c.id, m.type, m.body, JSON.stringify(m.raw), m.waMessageId, m.timestamp]);
        if (!inserted.rowCount) return null;
        // A WhatsApp cart becomes an order (idempotent: the message insert above already de-duplicates by wamid).
        if (m.type === 'order') await orderFromCart(tx, route.tenant_id, contact.rows[0]!.id, c.id, m.waMessageId, m.raw);
        await tx.query(
          `UPDATE conversations SET last_message_at = greatest(coalesce(last_message_at, $2), $2),
                  last_inbound_at = greatest(coalesce(last_inbound_at, $2), $2), unread_count = unread_count + 1
            WHERE id = $1`, [c.id, m.timestamp]);
        // Chatbot flows, keyword replies and the away message run on the job queue, so Meta gets its 200 fast.
        await enqueue(tx, FLOW_INBOUND, { conversationId: c.id, body: m.body, replyId: m.replyId, isNew: c.created },
          { tenantId: route.tenant_id, dedupeKey: `in:${m.waMessageId}` });
        await queueEvent(tx, route.tenant_id, 'message.received', { conversationId: c.id,
          contact: { phone: m.from, name: m.profileName }, message: inserted.rows[0] });
        return { conversationId: c.id, assignee, assignedNow: c.created && assignee !== null, message: inserted.rows[0] };
      });
      // Emit only after commit, so clients never see data that was rolled back.
      if (event) {
        deps.realtime.conversation(route.tenant_id, event.assignee, 'message.created',
          { conversationId: event.conversationId, message: event.message });
        if (event.assignedNow) {
          deps.realtime.conversation(route.tenant_id, event.assignee, 'conversation.assigned',
            { conversationId: event.conversationId, userId: event.assignee });
        }
      }
    }

    for (const s of statuses) {
      const route = routes.get(s.phoneNumberId);
      if (!route) continue;
      const updated = await withTenant(deps.db, route.tenant_id, async (tx) => {
        const res = await tx.query<{ id: string; conversation_id: string; assigned_user_id: string | null }>(
        `UPDATE messages SET status = $2, error_code = coalesce($3, error_code)
          WHERE tenant_id = $4 AND wa_message_id = $1 AND direction = 'outbound'
            AND (CASE status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
                             WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END) < $5
          RETURNING id, conversation_id,
                    (SELECT assigned_user_id FROM conversations c WHERE c.id = messages.conversation_id)`,
        [s.waMessageId, s.status, s.errorCode, route.tenant_id, STATUS_RANK[s.status]]);
        for (const u of res.rows) {
          await queueEvent(tx, route.tenant_id, 'message.status', { conversationId: u.conversation_id, messageId: u.id,
            waMessageId: s.waMessageId, status: s.status, errorCode: s.errorCode });
        }
        return res;
      });
      for (const u of updated.rows) {
        deps.realtime.conversation(route.tenant_id, u.assigned_user_id, 'message.status',
          { conversationId: u.conversation_id, messageId: u.id, status: s.status });
      }
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
