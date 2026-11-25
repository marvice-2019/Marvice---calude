import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { withTenant } from '../db.js';
import type { AppDeps } from '../app.js';

const phone = z.string().transform((v) => v.replace(/[^\d]/g, '')).pipe(z.string().regex(/^[1-9]\d{7,14}$/));

const createBody = z.object({
  phone,
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  optInSource: z.string().trim().max(120).optional(),
});

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const contactRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));

  app.get('/contacts', async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const { search, page, pageSize } = q.data;
    const like = search ? `%${search.replace(/[%_\\]/g, '\\$&')}%` : null;
    return withTenant(deps.db, req.principal!.tenantId, async (tx) => {
      const rows = await tx.query(
        `SELECT id, phone_e164 AS phone, name, email, status, opted_in_at, opted_out_at, created_at,
                count(*) OVER () AS total
           FROM contacts
          WHERE $1::text IS NULL OR name ILIKE $1 OR phone_e164 LIKE $1 OR email::text ILIKE $1
          ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [like, pageSize, (page - 1) * pageSize]);
      const total = rows.rows[0] ? Number(rows.rows[0].total) : 0;
      return { data: rows.rows.map(({ total: _t, ...r }) => r), page, pageSize, total };
    });
  });

  app.post('/contacts', async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    const { phone: p, name, email, optInSource } = body.data;
    const p0 = req.principal!;
    try {
      const row = await withTenant(deps.db, p0.tenantId, async (tx) => {
        const r = await tx.query(
          `INSERT INTO contacts (tenant_id, phone_e164, name, email, opted_in_at, opt_in_source)
           VALUES ($1, $2, $3, $4, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $5)
           RETURNING id, phone_e164 AS phone, name, email, status, opted_in_at, created_at`,
          [p0.tenantId, p, name ?? null, email ?? null, optInSource ?? null]);
        await tx.query(
          "INSERT INTO audit_logs (tenant_id, user_id, action, target) VALUES ($1, $2, 'contact.create', $3)",
          [p0.tenantId, p0.userId, r.rows[0].id]);
        return r.rows[0];
      });
      return reply.code(201).send(row);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'contact_exists' });
      throw err;
    }
  });
};
