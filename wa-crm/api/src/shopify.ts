import type { Deps } from './app.js';
import { decryptSecret } from './crypto.js';
import { withPlatform, withTenant } from './db.js';
import { enqueue, PermanentJobError, type Handler } from './jobs.js';
import type { FetchLike } from './meta.js';

// Shopify Admin GraphQL API with a custom-app access token (shpat_...). Needs the read_products and
// read_inventory scopes. Shopify answers an unsupported version with the oldest supported one.
export const SHOPIFY_QUEUE = 'shopify.sync';
export const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const PAGE = 250;
const MAX_PAGES = 80;   // 20,000 variants per sync

export class ShopifyError extends Error { constructor(message: string, public status = 0) { super(message); } }

async function gql<T>(fetchFn: FetchLike, version: string, shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!SHOP_DOMAIN.test(shop)) throw new ShopifyError('invalid shop domain');
  const res = await fetchFn(`https://${shop}/admin/api/${version}/graphql.json`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': token }, body: JSON.stringify({ query, variables }) });
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: unknown };
  if (res.status === 401 || res.status === 403) throw new ShopifyError('Shopify refused the access token (check it and the read_products scope)', res.status);
  if (!res.ok || !body.data) throw new ShopifyError(`Shopify error ${res.status}: ${JSON.stringify(body.errors ?? {}).slice(0, 300)}`, res.status);
  return body.data;
}

export async function shopInfo(fetchFn: FetchLike, version: string, shop: string, token: string) {
  const d = await gql<{ shop: { name: string; currencyCode: string } }>(fetchFn, version, shop, token, '{ shop { name currencyCode } }');
  return d.shop;
}

const VARIANTS = `query($after: String) {
  productVariants(first: ${PAGE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id sku title price inventoryQuantity
      product { title status description featuredImage { url } } }
  }
}`;
interface Variant { id: string; sku: string | null; title: string; price: string; inventoryQuantity: number | null;
  product: { title: string; status: string; description: string | null; featuredImage: { url: string } | null } }

/** Pulls every variant and upserts it as a product. Shopify is the source of truth for the SKUs it owns. */
export async function syncShop(deps: Deps, tenantId: string) {
  const conn = await withTenant(deps.db, tenantId, async (tx) => (await tx.query<{ shop_domain: string; token_enc: string; currency: string | null }>(
    'SELECT shop_domain, token_enc, currency FROM shopify_connections')).rows[0]);
  if (!conn) return null;
  const token = decryptSecret(conn.token_enc, deps.config.TOKEN_ENCRYPTION_KEY);
  const variants: Variant[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const d: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Variant[] } } =
      await gql(deps.fetch, deps.config.SHOPIFY_API_VERSION, conn.shop_domain, token, VARIANTS, { after });
    variants.push(...d.productVariants.nodes);
    if (!d.productVariants.pageInfo.hasNextPage) break;
    after = d.productVariants.pageInfo.endCursor;
  }
  const currency = /^[A-Z]{3}$/.test(conn.currency ?? '') ? conn.currency! : 'INR';
  return withTenant(deps.db, tenantId, async (tx) => {
    let created = 0, updated = 0;
    const seen: string[] = [];
    for (const v of variants) {
      const numericId = v.id.split('/').pop();
      const retailerId = (v.sku?.trim() || `shopify-${numericId}`).slice(0, 100);
      if (seen.includes(retailerId)) continue;   // the same SKU on two variants: keep the first
      seen.push(retailerId);
      const name = (v.title && v.title !== 'Default Title' ? `${v.product.title} – ${v.title}` : v.product.title).slice(0, 200);
      const pricePaise = Math.max(0, Math.round(Number(v.price) * 100) || 0);
      const image = v.product.featuredImage?.url?.startsWith('https://') ? v.product.featuredImage.url : null;
      const r = await tx.query<{ inserted: boolean }>(
        `INSERT INTO products (tenant_id, retailer_id, name, description, price_paise, currency, image_url, stock, is_active, source, external_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'shopify', $10)
         ON CONFLICT (tenant_id, retailer_id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
           price_paise = EXCLUDED.price_paise, currency = EXCLUDED.currency, image_url = EXCLUDED.image_url, stock = EXCLUDED.stock,
           is_active = EXCLUDED.is_active, source = 'shopify', external_id = EXCLUDED.external_id
         RETURNING (xmax = 0) AS inserted`,
        [tenantId, retailerId, name, v.product.description?.slice(0, 5000) || null, pricePaise, currency, image,
          v.inventoryQuantity == null ? null : Math.max(0, v.inventoryQuantity), v.product.status === 'ACTIVE', v.id]);
      if (r.rows[0]!.inserted) created++; else updated++;
    }
    // Synced earlier but gone from the store (deleted, or SKU changed): hide, never delete, so old orders keep their link.
    const hidden = (await tx.query("UPDATE products SET is_active = false WHERE source = 'shopify' AND is_active AND NOT (retailer_id = ANY($1))", [seen])).rowCount ?? 0;
    const result = { ok: true, created, updated, hidden };
    await tx.query('UPDATE shopify_connections SET last_synced_at = now(), last_result = $1', [JSON.stringify(result)]);
    return result;
  });
}

export function shopifySyncHandler(deps: Deps): Handler {
  return async (job) => {
    const tenantId = job.tenant_id;
    if (!tenantId) throw new PermanentJobError('no tenant');
    try {
      await syncShop(deps, tenantId);
    } catch (err) {
      if (!(err instanceof ShopifyError)) throw err;
      // Record the reason for the owner; a refused token will not fix itself, so do not retry.
      await withTenant(deps.db, tenantId, (tx) => tx.query('UPDATE shopify_connections SET last_result = $1',
        [JSON.stringify({ ok: false, error: err.message })]));
      if (err.status === 401 || err.status === 403) throw new PermanentJobError(err.message);
      throw err;
    }
  };
}

/** Daily sync for every connected store (called from the worker's hourly tick; the day in the key keeps it to once a day). */
export async function scheduleDailyShopifySync(deps: Deps) {
  const day = new Date().toISOString().slice(0, 10);
  const tenants = await withPlatform(deps.db, async (tx) => (await tx.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM shopify_connections WHERE last_synced_at IS NULL OR last_synced_at < now() - interval '20 hours'")).rows);
  for (const t of tenants) await enqueue(deps.db, SHOPIFY_QUEUE, {}, { tenantId: t.tenant_id, dedupeKey: `shopify:${t.tenant_id}:${day}` });
}
