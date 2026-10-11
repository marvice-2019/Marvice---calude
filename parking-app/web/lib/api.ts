import { z } from "zod";
import * as C from "./contract";
import { clearSession, getSession, setSession } from "./session";

/** Browser calls go to NEXT_PUBLIC_API_URL; server components may use the private API_INTERNAL_URL. */
export function apiBase(): string {
  if (typeof window === "undefined") return process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}

/** A failed API call. `message` is the API's plain-language text, safe to show as is. */
export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public body?: C.ApiError) { super(message); }
}

const OFFLINE = "You're offline. Check your connection and try again.";

type Opts = { method?: string; body?: unknown; auth?: boolean; idempotencyKey?: string; signal?: AbortSignal; revalidate?: number };

async function raw(path: string, o: Opts, token?: string): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (o.idempotencyKey) headers["idempotency-key"] = o.idempotencyKey;
  try {
    return await fetch(apiBase() + path, {
      method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: o.signal,
      ...(typeof window === "undefined" ? { next: { revalidate: o.revalidate ?? 0 } } : { cache: "no-store" as RequestCache })
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiFailure(0, "network", OFFLINE);
  }
}

// The API rotates refresh tokens and revokes the old one, so two refreshes with the same token
// would make the second fail. One refresh at a time per tab; another tab may have rotated it already.
let inflight: Promise<string | null> | null = null;
function refreshSession(): Promise<string | null> {
  inflight ??= (async () => {
    const s = getSession();
    if (!s) return null;
    const r = await raw("/v1/auth/refresh", { method: "POST", body: { refresh: s.refresh } });
    if (!r.ok) {
      const now = getSession();
      if (now && now.refresh !== s.refresh) return now.access; // another tab refreshed first
      clearSession();
      return null;
    }
    const t = C.Refreshed.parse(await r.json());
    setSession({ ...s, ...t });
    return t.access;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** One request: attaches the session, refreshes once on 401, and validates the response against the contract. */
export async function call<T extends z.ZodType>(schema: T, path: string, o: Opts = {}): Promise<z.infer<T>> {
  let token = o.auth ? getSession()?.access : undefined;
  if (o.auth && !token) throw new ApiFailure(401, "unauthenticated", "Sign in to continue.");
  let res = await raw(path, o, token);
  if (res.status === 401 && o.auth) {
    token = (await refreshSession()) ?? undefined;
    if (!token) throw new ApiFailure(401, "unauthenticated", "Your session ended. Sign in again.");
    res = await raw(path, o, token);
  }
  if (res.status === 204) return schema.parse({});
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const e = C.ApiError.safeParse(json);
    throw new ApiFailure(res.status, e.success ? e.data.error : "http_" + res.status,
      e.success ? e.data.message : "Something went wrong on our side. Try again in a minute.", e.success ? e.data : undefined);
  }
  return schema.parse(json);
}

export const newIdempotencyKey = () => "web-" + crypto.randomUUID();

const qs = (o: Record<string, string | number | undefined>) =>
  "?" + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  requestOtp: (phone: string) => call(C.Ok, "/v1/auth/otp", { method: "POST", body: { phone } }),
  async verifyOtp(phone: string, otp: string) {
    const s = await call(C.Session, "/v1/auth/verify", { method: "POST", body: { phone, otp } });
    setSession(s);
    return s;
  },
  search: (p: { lat: number; lng: number; from: string; to: string; vehicle: C.VehicleKind; sort?: "dist" | "price" | "left" }, signal?: AbortSignal) =>
    call(C.SearchResult, "/v1/lots/search" + qs(p), { signal, revalidate: 300 }),
  monthlyLots: (lat: number, lng: number) => call(C.MonthlyResult, "/v1/lots/monthly" + qs({ lat, lng }), { revalidate: 300 }),
  lot: (id: string, p: { from: string; to: string; vehicle: C.VehicleKind }) => call(C.LotDetail, `/v1/lots/${encodeURIComponent(id)}` + qs(p), { revalidate: 300 }),
  lotByCode: (code: string) => call(C.LotByCode, `/v1/lots/by-code/${encodeURIComponent(code)}`, { revalidate: 300 }),
  quote: (b: { lot_id: string; from: string; to: string; vehicle: C.VehicleKind; promo?: string }) =>
    call(C.QuoteResult, "/v1/quotes", { method: "POST", body: b, auth: !!getSession() }),
  createBooking: (b: { lot_id: string; source: "prebook" | "park_now"; from?: string; to?: string; hours?: number;
    vehicle_id?: string; plate?: string; vehicle_kind: C.VehicleKind; promo?: string }, key: string) =>
    call(C.BookingCreated, "/v1/bookings", { method: "POST", body: b, auth: true, idempotencyKey: key }),
  bookings: () => call(C.Bookings, "/v1/bookings", { auth: true }),
  extend: (id: string, key: string) => call(C.Extended, `/v1/bookings/${id}/extend`, { method: "POST", body: { hours: 1 }, auth: true, idempotencyKey: key }),
  cancel: (id: string, key: string) => call(C.Cancelled, `/v1/bookings/${id}/cancel`, { method: "POST", body: {}, auth: true, idempotencyKey: key }),
  me: () => call(C.Me, "/v1/me", { auth: true }),
  setPreferences: (b: { default_vehicle_id?: string | null; payment_method?: C.PayMethod }) =>
    call(C.Ok, "/v1/me/preferences", { method: "PUT", body: b, auth: true }),
  addVehicle: (plate: string, kind: C.VehicleKind) => call(C.VehicleCreated, "/v1/me/vehicles", { method: "POST", body: { plate, kind }, auth: true }),
  favourite: (lotId: string, on: boolean) => call(C.Ok, `/v1/me/favourites/${lotId}`, { method: on ? "PUT" : "DELETE", auth: true }),
  deleteAccount: () => call(C.Ok, "/v1/me", { method: "DELETE", auth: true }),
  requestMonthly: (b: { lot_id: string; vehicle_id: string; starts_on: string }) =>
    call(C.MonthlyRequested, "/v1/monthly-passes", { method: "POST", body: b, auth: true }),
  ownerLead: (b: { name: string; phone: string; address: string; bays: number }) =>
    call(C.Ok, "/v1/leads/owners", { method: "POST", body: b })
};
