'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Empty, Modal, PageHeader, useApi } from '@/components/ui';
import { api, errorText, money } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Product { id: string; retailer_id: string; name: string; description: string | null; price_paise: string; currency: string;
  image_url: string | null; stock: number | null; is_active: boolean; source: string }

export default function ProductsPage() {
  const { principal } = useSession();
  const list = useApi<{ data: Product[] }>('/products');
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const canEdit = principal?.role !== 'agent';
  return (
    <div className="space-y-5 p-6">
      <PageHeader title="Products" subtitle="Use the same SKU as the “Content ID” in your Meta catalog, so WhatsApp carts match these products."
        actions={canEdit && <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus size={16} aria-hidden /> Add product</button>} />
      {canEdit && <ShopifyPanel onSynced={() => list.reload()} />}
      {list.error && <Alert>{list.error}</Alert>}
      {list.data && list.data.data.length === 0 ? <Empty title="No products yet">Add your products here, or connect Shopify to sync them.</Empty> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(list.data?.data ?? []).map((p) => (
            <li key={p.id} className={`card flex gap-3 p-3 ${p.is_active ? '' : 'opacity-60'}`}>
              {p.image_url ? <img src={p.image_url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : <div className="h-16 w-16 shrink-0 rounded-lg bg-canvas" />}
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-xs text-muted">{p.retailer_id}{p.stock !== null ? ` · ${p.stock} in stock` : ''}{p.is_active ? '' : ' · hidden'}{p.source === 'shopify' ? ' · Shopify' : ''}</div>
                <div className="mt-1 font-semibold">{money(Number(p.price_paise))}</div>
              </div>
              {canEdit && <button className="self-start text-xs text-brand hover:underline" onClick={() => setEdit(p)}>Edit</button>}
            </li>))}
        </ul>)}
      {edit && <ProductForm product={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

function ProductForm({ product, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ retailerId: product?.retailer_id ?? '', name: product?.name ?? '', description: product?.description ?? '',
    rupees: product ? String(Number(product.price_paise) / 100) : '', imageUrl: product?.image_url ?? '', stock: product?.stock == null ? '' : String(product.stock),
    isActive: product?.is_active ?? true });
  const [error, setError] = useState<string | null>(null);
  const input = (k: 'retailerId' | 'name' | 'imageUrl' | 'rupees' | 'stock', label: string, extra: Record<string, unknown> = {}) => (
    <div><label className="label" htmlFor={`p-${k}`}>{label}</label>
      <input id={`p-${k}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>);
  return (
    <Modal title={product ? 'Edit product' : 'Add product'} open onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setError(null);
        const body = { retailerId: f.retailerId, name: f.name, description: f.description || null, pricePaise: Math.round(Number(f.rupees) * 100),
          imageUrl: f.imageUrl || null, stock: f.stock === '' ? null : Number(f.stock), isActive: f.isActive };
        try { await api(product ? `/products/${product.id}` : '/products', { method: product ? 'PUT' : 'POST', body }); onDone(); }
        catch (err) { setError(errorText(err)); } }}>
        {error && <Alert>{error}</Alert>}
        {input('name', 'Name', { required: true, maxLength: 200 })}
        {input('retailerId', 'SKU / Meta Content ID', { required: true, maxLength: 100 })}
        <div className="grid grid-cols-2 gap-3">{input('rupees', 'Price in ₹', { required: true, type: 'number', min: 0, step: '0.01' })}
          {input('stock', 'Stock (empty = not tracked)', { type: 'number', min: 0 })}</div>
        {input('imageUrl', 'Image URL (https)', { type: 'url', pattern: 'https://.*' })}
        <div><label className="label" htmlFor="p-desc">Description</label>
          <textarea id="p-desc" className="input" rows={3} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Available for new orders</label>
        <button className="btn btn-primary w-full">{product ? 'Save' : 'Add product'}</button>
      </form>
    </Modal>
  );
}

interface ShopifyStatus { connected: boolean; shop_domain?: string; shop_name?: string; last_synced_at?: string | null;
  last_result?: { ok: boolean; created?: number; updated?: number; hidden?: number; error?: string } | null }

function ShopifyPanel({ onSynced }: { onSynced: () => void }) {
  const st = useApi<ShopifyStatus>('/integrations/shopify');
  const [f, setF] = useState({ shopDomain: '', accessToken: '' });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const s = st.data;
  if (!s) return null;
  async function waitForSync(since: string | null | undefined) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const now = await api<ShopifyStatus>('/integrations/shopify');
      if (now.last_result && (now.last_synced_at !== since || now.last_result.ok === false)) { st.setData(() => now); onSynced(); return now; }
    }
    return null;
  }
  const r = s.last_result;
  return (
    <details className="card p-4" open={!s.connected}>
      <summary className="cursor-pointer font-semibold">Shopify {s.connected ? `· ${s.shop_name ?? s.shop_domain}` : '· not connected'}</summary>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {s.connected ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-muted">Products sync automatically once a day. Shopify is the source of truth for prices, stock and names of the SKUs it owns; products you add here are never changed.</p>
          {r && (r.ok
            ? <p>Last sync {s.last_synced_at ? new Date(s.last_synced_at).toLocaleString('en-IN') : ''}: {r.created} new, {r.updated} updated, {r.hidden} hidden.</p>
            : <Alert>Last sync failed: {r.error}</Alert>)}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); setMsg(null);
              try { await api('/integrations/shopify/sync', { method: 'POST' }); const done = await waitForSync(s.last_synced_at);
                setMsg(done ? null : { tone: 'info', text: 'Sync is still running. Refresh in a minute.' }); }
              catch (e) { setMsg({ tone: 'error', text: errorText(e) }); } setBusy(false); }}>{busy ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn btn-secondary" onClick={async () => { if (!confirm('Disconnect Shopify? Imported products stay.')) return;
              await api('/integrations/shopify', { method: 'DELETE' }); st.reload(); }}>Disconnect</button>
          </div>
        </div>
      ) : (
        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setMsg(null);
          try { await api('/integrations/shopify', { method: 'PUT', body: f }); setF({ shopDomain: '', accessToken: '' });
            setMsg({ tone: 'success', text: 'Connected. Importing your products…' }); const done = await waitForSync(null);
            setMsg(done?.last_result?.ok ? { tone: 'success', text: 'Connected and products imported.' } : done ? null : { tone: 'info', text: 'Import is still running. Refresh in a minute.' }); }
          catch (err) { setMsg({ tone: 'error', text: errorText(err) }); } setBusy(false); }}>
          <p className="text-sm text-muted md:col-span-2">In Shopify admin: Settings → Apps and sales channels → Develop apps → create an app with the <b>read_products</b> and <b>read_inventory</b> scopes, install it, and copy the Admin API access token.</p>
          <div><label className="label" htmlFor="sh-d">Store address</label>
            <input id="sh-d" className="input" required placeholder="yourstore.myshopify.com" value={f.shopDomain} onChange={(e) => setF({ ...f, shopDomain: e.target.value })} /></div>
          <div><label className="label" htmlFor="sh-t">Admin API access token</label>
            <input id="sh-t" type="password" className="input" required minLength={20} autoComplete="off" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} /></div>
          <div className="md:col-span-2"><button className="btn btn-primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect Shopify'}</button></div>
        </form>
      )}
    </details>
  );
}
