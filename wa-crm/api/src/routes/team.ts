import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashPassword, requireAuth, requireRole } from '../auth.js';
import { withPlatform, withTenant } from '../db.js';
import { assertWithinLimit, requireActiveTenant } from '../limits.js';
import type { Deps } from '../app.js';

const uuid = z.string().uuid();
const idParam = (req: FastifyRequest) => uuid.safeParse((req.params as { id?: string }).id);

const teamCreate = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['admin', 'agent']),
  password: z.string().min(10).max(200),
});

/** Assignment, notes, tags and team members. */
export const teamRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const managers = { preHandler: requireRole('owner', 'admin') };

  // ---------- conversations ----------

  app.patch('/conversations/:id/assign', managers, async (req, reply) => {
    const id = idParam(req);
    const body = z.object({ userId: uuid.nullable() }).safeParse(req.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    const p = req.principal!, userId = body.data.userId;
    const res = await withTenant(deps.db, p.tenantId, async (tx) => {
      if (userId && !(await tx.query<{ ok: boolean }>('SELECT is_tenant_member($1) AS ok', [userId])).rows[0]?.ok) return 'not_member';
      const r = await tx.query('UPDATE conversations SET assigned_user_id = $2 WHERE id = $1 RETURNING id', [id.data, userId]);
      return r.rowCount ? 'ok' : 'not_found';
    });
    if (res === 'not_member') return reply.code(400).send({ error: 'not_a_team_member' });
    if (res === 'not_found') return reply.code(404).send({ error: 'not_found' });
    deps.realtime.conversation(p.tenantId, userId, 'conversation.assigned', { conversationId: id.data, userId });
    return { ok: true };
  });

  // Agents pick up unassigned chats themselves.
  app.post('/conversations/:id/claim', async (req, reply) => {
    const id = idParam(req);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const p = req.principal!;
    const r = await withTenant(deps.db, p.tenantId, (tx) => tx.query(
      'UPDATE conversations SET assigned_user_id = $2 WHERE id = $1 AND assigned_user_id IS NULL RETURNING id', [id.data, p.userId]));
    if (!r.rowCount) return reply.code(409).send({ error: 'already_assigned_or_missing' });
    deps.realtime.conversation(p.tenantId, p.userId, 'conversation.assigned', { conversationId: id.data, userId: p.userId });
    return { ok: true };
  });

  app.patch('/conversations/:id/status', async (req, reply) => {
    const id = idParam(req);
    const body = z.object({ status: z.enum(['open', 'closed']) }).safeParse(req.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    const p = req.principal!;
    const r = await withTenant(deps.db, p.tenantId, (tx) => tx.query<{ assigned_user_id: string | null }>(
      `UPDATE conversations SET status = $2 WHERE id = $1 AND ($3 <> 'agent' OR assigned_user_id = $4) RETURNING assigned_user_id`,
      [id.data, body.data.status, p.role, p.userId]));
    if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
    deps.realtime.conversation(p.tenantId, r.rows[0]!.assigned_user_id, 'conversation.status', { conversationId: id.data, status: body.data.status });
    return { ok: true };
  });

  const visibleConversation = `SELECT 1 FROM conversations WHERE id = $1 AND ($2 <> 'agent' OR assigned_user_id = $3)`;

  app.get('/conversations/:id/notes', async (req, reply) => {
    const id = idParam(req);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const p = req.principal!;
    const out = await withTenant(deps.db, p.tenantId, async (tx) => {
      if (!(await tx.query(visibleConversation, [id.data, p.role, p.userId])).rowCount) return null;
      return (await tx.query(
        `SELECT n.id, n.body, n.created_at, n.user_id, u.name AS user_name
           FROM conversation_notes n LEFT JOIN users u ON u.id = n.user_id
          WHERE n.conversation_id = $1 ORDER BY n.created_at`, [id.data])).rows;
    });
    return out ? { data: out } : reply.code(404).send({ error: 'not_found' });
  });

  app.post('/conversations/:id/notes', async (req, reply) => {
    const id = idParam(req);
    const body = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    const p = req.principal!;
    const note = await withTenant(deps.db, p.tenantId, async (tx) => {
      if (!(await tx.query(visibleConversation, [id.data, p.role, p.userId])).rowCount) return null;
      return (await tx.query(
        `INSERT INTO conversation_notes (tenant_id, conversation_id, user_id, body) VALUES ($1, $2, $3, $4)
         RETURNING id, body, created_at, user_id`, [p.tenantId, id.data, p.userId, body.data.body])).rows[0];
    });
    return note ? reply.code(201).send(note) : reply.code(404).send({ error: 'not_found' });
  });

  // ---------- tags ----------

  app.get('/tags', async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => ({ data: (await tx.query(
    `SELECT t.id, t.label, t.color, count(ct.contact_id)::int AS contact_count
       FROM tags t LEFT JOIN contact_tags ct ON ct.tag_id = t.id GROUP BY t.id ORDER BY lower(t.label)`)).rows })));

  app.post('/tags', managers, async (req, reply) => {
    const body = z.object({ label: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const p = req.principal!;
    try {
      const row = await withTenant(deps.db, p.tenantId, async (tx) => (await tx.query(
        `INSERT INTO tags (tenant_id, label, color) VALUES ($1, $2, coalesce($3, '#64748b')) RETURNING id, label, color`,
        [p.tenantId, body.data.label, body.data.color ?? null])).rows[0]);
      return reply.code(201).send(row);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'tag_exists' });
      throw err;
    }
  });

  app.delete('/tags/:id', managers, async (req, reply) => {
    const id = idParam(req);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const r = await withTenant(deps.db, req.principal!.tenantId, (tx) => tx.query('DELETE FROM tags WHERE id = $1', [id.data]));
    return r.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });

  // Replaces the contact's tag set. Tags and contact must both belong to this tenant (RLS hides others → 404).
  app.put('/contacts/:id/tags', async (req, reply) => {
    const id = idParam(req);
    const body = z.object({ tagIds: z.array(uuid).max(50) }).safeParse(req.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    const p = req.principal!, tagIds = [...new Set(body.data.tagIds)];
    const res = await withTenant(deps.db, p.tenantId, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM contacts WHERE id = $1', [id.data])).rowCount) return 'no_contact';
      const found = await tx.query('SELECT id FROM tags WHERE id = ANY($1)', [tagIds]);
      if (found.rowCount !== tagIds.length) return 'no_tag';
      await tx.query('DELETE FROM contact_tags WHERE contact_id = $1', [id.data]);
      if (tagIds.length) {
        await tx.query(`INSERT INTO contact_tags (tenant_id, contact_id, tag_id) SELECT $1, $2, unnest($3::uuid[])`,
          [p.tenantId, id.data, tagIds]);
      }
      return 'ok';
    });
    if (res !== 'ok') return reply.code(404).send({ error: res === 'no_contact' ? 'not_found' : 'tag_not_found' });
    return { ok: true, tagIds };
  });

  // ---------- team ----------
  // users and memberships are platform tables: always scoped by the caller's tenant from the token.

  app.get('/team', managers, async (req) => {
    const t = req.principal!.tenantId;
    const r = await withPlatform(deps.db, (tx) => tx.query(
      `SELECT u.id, u.name, u.email, m.role, m.created_at,
              (SELECT count(*)::int FROM conversations c
                WHERE c.tenant_id = m.tenant_id AND c.assigned_user_id = u.id AND c.status = 'open') AS open_conversations
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1 ORDER BY m.created_at`, [t]));
    return { data: r.rows };
  });

  app.post('/team', managers, async (req, reply) => {
    const body = teamCreate.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const p = req.principal!, b = body.data;
    await withTenant(deps.db, p.tenantId, (tx) => assertWithinLimit(tx, 'agents'));
    const hash = await hashPassword(b.password);
    const res = await withPlatform(deps.db, async (tx) => {
      // An existing account (e.g. someone in two businesses) is attached; their password is not changed.
      const u = await tx.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET email = users.email RETURNING id`, [b.email, b.name, hash]);
      const userId = u.rows[0]!.id;
      const m = await tx.query(
        'INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_id',
        [p.tenantId, userId, b.role]);
      if (!m.rowCount) return null;
      await tx.query("INSERT INTO audit_logs (tenant_id, user_id, action, target) VALUES ($1, $2, 'team.add', $3)",
        [p.tenantId, p.userId, userId]);
      return userId;
    });
    if (!res) return reply.code(409).send({ error: 'already_a_member' });
    return reply.code(201).send({ id: res, name: b.name, email: b.email, role: b.role });
  });

  app.patch('/team/:id', { preHandler: requireRole('owner') }, async (req, reply) => {
    const id = idParam(req);
    const body = z.object({ role: z.enum(['admin', 'agent']) }).safeParse(req.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'invalid_request' });
    const r = await withPlatform(deps.db, (tx) => tx.query(
      "UPDATE memberships SET role = $3 WHERE tenant_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING user_id",
      [req.principal!.tenantId, id.data, body.data.role]));
    return r.rowCount ? { ok: true } : reply.code(404).send({ error: 'not_found_or_owner' });
  });

  app.delete('/team/:id', managers, async (req, reply) => {
    const id = idParam(req);
    if (!id.success) return reply.code(400).send({ error: 'invalid_id' });
    const p = req.principal!;
    const removed = await withPlatform(deps.db, async (tx) => {
      const r = await tx.query("DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING user_id",
        [p.tenantId, id.data]);
      if (!r.rowCount) return false;
      await tx.query('UPDATE conversations SET assigned_user_id = NULL WHERE tenant_id = $1 AND assigned_user_id = $2', [p.tenantId, id.data]);
      await tx.query("INSERT INTO audit_logs (tenant_id, user_id, action, target) VALUES ($1, $2, 'team.remove', $3)",
        [p.tenantId, p.userId, id.data]);
      return true;
    });
    return removed ? reply.code(204).send() : reply.code(404).send({ error: 'not_found_or_owner' });
  });

  app.patch('/settings/inbox', managers, async (req, reply) => {
    const body = z.object({ autoAssign: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    await withPlatform(deps.db, (tx) => tx.query('UPDATE tenants SET auto_assign = $2 WHERE id = $1',
      [req.principal!.tenantId, body.data.autoAssign]));
    return { ok: true, autoAssign: body.data.autoAssign };
  });
};
