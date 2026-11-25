import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { isSafeWebhookUrl } from '../automation.js';
import { encryptSecret } from '../crypto.js';
import { withTenant } from '../db.js';
import { EVENTS, IMPORT_QUEUE, newApiKey, queueEvent } from '../integrations.js';
import { enqueue } from '../jobs.js';
import { requireActiveTenant } from '../limits.js';
import type { Deps } from '../app.js';

const importBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(5_000_000),
  defaultCountryCode: z.string().regex(/^[1-9]\d{0,3}$/).default('91'),
  // Required by WhatsApp policy: how these people agreed to hear from you.
  optInSource: z.string().trim().min(3).max(200),
});
const keyBody = z.object({ name: z.string().trim().min(1).max(80) });
const hookBody = z.object({ url: z.string().url().startsWith('https://'), events: z.array(z.enum(EVENTS)).min(1) });
const idOf = (p: unknown) => z.string().uuid().safeParse((p as { id?: string }).id);

export const integrationRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const managers = { preHandler: requireRole('owner', 'admin') };

  // ---------- CSV import ----------
  app.post('/contacts/import', { ...managers, bodyLimit: 6 * 1024 * 1024 }, async (req, reply) => {
    const b = importBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', issues: b.error.issues });
    const p = req.principal!;
    const id = await withTenant(deps.db, p.tenantId, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO import_jobs (tenant_id, file_name, csv, default_cc, opt_in_source, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [p.tenantId, b.data.fileName, b.data.csv, b.data.defaultCountryCode, b.data.optInSource, p.userId]);
      await enqueue(tx, IMPORT_QUEUE, { importId: r.rows[0]!.id }, { tenantId: p.tenantId });
      return r.rows[0]!.id;
    });
    return reply.code(202).send({ id, status: 'queued' });
  });

  app.get('/contacts/import-jobs', managers, async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => ({ data: (await tx.query(
    `SELECT id, file_name, status, total, created_count, updated_count, error_count, errors, created_at, updated_at
       FROM import_jobs ORDER BY created_at DESC LIMIT 50`)).rows })));

  // ---------- API keys ----------
  app.get('/settings/api-keys', managers, async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => ({ data: (await tx.query(
    'SELECT id, name, prefix, last_used_at, revoked_at, created_at FROM api_keys ORDER BY created_at DESC')).rows })));

  app.post('/settings/api-keys', managers, async (req, reply) => {
    const b = keyBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body' });
    const p = req.principal!, k = newApiKey();
    const row = await withTenant(deps.db, p.tenantId, async (tx) => {
      const r = await tx.query('INSERT INTO api_keys (tenant_id, name, prefix, key_hash, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, prefix, created_at',
        [p.tenantId, b.data.name, k.prefix, k.hash, p.userId]);
      await tx.query("INSERT INTO audit_logs (tenant_id, user_id, action, target) VALUES ($1, $2, 'api_key.create', $3)", [p.tenantId, p.userId, r.rows[0].id]);
      return r.rows[0];
    });
    return reply.code(201).send({ ...row, key: k.key, note: 'Copy this key now. It is not shown again.' });
  });

  app.delete('/settings/api-keys/:id', managers, async (req, reply) => {
    const id = idOf(req.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const r = await withTenant(deps.db, req.principal!.tenantId, (tx) =>
      tx.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id.data]));
    return r.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });

  // ---------- outbound webhooks ----------
  app.get('/settings/webhooks', managers, async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => ({ data: (await tx.query(
    'SELECT id, url, events, is_active, last_status, last_error, last_sent_at, created_at FROM webhook_endpoints ORDER BY created_at')).rows })));

  app.post('/settings/webhooks', managers, async (req, reply) => {
    const b = hookBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', issues: b.error.issues });
    if (!isSafeWebhookUrl(b.data.url)) return reply.code(400).send({ error: 'url_not_allowed' });
    const p = req.principal!, secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const row = await withTenant(deps.db, p.tenantId, async (tx) => (await tx.query(
      'INSERT INTO webhook_endpoints (tenant_id, url, events, secret_enc) VALUES ($1, $2, $3, $4) RETURNING id, url, events',
      [p.tenantId, b.data.url, b.data.events, encryptSecret(secret, deps.config.TOKEN_ENCRYPTION_KEY)])).rows[0]);
    return reply.code(201).send({ ...row, secret, note: 'Verify X-Wacrm-Signature with this secret. It is not shown again.' });
  });

  app.delete('/settings/webhooks/:id', managers, async (req, reply) => {
    const id = idOf(req.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const r = await withTenant(deps.db, req.principal!.tenantId, (tx) => tx.query('DELETE FROM webhook_endpoints WHERE id = $1', [id.data]));
    return r.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });

  app.post('/settings/webhooks/:id/test', managers, async (req, reply) => {
    const id = idOf(req.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const p = req.principal!;
    const ok = await withTenant(deps.db, p.tenantId, async (tx) => {
      const ep = (await tx.query<{ events: string[] }>('SELECT events FROM webhook_endpoints WHERE id = $1', [id.data])).rows[0];
      if (!ep) return false;
      await queueEvent(tx, p.tenantId, ep.events[0] as (typeof EVENTS)[number], { test: true });
      return true;
    });
    return ok ? reply.code(202).send({ ok: true }) : reply.code(404).send({ error: 'not_found' });
  });
};
