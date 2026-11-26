import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { insertOrder, notifyStatus, type OrderItem } from '../commerce.js';
import { withTenant } from '../db.js';
import { requireActiveTenant } from '../limits.js';
import type { Deps } from '../app.js';

const productBody = z.object({
  retailerId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().default(null),
  pricePaise: z.number().int().min(0).max(1e12),
  currency: z.string().regex(/^[A-Z]{3}$/).default('INR'),
  imageUrl: z.string().url().startsWith('https://').nullable().default(null),
  stock: z.number().int().min(0).nullable().default(null),
  isActive: z.boolean().default(true),
});
const orderBody = z.object({
  contactId: z.string().uuid(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(10000) })).min(1).max(100),
  note: z.string().trim().max(2000).nullable().default(null),
});
const orderPatch = z.object({
  status: z.enum(['new', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled']).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  notify: z.boolean().default(false),
});
const listQuery = z.object({ status: z.enum(['new', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled']).optional(),
  search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1) });
const uuid = (p: unknown) => z.string().uuid().safeParse((p as { id?: string }).id);
const PAGE = 50;

export const commerceRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));
  app.addHook('preHandler', requireActiveTenant(deps.db));
  const managers = { preHandler: requireRole('owner', 'admin') };

  // ---------- products ----------
  app.get('/products', async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => ({ data: (await tx.query(
    `SELECT id, retailer_id, name, description, price_paise, currency, image_url, stock, is_active, source
       FROM products ORDER BY is_active DESC, name LIMIT 2000`)).rows })));

  app.post('/products', managers, async (req, reply) => {
    const b = productBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', issues: b.error.issues });
    const p = b.data, t = req.principal!.tenantId;
    const r = await withTenant(deps.db, t, (tx) => tx.query(
      `INSERT INTO products (tenant_id, retailer_id, name, description, price_paise, currency, image_url, stock, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tenant_id, retailer_id) DO NOTHING RETURNING id`,
      [t, p.retailerId, p.name, p.description, p.pricePaise, p.currency, p.imageUrl, p.stock, p.isActive]));
    if (!r.rowCount) return reply.code(409).send({ error: 'sku_in_use' });
    return reply.code(201).send(r.rows[0]);
  });

  app.put('/products/:id', managers, async (req, reply) => {
    const id = uuid(req.params), b = productBody.safeParse(req.body);
    if (!id.success || !b.success) return reply.code(400).send({ error: 'invalid_body' });
    const p = b.data;
    try {
      const r = await withTenant(deps.db, req.principal!.tenantId, (tx) => tx.query(
        `UPDATE products SET retailer_id = $2, name = $3, description = $4, price_paise = $5, currency = $6, image_url = $7, stock = $8, is_active = $9
          WHERE id = $1`, [id.data, p.retailerId, p.name, p.description, p.pricePaise, p.currency, p.imageUrl, p.stock, p.isActive]));
      if (!r.rowCount) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'sku_in_use' });
      throw err;
    }
  });

  // ---------- orders ----------
  app.get('/orders', async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const { status, search, page } = q.data;
    return withTenant(deps.db, req.principal!.tenantId, async (tx) => {
      const where = ['($1::text IS NULL OR o.status = $1)',
        "($2::text IS NULL OR c.phone_e164 LIKE '%' || $2 || '%' OR c.name ILIKE '%' || $2 || '%' OR o.number::text = $2)"];
      const rows = (await tx.query(
        `SELECT o.id, o.number, o.status, o.items, o.subtotal_paise, o.currency, o.note, o.source, o.created_at, o.conversation_id,
                c.id AS contact_id, c.name AS contact_name, c.phone_e164 AS contact_phone
           FROM orders o JOIN contacts c ON c.id = o.contact_id
          WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT ${PAGE + 1} OFFSET $3`,
        [status ?? null, search ? search.replace(/[%_\\]/g, '') : null, (page - 1) * PAGE])).rows;
      return { data: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
    });
  });

  app.get('/orders/summary', async (req) => withTenant(deps.db, req.principal!.tenantId, async (tx) => (await tx.query(
    `SELECT count(*) FILTER (WHERE status = 'new')::int AS new_orders,
            count(*) FILTER (WHERE status IN ('confirmed','paid','shipped'))::int AS in_progress,
            COALESCE(sum(subtotal_paise) FILTER (WHERE status <> 'cancelled' AND created_at > now() - interval '30 days'), 0)::bigint AS value_30d_paise,
            count(*) FILTER (WHERE status <> 'cancelled' AND created_at > now() - interval '30 days')::int AS orders_30d
       FROM orders`)).rows[0]));

  app.post('/orders', async (req, reply) => {
    const b = orderBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_body', issues: b.error.issues });
    const p = req.principal!;
    const out = await withTenant(deps.db, p.tenantId, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM contacts WHERE id = $1', [b.data.contactId])).rowCount) return { error: 'contact_not_found' as const };
      const products = new Map((await tx.query<{ id: string; retailer_id: string; name: string; price_paise: string; currency: string; is_active: boolean }>(
        'SELECT id, retailer_id, name, price_paise, currency, is_active FROM products WHERE id = ANY($1)', [b.data.items.map((i) => i.productId)])).rows.map((r) => [r.id, r]));
      const items: OrderItem[] = [];
      for (const i of b.data.items) {
        const pr = products.get(i.productId);
        if (!pr?.is_active) return { error: 'product_unavailable' as const, productId: i.productId };
        items.push({ retailerId: pr.retailer_id, productId: pr.id, name: pr.name, quantity: i.quantity, unitPaise: Number(pr.price_paise), totalPaise: Number(pr.price_paise) * i.quantity });
      }
      const currencies = new Set([...products.values()].map((x) => x.currency));
      if (currencies.size > 1) return { error: 'mixed_currencies' as const };
      return { order: await insertOrder(tx, p.tenantId, { contactId: b.data.contactId, items, currency: [...currencies][0]!, note: b.data.note,
        source: req.headers['x-api-key'] ? 'api' : 'manual', createdBy: p.userId }) };
    });
    if ('error' in out) return reply.code(out.error === 'contact_not_found' ? 404 : 409).send(out);
    return reply.code(201).send(out.order);
  });

  app.patch('/orders/:id', async (req, reply) => {
    const id = uuid(req.params), b = orderPatch.safeParse(req.body);
    if (!id.success || !b.success) return reply.code(400).send({ error: 'invalid_body' });
    const tenantId = req.principal!.tenantId;
    const r = await withTenant(deps.db, tenantId, (tx) => tx.query<{ id: string; status: string; changed: boolean }>(
      `UPDATE orders o SET status = COALESCE($2, o.status), note = CASE WHEN $3::boolean THEN $4 ELSE o.note END
         FROM (SELECT status AS before FROM orders WHERE id = $1) prev
        WHERE o.id = $1 RETURNING o.id, o.status, (o.status IS DISTINCT FROM prev.before) AS changed`,
      [id.data, b.data.status ?? null, b.data.note !== undefined, b.data.note ?? null]));
    const row = r.rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });
    // Only a real status change is announced, so a repeated click never messages the customer twice.
    const notified = b.data.notify && row.changed ? await notifyStatus(deps, tenantId, row.id, row.status) : { sent: false };
    return { id: row.id, status: row.status, notified };
  });
};
