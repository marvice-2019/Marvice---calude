import { randomUUID } from "expo-crypto";
import type { ApiError } from "@/shared/types";
import { secure } from "./secure";

// The app calls the API directly with a bearer token (no cookie BFF on mobile); refresh once on 401.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ACCESS = "bl_access", REFRESH = "bl_refresh";

export class ApiFailure extends Error {
  constructor(public status: number, public body: ApiError) { super(body.message); }
}

type Init = { method?: string; body?: unknown; idempotent?: boolean; auth?: boolean };

async function send(path: string, init: Init, token: string | null) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotent) headers["idempotency-key"] = randomUUID();
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(API_URL + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

async function refresh(): Promise<string | null> {
  const r = await secure.get(REFRESH);
  if (!r) return null;
  const res = await fetch(API_URL + "/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh: r }) });
  if (!res.ok) { await clearSession(); return null; }
  const b = await res.json() as { access: string; refresh: string };
  await setSession(b.access, b.refresh);
  return b.access;
}

export async function api<T>(path: string, init: Init = {}): Promise<T> {
  let res: Response;
  try {
    const token = init.auth === false ? null : await secure.get(ACCESS);
    res = await send(path, init, token);
    if (res.status === 401 && init.auth !== false) {
      const fresh = await refresh();
      if (fresh) res = await send(path, init, fresh);
    }
  } catch {
    throw new ApiFailure(0, { error: "offline", message: "You're offline. Check your connection and try again." });
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiFailure(res.status, body ?? { error: "http_" + res.status, message: "Something went wrong. Try again in a minute." });
  return body as T;
}

export async function setSession(access: string, refreshToken: string) {
  await secure.set(ACCESS, access); await secure.set(REFRESH, refreshToken);
}
export async function clearSession() {
  await secure.del(ACCESS); await secure.del(REFRESH);
}
export async function hasSession() {
  return !!(await secure.get(REFRESH));
}

export const auth = {
  otp: (phone: string) => api<{ sent: boolean }>("/v1/auth/otp", { method: "POST", body: { phone }, auth: false }),
  async verify(phone: string, otp: string) {
    const r = await api<{ access: string; refresh: string; user: { id: string; phone: string } }>("/v1/auth/verify", { method: "POST", body: { phone, otp }, auth: false });
    await setSession(r.access, r.refresh);
    return r.user;
  }
};
