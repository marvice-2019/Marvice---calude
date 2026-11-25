import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requirePlatformAdmin, signImpersonationToken, signPlatformToken, verifyPassword } from '../auth.js';
import { withPlatform, type Tx } from '../db.js';
import type { Deps } from '../app.js';

// Platform (super-admin) API. Everything here reads platform-wide with the owner connection
// (withPlatform), never by looping over tenants with withTenant.

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

const limitsSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/), z.number().int().min(0));

const planBody = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,59}$/),
  pricePaise: z.number().int().min(0),
  billingCycle: z.enum(['monthly', 'yearly']),
  limits: limitsSchema.default({}),
});

const planPatch = planBody.omit({ limits: true }).partial().extend({ limits: limitsSchema.optional() });

const tenantPatch = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  planId: z.string().uuid().nullable().optional(),
});

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

const tenantsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  ...page,
});

const auditQuery = z.object({
  tenantId: z.string().uuid().optional(),
  action: z.string().trim().max(100).optional(),
  ...page,
});

const uuid = z.string().uuid();

const PLAN_SELECT = `
  SELECT p.id, p.name, p.slug, p.price_paise, p.billing_cycle, p.is_active, p.created_at, p.updated_at,
         coalesce((SELECT jsonb_object_agg(l.resource, l.max_value) FROM plan_limits l WHERE l.plan_id = p.id),
                  '{}'::jsonb) AS limits,
         (SELECT count(*) FROM tenants t WHERE t.plan_id = p.id)::int AS tenant_count
    FROM plans p`;

async function replaceLimits(tx: Tx, planId: string, limits: Record<string, number>) {
  await tx.query('DELETE FROM plan_limits WHERE plan_id = $1', [planId]);
  const entries = Object.entries(limits);
  if (!entries.length) return;
  await tx.query(
    `INSERT INTO plan_limits (plan_id, resource, max_value)
     SELECT $1, r, v FROM unnest($2::text[], $3::int[]) AS x(r, v)`,
    [planId, entries.map(([r]) => r), entries.map(([, v]) => v)]);
}

const escapeLike = (s: string) => `%${s.replace(/[%_\\]/g, '\\$&')}%`;

export const adminRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  const limit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/admin/auth/login', limit, async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const { email, password } = body.data;
    const u = await withPlatform(deps.db, (tx) => tx.query<{ id: string; password_hash: string; is_platform_admin: boolean }>(
      'SELECT id, password_hash, is_platform_admin FROM users WHERE email = $1', [email]));
    const user = u.rows[0];
    // Same answer for unknown email, wrong password and non-admin, so none can be probed.
    if (!user || !(await verifyPassword(password, user.password_hash)) || !user.is_platform_admin) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    return { token: await signPlatformToken(user.id, deps.config.JWT_SECRET) };
  });

  await app.register(async (admin) => {
    admin.addHook('preHandler', requirePlatformAdmin(deps.config.JWT_SECRET, deps.db));

    // ---------- Plans ----------

    admin.get('/admin/plans', async () => {
      const r = await withPlatform(deps.db, (tx) => tx.query(`${PLAN_SELECT} ORDER BY p.price_paise, p.created_at`));
      return { data: r.rows };
    });

    admin.post('/admin/plans', async (req, reply) => {
      const body = planBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
      const b = body.data;
      try {
        const plan = await withPlatform(deps.db, async (tx) => {
          const p = await tx.query<{ id: string }>(
            `INSERT INTO plans (name, slug, price_paise, billing_cycle) VALUES ($1, $2, $3, $4) RETURNING id`,
            [b.name, b.slug, b.pricePaise, b.billingCycle]);
          const id = p.rows[0]!.id;
          await replaceLimits(tx, id, b.limits);
          return (await tx.query(`${PLAN_SELECT} WHERE p.id = $1`, [id])).rows[0];
        });
        return reply.code(201).send(plan);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'slug_taken' });
        throw err;
      }
    });

    admin.patch('/admin/plans/:id', async (req, reply) => {
      const id = uuid.safeParse((req.params as { id: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
      const body = planPatch.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
      const b = body.data;
      try {
        const plan = await withPlatform(deps.db, async (tx) => {
          const u = await tx.query(
            `UPDATE plans SET name = coalesce($2, name), slug = coalesce($3, slug),
                    price_paise = coalesce($4, price_paise), billing_cycle = coalesce($5, billing_cycle)
              WHERE id = $1 RETURNING id`,
            [id.data, b.name ?? null, b.slug ?? null, b.pricePaise ?? null, b.billingCycle ?? null]);
          if (!u.rowCount) return null;
          if (b.limits) await replaceLimits(tx, id.data, b.limits);
          return (await tx.query(`${PLAN_SELECT} WHERE p.id = $1`, [id.data])).rows[0];
        });
        if (!plan) return reply.code(404).send({ error: 'not_found' });
        return plan;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'slug_taken' });
        throw err;
      }
    });

    // Deactivates; plans are never deleted, so past tenants and invoices keep their reference.
    admin.delete('/admin/plans/:id', async (req, reply) => {
      const id = uuid.safeParse((req.params as { id: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
      const out = await withPlatform(deps.db, async (tx) => {
        // Row lock pairs with FOR SHARE in tenant PATCH, so no tenant joins the plan meanwhile.
        const p = await tx.query('SELECT id FROM plans WHERE id = $1 FOR UPDATE', [id.data]);
        if (!p.rowCount) return 'not_found';
        const used = await tx.query('SELECT 1 FROM tenants WHERE plan_id = $1 LIMIT 1', [id.data]);
        if (used.rowCount) return 'plan_in_use';
        await tx.query('UPDATE plans SET is_active = false WHERE id = $1', [id.data]);
        return 'ok';
      });
      if (out === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (out === 'plan_in_use') return reply.code(409).send({ error: 'plan_in_use' });
      return reply.code(204).send();
    });

    // ---------- Tenants ----------

    admin.get('/admin/tenants', async (req, reply) => {
      const q = tenantsQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
      const { search, status, page: pg, pageSize } = q.data;
      const r = await withPlatform(deps.db, (tx) => tx.query(
        `SELECT t.id, t.name, t.status, t.plan_id, p.name AS plan_name, o.email AS owner_email, t.created_at,
                (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id)::int AS contact_count,
                (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id)::int AS member_count,
                count(*) OVER () AS total
           FROM tenants t
           LEFT JOIN plans p ON p.id = t.plan_id
           LEFT JOIN LATERAL (
             SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) o ON true
          WHERE ($1::text IS NULL OR t.name ILIKE $1 OR o.email::text ILIKE $1)
            AND ($2::text IS NULL OR t.status = $2)
          ORDER BY t.created_at DESC LIMIT $3 OFFSET $4`,
        [search ? escapeLike(search) : null, status ?? null, pageSize, (pg - 1) * pageSize]));
      const total = r.rows[0] ? Number(r.rows[0].total) : 0;
      return { data: r.rows.map(({ total: _t, ...row }) => row), page: pg, pageSize, total };
    });

    admin.patch('/admin/tenants/:id', async (req, reply) => {
      const id = uuid.safeParse((req.params as { id: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
      const body = tenantPatch.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
      const b = body.data, adminId = req.platformAdmin!.userId;
      const out = await withPlatform(deps.db, async (tx) => {
        const cur = await tx.query<{ status: string; plan_id: string | null }>(
          'SELECT status, plan_id FROM tenants WHERE id = $1 FOR UPDATE', [id.data]);
        const t = cur.rows[0];
        if (!t) return 'not_found' as const;
        if (b.planId) {
          const p = await tx.query('SELECT 1 FROM plans WHERE id = $1 AND is_active FOR SHARE', [b.planId]);
          if (!p.rowCount) return 'plan_unavailable' as const;
        }
        const status = b.status ?? t.status;
        const planId = b.planId !== undefined ? b.planId : t.plan_id;
        const audit = (action: string, meta: object) => tx.query(
          'INSERT INTO audit_logs (tenant_id, user_id, action, target, meta) VALUES ($1::uuid, $2, $3, $1::text, $4)',
          [id.data, adminId, action, meta]);
        if (status !== t.status) {
          await audit(status === 'suspended' ? 'admin.tenant.suspend' : 'admin.tenant.reactivate', {});
        }
        if (planId !== t.plan_id) await audit('admin.tenant.plan_change', { from: t.plan_id, to: planId });
        const r = await tx.query('UPDATE tenants SET status = $2, plan_id = $3 WHERE id = $1 RETURNING id, name, status, plan_id',
          [id.data, status, planId]);
        return r.rows[0];
      });
      if (out === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (out === 'plan_unavailable') return reply.code(400).send({ error: 'plan_unavailable' });
      return out;
    });

    // Support "login as tenant": a 15-minute owner token that names the admin in `imp`.
    admin.post('/admin/tenants/:id/impersonate', async (req, reply) => {
      const id = uuid.safeParse((req.params as { id: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
      const adminId = req.platformAdmin!.userId;
      const owner = await withPlatform(deps.db, async (tx) => {
        const m = await tx.query<{ user_id: string }>(
          `SELECT user_id FROM memberships WHERE tenant_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1`, [id.data]);
        const o = m.rows[0];
        if (!o) return null;
        await tx.query(
          "INSERT INTO audit_logs (tenant_id, user_id, action, target) VALUES ($1, $2, 'admin.impersonate', $3)",
          [id.data, adminId, o.user_id]);
        return o.user_id;
      });
      if (!owner) return reply.code(404).send({ error: 'not_found' });
      const token = await signImpersonationToken({ userId: owner, tenantId: id.data, role: 'owner' }, adminId,
        deps.config.JWT_SECRET);
      return { token, tenantId: id.data, role: 'owner', expiresInSeconds: 15 * 60 };
    });

    // ---------- Stats and audit ----------

    admin.get('/admin/stats', async () => {
      const r = await withPlatform(deps.db, (tx) => tx.query(
        `SELECT (SELECT count(*) FILTER (WHERE status = 'active') FROM tenants)::int AS active,
                (SELECT count(*) FILTER (WHERE status = 'suspended') FROM tenants)::int AS suspended,
                (SELECT count(*) FROM tenants WHERE created_at > now() - interval '30 days')::int AS new_tenants,
                (SELECT count(*) FROM contacts)::int AS contacts,
                m.inbound, m.outbound
           FROM (SELECT count(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
                        count(*) FILTER (WHERE direction = 'outbound')::int AS outbound
                   FROM messages WHERE created_at > now() - interval '30 days') m`));
      const s = r.rows[0];
      return {
        tenants_by_status: { active: s.active, suspended: s.suspended },
        total_contacts: s.contacts,
        messages_last_30d: { inbound: s.inbound, outbound: s.outbound },
        new_tenants_last_30d: s.new_tenants,
      };
    });

    admin.get('/admin/audit-logs', async (req, reply) => {
      const q = auditQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
      const { tenantId, action, page: pg, pageSize } = q.data;
      const r = await withPlatform(deps.db, (tx) => tx.query(
        `SELECT a.id, a.tenant_id, t.name AS tenant_name, a.user_id, u.email AS user_email,
                a.action, a.target, a.meta, a.created_at, count(*) OVER () AS total
           FROM audit_logs a
           LEFT JOIN tenants t ON t.id = a.tenant_id
           LEFT JOIN users u ON u.id = a.user_id
          WHERE ($1::uuid IS NULL OR a.tenant_id = $1) AND ($2::text IS NULL OR a.action = $2)
          ORDER BY a.created_at DESC, a.id DESC LIMIT $3 OFFSET $4`,
        [tenantId ?? null, action ?? null, pageSize, (pg - 1) * pageSize]));
      const total = r.rows[0] ? Number(r.rows[0].total) : 0;
      return { data: r.rows.map(({ total: _t, ...row }) => row), page: pg, pageSize, total };
    });
  });
};
