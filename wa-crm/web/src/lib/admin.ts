'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, errorText } from './api';

// Platform-admin token is kept apart from the tenant session.
const KEY = 'wacrm.admin';
export const adminToken = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(KEY)),
  set: (t: string) => window.localStorage.setItem(KEY, t),
  clear: () => window.localStorage.removeItem(KEY),
};

export async function adminApi<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  try {
    return await api<T>(path, { ...init, token: adminToken.get() });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { adminToken.clear(); window.location.href = '/admin/login'; }
    throw e;
  }
}

export function useAdmin<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    adminApi<T>(path).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [path, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}
