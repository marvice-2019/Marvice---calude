import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { encryptSecret, decryptSecret } from '../crypto.js';
import { withTenant } from '../db.js';
import { assertWithinLimit, requireActiveTenant } from '../limits.js';
import { MetaApiError, sendText } from '../meta.js';
import type { Deps } from '../app.js';

const connectBody = z.object({
  metaWabaId: z.string().regex(/^\d{5,30}$/),
  accessToken: z.string().min(20).max(1000),
  phoneNumberId: z.string().regex(/^\d{5,30}$/),
  displayPhone: z.string().min(5).max(30),
  verifiedName: z.string().max(120).optional(),
});

const sendBody = z.object({ text: z.string().trim().min(1).max(4096) });
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const inboxRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));

  // Manual connection for now; Meta Embedded Signup replaces this once we are a Tech Provider.
  app.post('/waba/connect', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const body = connectBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const b = body.data, p = req.principal!;
    try {
      const out = await withTenant(deps.db, p.tenantId, async (tx) => {
        await assertWithinLimit(tx, 'whatsapp_numbers');
        const w = await tx.query<{ id: string }>(
          `INSERT INTO waba_accounts (tenant_id, meta_waba_id, access_token_enc) VALUES ($1, $2, $3) RETURNING id`,
          [p.tenantId, b.metaWabaId, encryptSecret(b.accessToken, deps.config.TOKEN_ENCRYPTION_KEY)]);
        const n = await tx.query<{ id: string }>(
          `INSERT INTO phone_numbers (tenant_id, waba_account_id, meta_phone_number_id, display_phone, verified_name)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [p.tenantId, w.rows[0]!.id, b.phoneNumberId, b.displayPhone, b.verifiedName ?? null]);
        await tx.query("INSERT INTO audit_logs (tenant_id, user_id, action, target) VALUES ($1, $2, 'waba.connect', $3)",
          [p.tenantId, p.userId, b.metaWabaId]);
        return { wabaAccountId: w.rows[0]!.id, phoneNumberId: n.rows[0]!.id };
      });
      return reply.code(201).send(out);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'already_connected' });
      throw err;
    }
  });

  // Agents see only conversations assigned to them; owners and admins see all.
  app.get('/conversations', async (req) => {
    const p = req.principal!;
    return withTenant(deps.db, p.tenantId, async (tx) => {
      const r = await tx.query(
        `SELECT c.id, c.status, c.unread_count, c.last_message_at, c.assigned_user_id,
                ct.id AS contact_id, ct.name AS contact_name, ct.phone_e164 AS contact_phone
           FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
          WHERE $1 <> 'agent' OR c.assigned_user_id = $2
          ORDER BY c.last_message_at DESC NULLS LAST LIMIT 100`, [p.role, p.userId]);
      return { data: r.rows };
    });
  });

  app.get('/conversations/:id/messages', async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const p = req.principal!;
    const out = await withTenant(deps.db, p.tenantId, async (tx) => {
      const c = await tx.query('SELECT id FROM conversations WHERE id = $1 AND ($2 <> \'agent\' OR assigned_user_id = $3)',
        [id.data, p.role, p.userId]);
      if (!c.rowCount) return null;
      await tx.query('UPDATE conversations SET unread_count = 0 WHERE id = $1', [id.data]);
      const m = await tx.query(
        `SELECT id, direction, type, body, status, error_code, created_at FROM messages
          WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 200`, [id.data]);
      return m.rows.reverse();
    });
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return { data: out };
  });

  app.post('/conversations/:id/messages', async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    const body = sendBody.safeParse(req.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    const p = req.principal!;

    const ctx = await withTenant(deps.db, p.tenantId, async (tx) => {
      const r = await tx.query<{ last_inbound_at: Date | null; to: string; meta_phone_number_id: string; token: string }>(
        `SELECT c.last_inbound_at, ct.phone_e164 AS to, pn.meta_phone_number_id, w.access_token_enc AS token
           FROM conversations c
           JOIN contacts ct ON ct.id = c.contact_id
           JOIN phone_numbers pn ON pn.id = c.phone_number_id
           JOIN waba_accounts w ON w.id = pn.waba_account_id
          WHERE c.id = $1 AND ($2 <> 'agent' OR c.assigned_user_id = $3)`, [id.data, p.role, p.userId]);
      return r.rows[0] ?? null;
    });
    if (!ctx) return reply.code(404).send({ error: 'not_found' });
    // Outside 24h of the customer's last message, Meta only accepts approved templates.
    if (!ctx.last_inbound_at || Date.now() - ctx.last_inbound_at.getTime() > SERVICE_WINDOW_MS) {
      return reply.code(422).send({ error: 'outside_service_window', hint: 'send an approved template instead' });
    }

    let wamid: string | null = null, errorCode: string | null = null;
    try {
      wamid = await sendText(deps.fetch, deps.config.META_GRAPH_VERSION, ctx.meta_phone_number_id,
        decryptSecret(ctx.token, deps.config.TOKEN_ENCRYPTION_KEY), ctx.to, body.data.text);
    } catch (err) {
      if (!(err instanceof MetaApiError)) throw err;
      req.log.error({ status: err.status, detail: err.detail }, 'meta send failed');
      errorCode = String((err.detail as { code?: unknown } | null)?.code ?? err.status);
    }

    const saved = await withTenant(deps.db, p.tenantId, async (tx) => {
      const m = await tx.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, type, body, wa_message_id, status, error_code, sent_by_user_id)
         VALUES ($1, $2, 'outbound', 'text', $3, $4, $5, $6, $7)
         RETURNING id, direction, type, body, status, error_code, created_at`,
        [p.tenantId, id.data, body.data.text, wamid, wamid ? 'sent' : 'failed', errorCode, p.userId]);
      const c = await tx.query<{ assigned_user_id: string | null }>(
        'UPDATE conversations SET last_message_at = now() WHERE id = $1 RETURNING assigned_user_id', [id.data]);
      return { message: m.rows[0], assignee: c.rows[0]?.assigned_user_id ?? null };
    });
    deps.realtime.conversation(p.tenantId, saved.assignee, 'message.created', { conversationId: id.data, message: saved.message });
    return reply.code(wamid ? 201 : 502).send(saved.message);
  });
};
