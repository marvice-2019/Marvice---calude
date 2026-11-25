'use client';

import { useState } from 'react';
import { Plus, Tag } from 'lucide-react';
import { Alert, Empty, Modal, PageHeader, StatusBadge, useApi } from '@/components/ui';
import { api, errorText, when } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ImportContacts } from '@/components/integrations';

interface TagT { id: string; label: string; color: string; contact_count?: number }
interface Contact { id: string; phone: string; name: string | null; email: string | null; status: string; opted_out_at: string | null; created_at: string; tags: TagT[] }

export default function ContactsPage() {
  const { principal } = useSession();
  const isManager = principal?.role !== 'agent';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = new URLSearchParams({ page: String(page), pageSize: '25', ...(search.trim() ? { search: search.trim() } : {}) });
  const contacts = useApi<{ data: Contact[]; total: number; pageSize: number }>(`/contacts?${q}`);
  const tags = useApi<{ data: TagT[] }>('/tags');
  const [adding, setAdding] = useState(false);
  const [tagging, setTagging] = useState<Contact | null>(null);
  const pages = contacts.data ? Math.max(1, Math.ceil(contacts.data.total / contacts.data.pageSize)) : 1;

  return (
    <div className="p-6">
      <PageHeader title="Contacts" subtitle={contacts.data ? `${contacts.data.total.toLocaleString('en-IN')} contacts` : undefined}
        actions={<>
          {isManager && <TagManager tags={tags.data?.data ?? []} onChange={tags.reload} />}
          {isManager && <ImportContacts onDone={contacts.reload} />}
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add contact</button>
        </>} />
      <input className="input mb-4 max-w-sm" placeholder="Search name, number or email" value={search} aria-label="Search contacts"
        onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      {contacts.error && <Alert>{contacts.error}</Alert>}
      {contacts.data && contacts.data.data.length === 0 ? (
        <Empty title="No contacts yet">Contacts are created automatically when customers message you, or add them here with their consent.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Name</th><th className="th">Number</th><th className="th">Tags</th><th className="th">Status</th><th className="th">Added</th><th className="th" /></tr></thead>
            <tbody>
              {(contacts.data?.data ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="td font-medium">{c.name ?? '—'}{c.email && <div className="text-xs font-normal text-muted">{c.email}</div>}</td>
                  <td className="td">+{c.phone}</td>
                  <td className="td"><div className="flex flex-wrap gap-1">{c.tags.map((t) =>
                    <span key={t.id} className="badge text-white" style={{ background: t.color }}>{t.label}</span>)}</div></td>
                  <td className="td">{c.opted_out_at ? <span className="badge bg-red-100 text-red-800">opted out</span> : <StatusBadge status={c.status} />}</td>
                  <td className="td text-muted">{when(c.created_at)}</td>
                  <td className="td text-right"><button className="btn-ghost btn px-2" onClick={() => setTagging(c)} aria-label={`Tags for ${c.name ?? c.phone}`}><Tag size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <button className="btn-ghost btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="text-muted">Page {page} of {pages}</span>
          <button className="btn-ghost btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      <AddContact open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); contacts.reload(); }} />
      {tagging && <TagPicker contact={tagging} tags={tags.data?.data ?? []} onClose={() => setTagging(null)} onDone={() => { setTagging(null); contacts.reload(); tags.reload(); }} />}
    </div>
  );
}

function AddContact({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ phone: '', name: '', email: '', consent: false });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await api('/contacts', { body: { phone: f.phone, ...(f.name ? { name: f.name } : {}), ...(f.email ? { email: f.email } : {}),
        ...(f.consent ? { optInSource: 'added manually with consent' } : {}) } });
      setF({ phone: '', name: '', email: '', consent: false }); onDone();
    } catch (err) { setError(errorText(err)); }
  }
  return (
    <Modal title="Add contact" open={open} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="cp">WhatsApp number with country code</label>
          <input id="cp" className="input" required placeholder="+91 98765 43210" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div><label className="label" htmlFor="cn">Name</label><input id="cn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="ce">Email</label><input id="ce" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="mt-1" />
          This person agreed to receive WhatsApp messages from us.</label>
        <button className="btn btn-primary w-full">Save contact</button>
      </form>
    </Modal>
  );
}

function TagPicker({ contact, tags, onClose, onDone }: { contact: Contact; tags: TagT[]; onClose: () => void; onDone: () => void }) {
  const [sel, setSel] = useState(new Set(contact.tags.map((t) => t.id)));
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`Tags for ${contact.name ?? '+' + contact.phone}`} open onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      {tags.length === 0 ? <p className="text-sm text-muted">No tags yet. An owner or admin can create tags.</p> : (
        <div className="mb-4 flex flex-wrap gap-2">
          {tags.map((t) => (
            <button key={t.id} type="button" aria-pressed={sel.has(t.id)} onClick={() => { const s = new Set(sel); if (s.has(t.id)) s.delete(t.id); else s.add(t.id); setSel(s); }}
              className={`badge border px-3 py-1 ${sel.has(t.id) ? 'border-transparent text-white' : 'border-line bg-white text-ink'}`}
              style={sel.has(t.id) ? { background: t.color } : undefined}>{t.label}</button>
          ))}
        </div>
      )}
      <button className="btn btn-primary w-full" onClick={async () => {
        try { await api(`/contacts/${contact.id}/tags`, { method: 'PUT', body: { tagIds: [...sel] } }); onDone(); } catch (e) { setError(errorText(e)); }
      }}>Save tags</button>
    </Modal>
  );
}

function TagManager({ tags, onChange }: { tags: TagT[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#0f766e');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button className="btn-ghost btn" onClick={() => setOpen(true)}><Tag size={16} /> Tags</button>
      <Modal title="Tags" open={open} onClose={() => setOpen(false)}>
        {error && <Alert>{error}</Alert>}
        <ul className="mb-4 space-y-2">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center justify-between text-sm">
              <span className="badge text-white" style={{ background: t.color }}>{t.label}</span>
              <span className="text-muted">{t.contact_count ?? 0} contacts
                <button className="ml-3 text-danger" onClick={async () => { try { await api(`/tags/${t.id}`, { method: 'DELETE' }); onChange(); } catch (e) { setError(errorText(e)); } }}>Delete</button></span>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); setError(null);
          try { await api('/tags', { body: { label, color } }); setLabel(''); onChange(); } catch (err) { setError(errorText(err)); } }}>
          <input className="input" placeholder="New tag" required maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Tag name" />
          <input type="color" className="h-10 w-12 rounded border border-line" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Tag colour" />
          <button className="btn btn-primary">Add</button>
        </form>
      </Modal>
    </>
  );
}
