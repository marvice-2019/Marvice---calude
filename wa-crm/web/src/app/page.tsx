'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/lib/session';

export default function Home() {
  const { principal, ready } = useSession();
  const router = useRouter();
  useEffect(() => { if (ready) router.replace(principal ? '/inbox' : '/login'); }, [ready, principal, router]);
  return null;
}
