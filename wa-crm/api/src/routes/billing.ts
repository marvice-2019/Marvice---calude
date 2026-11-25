import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth.js';
import { withPlatform, withTenant, type Db } from '../db.js';
import { financialYear, splitInclusive } from '../gst.js';
import type { Handler } from '../jobs.js';
import type { Deps } from '../app.js';

const RAZORPAY = 'https://api.razorpay.com/v1';
const subscribeBody = z.object({ planId: z.string().uuid() });

export function isValidRazorpaySignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !/^[0-9a-f]{64}$/i.test(header)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(Buffer.from(header, 'hex'), expected);
}

/** Authenticated billing routes (JSON bodies). */
export const billingRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', requireAuth(deps.config.JWT_SECRET));

  app.post('/billing/subscribe', { preHandler: requireRole('owner') }, async (req, reply) => {
    const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret } = deps.config;
    if (!keyId || !keySecret) return reply.code(503).send({ error: 'billing_not_configured' });
    const body = subscribeBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const p = req.principal!;
    const plan = (await deps.db.query<{ razorpay_plan_id: string | null }>(
      'SELECT razorpay_plan_id FROM plans WHERE id = $1 AND is_active', [body.data.planId])).rows[0];
    if (!plan?.razorpay_plan_id) return reply.code(400).send({ error: 'plan_not_purchasable' });

    const res = await deps.fetch(`${RAZORPAY}/subscriptions`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
        'content-type': 'application/json' },
      body: JSON.stringify({ plan_id: plan.razorpay_plan_id, total_count: 120, customer_notify: 1,
        notes: { tenant_id: p.tenantId } }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; status?: string; error?: unknown };
    if (!res.ok || !data.id) {
      req.log.error({ status: res.status, error: data.error }, 'razorpay subscribe failed');
      return reply.code(502).send({ error: 'payment_provider_error' });
    }
    await withTenant(deps.db, p.tenantId, (tx) => tx.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, razorpay_subscription_id, status, short_url)
       VALUES ($1, $2, $3, 'created', $4)`, [p.tenantId, body.data.planId, data.id, data.short_url ?? null]));
    return reply.code(201).send({ subscriptionId: data.id, shortUrl: data.short_url ?? null });
  });

  app.get('/billing/plans', async () => ({ data: (await deps.db.query(
    `SELECT p.id, p.name, p.price_paise, p.billing_cycle, (p.razorpay_plan_id IS NOT NULL) AS purchasable,
            coalesce((SELECT json_object_agg(resource, max_value) FROM plan_limits l WHERE l.plan_id = p.id), '{}') AS limits
       FROM plans p WHERE p.is_active ORDER BY p.price_paise`)).rows }));

  app.get('/billing/subscription', { preHandler: requireRole('owner', 'admin') }, async (req) =>
    withTenant(deps.db, req.principal!.tenantId, async (tx) => {
      const r = await tx.query(
        `SELECT s.id, s.status, s.current_period_start, s.current_period_end, s.short_url,
                pl.name AS plan_name, pl.price_paise, pl.billing_cycle
           FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
          ORDER BY s.created_at DESC LIMIT 1`);
      return { data: r.rows[0] ?? null };
    }));

  app.get('/billing/invoices', { preHandler: requireRole('owner', 'admin') }, async (req) =>
    withTenant(deps.db, req.principal!.tenantId, async (tx) => {
      const r = await tx.query(
        `SELECT id, number, period_start, period_end, taxable_paise, cgst_paise, sgst_paise, igst_paise,
                total_paise, place_of_supply_state, customer_gstin, status, issued_at
           FROM invoices ORDER BY issued_at DESC LIMIT 100`);
      return { data: r.rows };
    }));
};

type Entity = Record<string, unknown>;
const unix = (v: unknown) => (typeof v === 'number' && v > 0 ? new Date(v * 1000) : null);

/** Razorpay webhook (raw body for the signature). Separate plugin so the raw parser stays scoped here. */
export const razorpayWebhookRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 512 * 1024 }, (_r, body, done) => done(null, body));

  app.post('/webhooks/razorpay', async (req, reply) => {
    const secret = deps.config.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return reply.code(503).send({ error: 'billing_not_configured' });
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw) || !isValidRazorpaySignature(raw, req.headers['x-razorpay-signature'] as string | undefined, secret)) {
      return reply.code(401).send({ error: 'bad_signature' });
    }
    let evt: { event?: string; payload?: { subscription?: { entity?: Entity }; payment?: { entity?: Entity } } };
    try { evt = JSON.parse(raw.toString('utf8')); } catch { return reply.code(400).send({ error: 'bad_json' }); }

    const sub = evt.payload?.subscription?.entity;
    const rzpSubId = typeof sub?.id === 'string' ? sub.id : null;
    if (!rzpSubId) return reply.send({ ok: true, ignored: true });

    await withPlatform(deps.db, async (tx) => {
      // The tenant comes from our own subscription row, never from the event's notes.
      const s = (await tx.query<{ id: string; tenant_id: string }>(
        'SELECT id, tenant_id FROM subscriptions WHERE razorpay_subscription_id = $1 FOR UPDATE', [rzpSubId])).rows[0];
      if (!s) { req.log.warn({ rzpSubId }, 'razorpay webhook for unknown subscription'); return; }

      const status = typeof sub!.status === 'string' ? sub!.status : null;
      const allowed = ['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed'];
      await tx.query(
        `UPDATE subscriptions SET status = coalesce($2, status),
                current_period_start = coalesce($3, current_period_start),
                current_period_end = coalesce($4, current_period_end)
          WHERE id = $1`,
        [s.id, status && allowed.includes(status) ? status : null, unix(sub!.current_start), unix(sub!.current_end)]);

      if (evt.event === 'subscription.charged') {
        const pay = evt.payload?.payment?.entity;
        const paymentId = typeof pay?.id === 'string' ? pay.id : null;
        const amount = typeof pay?.amount === 'number' ? pay.amount : null;
        if (!paymentId || amount === null || !Number.isSafeInteger(amount)) return;
        const dup = await tx.query('SELECT 1 FROM invoices WHERE razorpay_payment_id = $1', [paymentId]);
        if (dup.rowCount) return;   // webhook replay

        const t = (await tx.query<{ state_code: string | null; gstin: string | null; billing_name: string | null; name: string }>(
          'SELECT state_code, gstin, billing_name, name FROM tenants WHERE id = $1', [s.tenant_id])).rows[0]!;
        const gst = splitInclusive(amount, deps.config.SUPPLIER_STATE_CODE, t.state_code);
        const issuedAt = unix(pay!.created_at) ?? new Date();
        const fy = financialYear(issuedAt);
        const n = (await tx.query<{ last_no: number }>(
          `INSERT INTO invoice_counters (fy, last_no) VALUES ($1, 1)
           ON CONFLICT (fy) DO UPDATE SET last_no = invoice_counters.last_no + 1 RETURNING last_no`, [fy])).rows[0]!.last_no;
        await tx.query(
          `INSERT INTO invoices (tenant_id, subscription_id, number, period_start, period_end, taxable_paise, cgst_paise,
                                 sgst_paise, igst_paise, total_paise, place_of_supply_state, customer_gstin, customer_name,
                                 razorpay_payment_id, issued_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [s.tenant_id, s.id, `MM/${fy}/${String(n).padStart(4, '0')}`, unix(sub!.current_start), unix(sub!.current_end),
           gst.taxablePaise, gst.cgstPaise, gst.sgstPaise, gst.igstPaise, gst.totalPaise, gst.placeOfSupply,
           t.gstin, t.billing_name ?? t.name, paymentId, issuedAt]);
        await tx.query("UPDATE tenants SET status = 'active' WHERE id = $1", [s.tenant_id]);
        await tx.query("INSERT INTO audit_logs (tenant_id, action, target) VALUES ($1, 'billing.charged', $2)", [s.tenant_id, paymentId]);
      }
    });
    return reply.send({ ok: true });
  });
};

/**
 * Job handler (queue 'billing.grace-check', run daily): suspends tenants whose latest subscription is
 * halted or pending and whose paid period ended more than `graceDays` ago.
 */
export function billingGraceCheck(db: Db, graceDays: number): Handler {
  return async () => {
    await db.query(
      `UPDATE tenants t SET status = 'suspended'
        WHERE t.status = 'active' AND EXISTS (
          SELECT 1 FROM (
            SELECT DISTINCT ON (tenant_id) tenant_id, status, current_period_end
              FROM subscriptions ORDER BY tenant_id, created_at DESC) s
           WHERE s.tenant_id = t.id AND s.status IN ('halted','pending')
             AND s.current_period_end + make_interval(days => $1) < now())`, [graceDays]);
  };
}
