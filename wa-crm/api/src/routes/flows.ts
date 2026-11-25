import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { graphSchema, triggerSchema } from '../automation.js';
import { withTenant } from '../db.js';
import { requireActiveTenant } from '../limits.js';
import type { Deps } from '../app.js';

const flowBody = z.object({
  name: z.string().trim().min(1).max(120),
  phoneNumberId: z.string().uuid().nullable().default(null),
  trigger: triggerSchema,
  graph: graphSchema,
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const hoursBody = z.object({
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } },
    'unknown time zone'),
  hours: z.partialRecord(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), z.array(z.tuple([hhmm, hhmm])).max(4)),
  awayEnabled: z.boolean(),
  awayMessage: z.string().trim().max(1024).nullable(),
  awayCooldownMinutes: z.number().int().min(0).max(10080).default(240),
});

const uuidParam = (p: unknown) => z.string().uuid().safeParse((p as { id?: string }).id);

export const flowRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const managers = { preHandler: requireRole('owner', 'admin') };

  app.get('/flows', async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => ({ data: (await tx.query(
    `SELECT f.id, f.name, f.status, f.trigger, f.phone_number_id, jsonb_array_length(f.nodes) AS node_count, f.updated_at,
            (SELECT count(*)::int FROM flow_runs r WHERE r.flow_id = f.id) AS runs,
            (SELECT count(*)::int FROM flow_runs r WHERE r.flow_id = f.id AND r.status = 'failed') AS failed_runs
       FROM flows f ORDER BY f.updated_at DESC`)).rows })));

  app.get('/flows/:id', async (req, reply) => {
    const id = uuidParam(req.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const f = await withTenant(deps.db, req.principal!.tenantId, async (tx) => (await tx.query(
      'SELECT id, name, status, trigger, phone_number_id, nodes, edges, updated_at FROM flows WHERE id = $1', [id.data])).rows[0]);
    return f ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/flows', managers, async (req, reply) => {
    const b = flowBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_flow', issues: b.error.issues });
    const p = req.principal!;
    const row = await withTenant(deps.db, p.tenantId, async (tx) => (await tx.query(
      `INSERT INTO flows (tenant_id, name, phone_number_id, trigger, nodes, edges) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, status`, [p.tenantId, b.data.name, b.data.phoneNumberId, JSON.stringify(b.data.trigger),
        JSON.stringify(b.data.graph.nodes), JSON.stringify(b.data.graph.edges)])).rows[0]);
    return reply.code(201).send(row);
  });

  // Editing a published flow affects new runs only; running ones keep their snapshot.
  app.put('/flows/:id', managers, async (req, reply) => {
    const id = uuidParam(req.params);
    const b = flowBody.safeParse(req.body);
    if (!id.success || !b.success) return reply.code(400).send({ error: 'invalid_flow', issues: b.success ? [] : b.error.issues });
    const r = await withTenant(deps.db, req.principal!.tenantId, (tx) => tx.query(
      `UPDATE flows SET name = $2, phone_number_id = $3, trigger = $4, nodes = $5, edges = $6 WHERE id = $1 RETURNING id`,
      [id.data, b.data.name, b.data.phoneNumberId, JSON.stringify(b.data.trigger), JSON.stringify(b.data.graph.nodes),
       JSON.stringify(b.data.graph.edges)]));
    return r.rowCount ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  for (const [action, status] of [['publish', 'published'], ['pause', 'paused']] as const) {
    app.post(`/flows/:id/${action}`, managers, async (req, reply) => {
      const id = uuidParam(req.params);
      if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
      const r = await withTenant(deps.db, req.principal!.tenantId, (tx) =>
        tx.query('UPDATE flows SET status = $2 WHERE id = $1 RETURNING id', [id.data, status]));
      return r.rowCount ? { ok: true, status } : reply.code(404).send({ error: 'not_found' });
    });
  }

  app.delete('/flows/:id', managers, async (req, reply) => {
    const id = uuidParam(req.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const r = await withTenant(deps.db, req.principal!.tenantId, (tx) => tx.query('DELETE FROM flows WHERE id = $1', [id.data]));
    return r.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });

  app.get('/flows/:id/runs', managers, async (req, reply) => {
    const id = uuidParam(req.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    return withTenant(deps.db, req.principal!.tenantId, async (tx) => ({ data: (await tx.query(
      `SELECT id, conversation_id, current_node, status, steps, error, created_at, updated_at
         FROM flow_runs WHERE flow_id = $1 ORDER BY created_at DESC LIMIT 100`, [id.data])).rows }));
  });

  // A person takes over: stop any bot run in this conversation.
  app.post('/conversations/:id/stop-bot', async (req, reply) => {
    const id = uuidParam(req.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const r = await withTenant(deps.db, req.principal!.tenantId, (tx) => tx.query(
      `UPDATE flow_runs SET status = 'cancelled', wait_token = NULL
        WHERE conversation_id = $1 AND status IN ('running','waiting_reply','waiting_timer')`, [id.data]));
    return { ok: true, stopped: r.rowCount };
  });

  app.get('/settings/working-hours', async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => (await tx.query(
    `SELECT timezone, hours, away_enabled, away_message, away_cooldown_min FROM inbox_settings`)).rows[0]
    ?? { timezone: 'Asia/Kolkata', hours: {}, away_enabled: false, away_message: null, away_cooldown_min: 240 }));

  app.put('/settings/working-hours', managers, async (req, reply) => {
    const b = hoursBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', issues: b.error.issues });
    if (b.data.awayEnabled && !b.data.awayMessage) return reply.code(400).send({ error: 'away_message_required' });
    const p = req.principal!;
    await withTenant(deps.db, p.tenantId, (tx) => tx.query(
      `INSERT INTO inbox_settings (tenant_id, timezone, hours, away_enabled, away_message, away_cooldown_min)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET timezone = EXCLUDED.timezone, hours = EXCLUDED.hours, away_enabled = EXCLUDED.away_enabled,
         away_message = EXCLUDED.away_message, away_cooldown_min = EXCLUDED.away_cooldown_min`,
      [p.tenantId, b.data.timezone, JSON.stringify(b.data.hours), b.data.awayEnabled, b.data.awayMessage, b.data.awayCooldownMinutes]));
    return { ok: true };
  });
};
