import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { hashPassword, signToken, verifyPassword, type Role } from '../auth.js';
import { withPlatform } from '../db.js';
import type { Deps } from '../app.js';

const signupBody = z.object({
  businessName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10).max(200),
});

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
  tenantId: z.string().uuid().optional(),
});

export const authRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  const limit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/signup', limit, async (req, reply) => {
    const body = signupBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    const { businessName, name, email, password } = body.data;
    const hash = await hashPassword(password);
    try {
      const out = await withPlatform(deps.db, async (tx) => {
        const t = await tx.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [businessName]);
        const u = await tx.query<{ id: string }>(
          'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [email, name, hash]);
        const tenantId = t.rows[0]!.id, userId = u.rows[0]!.id;
        await tx.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, userId]);
        await tx.query("INSERT INTO audit_logs (tenant_id, user_id, action) VALUES ($1, $2, 'tenant.signup')", [tenantId, userId]);
        return { tenantId, userId };
      });
      const token = await signToken({ ...out, role: 'owner' }, deps.config.JWT_SECRET);
      return reply.code(201).send({ token, tenantId: out.tenantId, role: 'owner' });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'email_taken' });
      throw err;
    }
  });

  app.post('/auth/login', limit, async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const { email, password, tenantId } = body.data;
    const row = await withPlatform(deps.db, async (tx) => {
      const u = await tx.query<{ id: string; password_hash: string }>(
        'SELECT id, password_hash FROM users WHERE email = $1', [email]);
      const user = u.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) return null;
      const m = await tx.query<{ tenant_id: string; role: Role }>(
        `SELECT tenant_id, role FROM memberships WHERE user_id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)
         ORDER BY created_at LIMIT 1`, [user.id, tenantId ?? null]);
      return m.rows[0] ? { userId: user.id, tenantId: m.rows[0].tenant_id, role: m.rows[0].role } : null;
    });
    // Same answer for unknown email and wrong password, so emails can't be probed.
    if (!row) return reply.code(401).send({ error: 'invalid_credentials' });
    const token = await signToken(row, deps.config.JWT_SECRET);
    return { token, tenantId: row.tenantId, role: row.role };
  });
};
