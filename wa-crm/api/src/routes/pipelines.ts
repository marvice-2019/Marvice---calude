import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { withTenant } from '../db.js';
import { requireActiveTenant } from '../limits.js';
import type { Deps } from '../app.js';

const stage = z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/), name: z.string().trim().min(1).max(40) });
const pipelineBody = z.object({
  name: z.string().trim().min(1).max(80),
  stages: z.array(stage).min(1).max(15).refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'stage ids must be unique'),
});
const dealBody = z.object({
  pipelineId: z.string().uuid(),
  stageId: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(160),
  valuePaise: z.number().int().min(0).max(1e13).default(0),
  contactId: z.string().uuid().nullable().default(null),
  ownerUserId: z.string().uuid().nullable().default(null),
});
const dealPatch = z.object({
  stageId: z.string().min(1).max(40).optional(),
  position: z.number().finite().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  valuePaise: z.number().int().min(0).max(1e13).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  status: z.enum(['open', 'won', 'lost']).optional(),
});
const idOf = (p: unknown) => z.string().uuid().safeParse((p as { id?: string }).id);

export const DEFAULT_STAGES = [
  { id: 'new', name: 'New lead' }, { id: 'contacted', name: 'Contacted' }, { id: 'quoted', name: 'Quote sent' },
  { id: 'negotiating', name: 'Negotiating' }, { id: 'closing', name: 'Closing' },
];

export const pipelineRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const managers = { preHandler: requireRole('owner', 'admin') };

  app.get('/pipelines', async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => {
    let rows = (await tx.query('SELECT id, name, stages FROM pipelines ORDER BY created_at')).rows;
    if (!rows.length) {   // every workspace starts with a usable sales pipeline
      rows = (await tx.query('INSERT INTO pipelines (tenant_id, name, stages) VALUES ($1, $2, $3) RETURNING id, name, stages',
        [req.principal!.tenantId, 'Sales', JSON.stringify(DEFAULT_STAGES)])).rows;
    }
    return { data: rows };
  }));

  app.post('/pipelines', managers, async (req, reply) => {
    const b = pipelineBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', issues: b.error.issues });
    const row = await withTenant(deps.db, req.principal!.tenantId, async (tx) => (await tx.query(
      'INSERT INTO pipelines (tenant_id, name, stages) VALUES ($1, $2, $3) RETURNING id, name, stages',
      [req.principal!.tenantId, b.data.name, JSON.stringify(b.data.stages)])).rows[0]);
    return reply.code(201).send(row);
  });

  // Removing a stage that still has deals is refused, so no deal is left on a missing column.
  app.put('/pipelines/:id', managers, async (req, reply) => {
    const id = idOf(req.params);
    const b = pipelineBody.safeParse(req.body);
    if (!id.success || !b.success) return reply.code(400).send({ error: 'invalid_body' });
    const res = await withTenant(deps.db, req.principal!.tenantId, async (tx) => {
      const orphan = (await tx.query<{ stage_id: string }>(
        'SELECT DISTINCT stage_id FROM deals WHERE pipeline_id = $1 AND NOT (stage_id = ANY($2))', [id.data, b.data.stages.map((s) => s.id)])).rows[0];
      if (orphan) return { error: 'stage_has_deals', stage: orphan.stage_id };
      const u = await tx.query('UPDATE pipelines SET name = $2, stages = $3 WHERE id = $1 RETURNING id', [id.data, b.data.name, JSON.stringify(b.data.stages)]);
      return u.rowCount ? { ok: true } : { error: 'not_found' };
    });
    if ('error' in res) return reply.code(res.error === 'not_found' ? 404 : 409).send(res);
    return res;
  });

  app.get('/pipelines/:id/deals', async (req, reply) => {
    const id = idOf(req.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const p = req.principal!;
    return withTenant(deps.db, p.tenantId, async (tx) => ({ data: (await tx.query(
      `SELECT d.id, d.stage_id, d.title, d.value_paise, d.status, d.position, d.owner_user_id, d.contact_id, d.updated_at,
              ct.name AS contact_name, ct.phone_e164 AS contact_phone, u.name AS owner_name
         FROM deals d LEFT JOIN contacts ct ON ct.id = d.contact_id LEFT JOIN users u ON u.id = d.owner_user_id
        WHERE d.pipeline_id = $1 AND d.status = 'open' AND ($2 <> 'agent' OR d.owner_user_id = $3 OR d.owner_user_id IS NULL)
        ORDER BY d.stage_id, d.position, d.created_at`, [id.data, p.role, p.userId])).rows }));
  });

  app.post('/deals', async (req, reply) => {
    const b = dealBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', issues: b.error.issues });
    const p = req.principal!, d = b.data;
    const res = await withTenant(deps.db, p.tenantId, async (tx) => {
      const pl = (await tx.query<{ stages: { id: string }[] }>('SELECT stages FROM pipelines WHERE id = $1', [d.pipelineId])).rows[0];
      if (!pl) return { error: 404, body: { error: 'pipeline_not_found' } };
      if (!pl.stages.some((s) => s.id === d.stageId)) return { error: 400, body: { error: 'unknown_stage' } };
      if (d.contactId && !(await tx.query('SELECT 1 FROM contacts WHERE id = $1', [d.contactId])).rowCount) return { error: 404, body: { error: 'contact_not_found' } };
      if (d.ownerUserId && !(await tx.query<{ ok: boolean }>('SELECT is_tenant_member($1) AS ok', [d.ownerUserId])).rows[0]?.ok) {
        return { error: 400, body: { error: 'not_a_team_member' } };
      }
      const pos = (await tx.query<{ p: number }>('SELECT coalesce(max(position), 0) + 1 AS p FROM deals WHERE pipeline_id = $1 AND stage_id = $2',
        [d.pipelineId, d.stageId])).rows[0]!.p;
      return { row: (await tx.query(
        `INSERT INTO deals (tenant_id, pipeline_id, stage_id, contact_id, title, value_paise, owner_user_id, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, stage_id, title, value_paise, status, position`,
        [p.tenantId, d.pipelineId, d.stageId, d.contactId, d.title, d.valuePaise, d.ownerUserId ?? (p.role === 'agent' ? p.userId : null), pos])).rows[0] };
    });
    if ('error' in res) return reply.code(res.error as number).send(res.body);
    return reply.code(201).send(res.row);
  });

  app.patch('/deals/:id', async (req, reply) => {
    const id = idOf(req.params);
    const b = dealPatch.safeParse(req.body);
    if (!id.success || !b.success) return reply.code(400).send({ error: 'invalid_body' });
    const p = req.principal!, d = b.data;
    const res = await withTenant(deps.db, p.tenantId, async (tx) => {
      const cur = (await tx.query<{ pipeline_id: string; owner_user_id: string | null; stages: { id: string }[] }>(
        `SELECT d.pipeline_id, d.owner_user_id, pl.stages FROM deals d JOIN pipelines pl ON pl.id = d.pipeline_id WHERE d.id = $1`, [id.data])).rows[0];
      if (!cur || (p.role === 'agent' && cur.owner_user_id && cur.owner_user_id !== p.userId)) return 404;
      if (d.stageId && !cur.stages.some((s) => s.id === d.stageId)) return 400;
      if (d.ownerUserId && !(await tx.query<{ ok: boolean }>('SELECT is_tenant_member($1) AS ok', [d.ownerUserId])).rows[0]?.ok) return 400;
      await tx.query(
        `UPDATE deals SET stage_id = coalesce($2, stage_id), position = coalesce($3, position), title = coalesce($4, title),
                value_paise = coalesce($5, value_paise), owner_user_id = CASE WHEN $6 THEN $7 ELSE owner_user_id END,
                status = coalesce($8, status), closed_at = CASE WHEN $8 IN ('won','lost') THEN now() WHEN $8 = 'open' THEN NULL ELSE closed_at END
          WHERE id = $1`,
        [id.data, d.stageId ?? null, d.position ?? null, d.title ?? null, d.valuePaise ?? null, d.ownerUserId !== undefined, d.ownerUserId ?? null, d.status ?? null]);
      return 200;
    });
    return res === 200 ? { ok: true } : reply.code(res).send({ error: res === 404 ? 'not_found' : 'invalid_request' });
  });

  app.get('/pipelines/:id/summary', managers, async (req, reply) => {
    const id = idOf(req.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    return withTenant(deps.db, req.principal!.tenantId, async (tx) => (await tx.query(
      `SELECT count(*) FILTER (WHERE status = 'open')::int AS open_deals,
              coalesce(sum(value_paise) FILTER (WHERE status = 'open'), 0)::bigint AS open_value_paise,
              count(*) FILTER (WHERE status = 'won' AND closed_at > now() - interval '30 days')::int AS won_30d,
              coalesce(sum(value_paise) FILTER (WHERE status = 'won' AND closed_at > now() - interval '30 days'), 0)::bigint AS won_value_30d_paise,
              count(*) FILTER (WHERE status = 'lost' AND closed_at > now() - interval '30 days')::int AS lost_30d
         FROM deals WHERE pipeline_id = $1`, [id.data])).rows[0]);
  });
};
