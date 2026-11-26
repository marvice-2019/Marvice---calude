import type { Deps } from './app.js';
import { decryptSecret } from './crypto.js';
import { withTenant, type Tx } from './db.js';
import { queueEvent } from './integrations.js';
import { sendText } from './meta.js';

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface OrderItem { retailerId: string; productId: string | null; name: string; quantity: number; unitPaise: number; totalPaise: number }

export const STATUS_TEXT: Record<string, string> = {
  confirmed: 'Your order #{n} is confirmed. We will update you when it ships.',
  paid: 'Payment received for order #{n}. Thank you!',
  shipped: 'Good news: order #{n} has been shipped.',
  delivered: 'Order #{n} has been delivered. We hope you love it!',
  cancelled: 'Order #{n} has been cancelled. Reply here if you have any questions.',
};

async function nextNumber(tx: Tx, tenantId: string): Promise<number> {
  return (await tx.query<{ last_no: number }>(
    `INSERT INTO order_counters (tenant_id, last_no) VALUES ($1, 1001)
     ON CONFLICT (tenant_id) DO UPDATE SET last_no = order_counters.last_no + 1 RETURNING last_no`, [tenantId])).rows[0]!.last_no;
}

export async function insertOrder(tx: Tx, tenantId: string, o: { contactId: string; conversationId?: string | null; items: OrderItem[];
  currency: string; note?: string | null; source: 'whatsapp' | 'manual' | 'api'; waMessageId?: string | null; catalogId?: string | null;
  createdBy?: string | null }) {
  const subtotal = o.items.reduce((a, i) => a + i.totalPaise, 0);
  const row = (await tx.query<{ id: string; number: number; status: string; subtotal_paise: string; created_at: Date }>(
    `INSERT INTO orders (tenant_id, number, contact_id, conversation_id, items, subtotal_paise, currency, note, source, wa_message_id, catalog_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, number, status, subtotal_paise, created_at`,
    [tenantId, await nextNumber(tx, tenantId), o.contactId, o.conversationId ?? null, JSON.stringify(o.items), subtotal, o.currency,
      o.note ?? null, o.source, o.waMessageId ?? null, o.catalogId ?? null, o.createdBy ?? null])).rows[0]!;
  await queueEvent(tx, tenantId, 'order.created', { orderId: row.id, number: row.number, source: o.source, subtotalPaise: subtotal,
    currency: o.currency, items: o.items });
  return row;
}

/** A WhatsApp cart message ("order" type) → an order. Prices come from the cart the customer saw; names from our catalog when known. */
export async function orderFromCart(tx: Tx, tenantId: string, contactId: string, conversationId: string, waMessageId: string, raw: unknown) {
  const order = (raw as { order?: { catalog_id?: string; text?: string; product_items?: unknown[] } }).order;
  const lines = (order?.product_items ?? []).map((p) => p as { product_retailer_id?: string; quantity?: number | string; item_price?: number | string; currency?: string })
    .filter((p) => p.product_retailer_id && Number(p.quantity) > 0);
  if (!lines.length) return null;
  const known = new Map((await tx.query<{ id: string; retailer_id: string; name: string }>(
    'SELECT id, retailer_id, name FROM products WHERE retailer_id = ANY($1)', [lines.map((l) => l.product_retailer_id)])).rows.map((r) => [r.retailer_id, r]));
  const items: OrderItem[] = lines.map((l) => {
    const p = known.get(l.product_retailer_id!);
    const quantity = Math.min(Math.trunc(Number(l.quantity)), 10000);
    const unitPaise = Math.max(0, Math.round(Number(l.item_price ?? 0) * 100));
    return { retailerId: l.product_retailer_id!, productId: p?.id ?? null, name: p?.name ?? l.product_retailer_id!, quantity, unitPaise, totalPaise: unitPaise * quantity };
  });
  const currency = /^[A-Z]{3}$/.test(lines[0]!.currency ?? '') ? lines[0]!.currency! : 'INR';
  return insertOrder(tx, tenantId, { contactId, conversationId, items, currency, note: order?.text?.slice(0, 2000) ?? null,
    source: 'whatsapp', waMessageId, catalogId: order?.catalog_id ?? null });
}

/** Tells the customer about a status change, as text, while the 24-hour window is open. */
export async function notifyStatus(deps: Deps, tenantId: string, orderId: string, status: string): Promise<{ sent: boolean; reason?: string }> {
  const template = STATUS_TEXT[status];
  if (!template) return { sent: false, reason: 'no_message_for_status' };
  const ctx = await withTenant(deps.db, tenantId, async (tx) => (await tx.query<{ number: number; phone: string; conv: string | null;
    last_inbound_at: Date | null; meta_pn: string | null; token: string | null }>(
    `SELECT o.number, c.phone_e164 AS phone, cv.id AS conv, cv.last_inbound_at, pn.meta_phone_number_id AS meta_pn, w.access_token_enc AS token
       FROM orders o JOIN contacts c ON c.id = o.contact_id
       LEFT JOIN LATERAL (SELECT * FROM conversations x WHERE x.contact_id = o.contact_id ORDER BY x.last_message_at DESC NULLS LAST LIMIT 1) cv ON true
       LEFT JOIN phone_numbers pn ON pn.id = cv.phone_number_id LEFT JOIN waba_accounts w ON w.id = pn.waba_account_id
      WHERE o.id = $1`, [orderId])).rows[0]);
  if (!ctx?.conv || !ctx.meta_pn || !ctx.token) return { sent: false, reason: 'no_conversation' };
  if (!ctx.last_inbound_at || Date.now() - ctx.last_inbound_at.getTime() > SERVICE_WINDOW_MS) return { sent: false, reason: 'outside_service_window' };
  const body = template.replace('{n}', String(ctx.number));
  const wamid = await sendText(deps.fetch, deps.config.META_GRAPH_VERSION, ctx.meta_pn, decryptSecret(ctx.token, deps.config.TOKEN_ENCRYPTION_KEY), ctx.phone, body);
  await withTenant(deps.db, tenantId, async (tx) => {
    await tx.query(`INSERT INTO messages (tenant_id, conversation_id, direction, type, body, wa_message_id, status)
                    VALUES ($1, $2, 'outbound', 'text', $3, $4, 'sent')`, [tenantId, ctx.conv, body, wamid]);
    await tx.query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [ctx.conv]);
  });
  return { sent: true };
}
