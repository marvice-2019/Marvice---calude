import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { withTenant } from '../src/db.js';
import { noopRealtime } from '../src/realtime.js';
import { shopifySyncHandler, SHOPIFY_QUEUE } from '../src/shopify.js';
import { setup, signup, bearer, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let owner: { token: string; tenantId: string };
const TOKEN = 'shpat_fake_for_tests_only_not_hex_xyz';   // not hex, so secret scanners do not mistake it for a real one

before(async () => {
  ctx = await setup();
  owner = await signup(ctx.app, 'shopify@example.com');
});
after(async () => { await ctx.close(); });

const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(owner.token), ...(payload ? { payload } : {}) });

type V = { id: string; sku: string | null; title: string; price: string; inventoryQuantity: number | null; product: { title: string; status: string; description: string; featuredImage: { url: string } | null } };
const v = (n: number, sku: string | null, title: string, price: string, status = 'ACTIVE', qty: number | null = 5): V =>
  ({ id: `gid://shopify/ProductVariant/${n}`, sku, title, price, inventoryQuantity: qty, product: { title: `Product ${n}`, status, description: 'Soft cotton', featuredImage: { url: `https://cdn.shopify.com/${n}.jpg` } } });

/** A fake store: answers the shop query and pages variants two at a time, checking the access token header. */
function store(variants: V[], token = TOKEN) {
  return (url: string) => {
    const last = ctx.sent.at(-1)!;
    if (!url.startsWith('https://lakshmi-silks.myshopify.com/admin/api/')) return { ok: false, status: 404, body: {} };
    if (last.headers['x-shopify-access-token'] !== token) return { ok: false, status: 401, body: { errors: '[API] Invalid API key or access token' } };
    const q = last.body as { query: string; variables: { after?: string | null } };
    if (q.query.includes('shop {')) return { ok: true, status: 200, body: { data: { shop: { name: 'Lakshmi Silks', currencyCode: 'INR' } } } };
    const start = q.variables.after ? Number(q.variables.after) : 0;
    const nodes = variants.slice(start, start + 2);
    return { ok: true, status: 200, body: { data: { productVariants: { nodes,
      pageInfo: { hasNextPage: start + 2 < variants.length, endCursor: String(start + 2) } } } } };
  };
}
const runSync = () => shopifySyncHandler({ config: ctx.config, db: ctx.db, fetch: ctx.fetch, realtime: noopRealtime })(
  { id: 's', queue: SHOPIFY_QUEUE, tenant_id: owner.tenantId, payload: {}, attempts: 1, max_attempts: 5 });
const products = () => withTenant(ctx.db, owner.tenantId, async (tx) => (await tx.query<{ retailer_id: string; name: string; price_paise: string;
  stock: number | null; is_active: boolean; source: string }>('SELECT retailer_id, name, price_paise, stock, is_active, source FROM products ORDER BY retailer_id')).rows);

test('connecting checks the token with Shopify first and refuses bad domains', async () => {
  ctx.setMetaResponse(store([]));
  assert.equal((await api('PUT', '/integrations/shopify', { shopDomain: 'evil.example.com', accessToken: TOKEN })).statusCode, 400);
  const wrong = await api('PUT', '/integrations/shopify', { shopDomain: 'lakshmi-silks.myshopify.com', accessToken: 'shpat_wrongwrongwrongwrongwrong' });
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.json().error, 'shopify_rejected');
  assert.equal((await api('GET', '/integrations/shopify')).json().connected, false);

  const ok = await api('PUT', '/integrations/shopify', { shopDomain: 'https://Lakshmi-Silks.myshopify.com/admin', accessToken: TOKEN });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json(), { connected: true, shopName: 'Lakshmi Silks', currency: 'INR' });
  const row = await withTenant(ctx.db, owner.tenantId, async (tx) => (await tx.query('SELECT token_enc FROM shopify_connections')).rows[0]);
  assert.ok(!String(row.token_enc).includes('shpat_'), 'token stored encrypted');
});

test('sync imports every page, takes over a manual product with the same SKU, and hides products gone from the store', async () => {
  await api('POST', '/products', { retailerId: 'SAREE-RED', name: 'old manual name', pricePaise: 1 });
  await api('POST', '/products', { retailerId: 'MY-OWN', name: 'Not on Shopify', pricePaise: 500 });
  ctx.setMetaResponse(store([v(1, 'SAREE-RED', 'Default Title', '1499.50'), v(2, null, 'Large', '349.00', 'ACTIVE', null),
    v(3, 'DRAFT-1', 'Default Title', '99', 'DRAFT'), v(4, 'GONE-LATER', 'Blue', '10.00')]));
  await runSync();
  let p = await products();
  assert.deepEqual(p.map((x) => [x.retailer_id, x.name, Number(x.price_paise), x.stock, x.is_active, x.source]), [
    ['DRAFT-1', 'Product 3', 9900, 5, false, 'shopify'],
    ['GONE-LATER', 'Product 4 – Blue', 1000, 5, true, 'shopify'],
    ['MY-OWN', 'Not on Shopify', 500, null, true, 'manual'],
    ['SAREE-RED', 'Product 1', 149950, 5, true, 'shopify'],
    ['shopify-2', 'Product 2 – Large', 34900, null, true, 'shopify'],
  ]);
  const status = (await api('GET', '/integrations/shopify')).json();
  assert.deepEqual(status.last_result, { ok: true, created: 3, updated: 1, hidden: 0 });

  // GONE-LATER is deleted in Shopify: it is hidden, not deleted. Manual products are never touched.
  ctx.setMetaResponse(store([v(1, 'SAREE-RED', 'Default Title', '1599.50'), v(2, null, 'Large', '349.00'), v(3, 'DRAFT-1', 'Default Title', '99', 'DRAFT')]));
  await runSync();
  p = await products();
  assert.equal(p.find((x) => x.retailer_id === 'GONE-LATER')!.is_active, false);
  assert.equal(p.find((x) => x.retailer_id === 'MY-OWN')!.is_active, true);
  assert.equal(Number(p.find((x) => x.retailer_id === 'SAREE-RED')!.price_paise), 159950);
  assert.equal((await api('GET', '/integrations/shopify')).json().last_result.hidden, 1);
});

test('a revoked token is recorded for the owner and not retried', async () => {
  ctx.setMetaResponse(store([], 'shpat_rotated_token_the_store_now_uses'));
  await assert.rejects(runSync(), (e: Error) => e.constructor.name === 'PermanentJobError');
  const r = (await api('GET', '/integrations/shopify')).json().last_result;
  assert.equal(r.ok, false);
  assert.match(r.error, /refused the access token/);
});
