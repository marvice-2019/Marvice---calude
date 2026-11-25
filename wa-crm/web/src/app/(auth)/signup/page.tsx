'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthCard } from '@/components/auth-card';

export default function SignupPage() {
  const { signIn } = useSession();
  const router = useRouter();
  const [form, setForm] = useState({ businessName: '', name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string }>('/auth/signup', { body: form, token: null });
      signIn(r.token);
      router.replace('/settings');
    } catch (err) {
      setError(errorText(err));
    } finally { setBusy(false); }
  }

  return (
    <AuthCard title="Create your workspace" footer={<>Have an account? <Link className="font-medium text-brand" href="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="b">Business name</label><input id="b" className="input" required minLength={2} value={form.businessName} onChange={set('businessName')} /></div>
        <div><label className="label" htmlFor="n">Your name</label><input id="n" className="input" required minLength={2} autoComplete="name" value={form.name} onChange={set('name')} /></div>
        <div><label className="label" htmlFor="e">Work email</label><input id="e" className="input" type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></div>
        <div><label className="label" htmlFor="p">Password (10+ characters)</label><input id="p" className="input" type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set('password')} /></div>
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
      </form>
    </AuthCard>
  );
}
