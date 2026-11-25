'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Modal, PageHeader, useApi } from '@/components/ui';
import { api, errorText, when } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Member { id: string; name: string; email: string; role: 'owner' | 'admin' | 'agent'; created_at: string; open_conversations: number }

export default function TeamPage() {
  const { principal } = useSession();
  const team = useApi<{ data: Member[] }>('/team');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); team.reload(); } catch (e) { setError(errorText(e)); } };

  return (
    <div className="p-6">
      <PageHeader title="Team" subtitle="Agents see only the chats assigned to them. Admins see everything but cannot manage billing."
        actions={<button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add member</button>} />
      {(error || team.error) && <div className="mb-4"><Alert>{error ?? team.error}</Alert></div>}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr><th className="th">Member</th><th className="th">Role</th><th className="th">Open chats</th><th className="th">Joined</th><th className="th" /></tr></thead>
          <tbody>
            {(team.data?.data ?? []).map((m) => (
              <tr key={m.id}>
                <td className="td"><div className="font-medium">{m.name}</div><div className="text-xs text-muted">{m.email}</div></td>
                <td className="td">
                  {m.role === 'owner' || principal?.role !== 'owner' ? <span className="capitalize">{m.role}</span> : (
                    <select className="input w-auto" aria-label={`Role for ${m.name}`} value={m.role}
                      onChange={(e) => act(() => api(`/team/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }))}>
                      <option value="admin">Admin</option><option value="agent">Agent</option></select>
                  )}
                </td>
                <td className="td">{m.open_conversations}</td>
                <td className="td text-muted">{when(m.created_at)}</td>
                <td className="td text-right">{m.role !== 'owner' && m.id !== principal?.userId && (
                  <button className="text-sm text-danger" onClick={() => { if (confirm(`Remove ${m.name}? Their chats become unassigned.`)) void act(() => api(`/team/${m.id}`, { method: 'DELETE' })); }}>Remove</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddMember open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); team.reload(); }} />
    </div>
  );
}

function AddMember({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'agent', password: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Add team member" open={open} onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setError(null);
        try { await api('/team', { body: f }); setF({ name: '', email: '', role: 'agent', password: '' }); onDone(); } catch (err) { setError(errorText(err)); } }}>
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="mn">Name</label><input id="mn" className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="me">Email</label><input id="me" type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label" htmlFor="mr">Role</label>
          <select id="mr" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="agent">Agent</option><option value="admin">Admin</option></select></div>
        <div><label className="label" htmlFor="mp">Temporary password (10+ characters, share it privately)</label>
          <input id="mp" type="password" className="input" required minLength={10} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <button className="btn btn-primary w-full">Add member</button>
      </form>
    </Modal>
  );
}
