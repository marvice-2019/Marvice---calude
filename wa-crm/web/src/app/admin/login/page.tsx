'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { AuthCard } from '@/components/auth-card';
import { api, errorText } from '@/lib/api';
import { adminToken } from '@/lib/admin';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard title="Platform admin sign in" footer="For platform staff only.">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setError(null);
        try { const r = await api<{ token: string }>('/admin/auth/login', { body: { email, password }, token: null }); adminToken.set(r.token); router.replace('/admin'); }
        catch (err) { setError(errorText(err)); }
      }}>
        {error && <Alert>{error}</Alert>}
        <div><label className="label" htmlFor="ae">Email</label><input id="ae" className="input" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label" htmlFor="ap">Password</label><input id="ap" className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className="btn btn-primary w-full">Sign in</button>
      </form>
    </AuthCard>
  );
}
