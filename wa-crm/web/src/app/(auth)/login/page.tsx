'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { api, APP_NAME, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthCard } from '@/components/auth-card';

export default function LoginPage() {
  const { signIn } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string }>('/auth/login', { body: { email, password }, token: null });
      signIn(r.token);
      router.replace('/inbox');
    } catch (err) {
      setError(errorText(err));
    } finally { setBusy(false); }
  }

  return (
    <AuthCard title={`Sign in to ${APP_NAME}`} footer={<>New here? <Link className="font-medium text-brand" href="/signup">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="email">Work email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </AuthCard>
  );
}
