import type { ApiError } from "./types";

/** Error carrying the API's plain-language message (SPEC copy) for display. */
export class ApiFailure extends Error {
  constructor(public status: number, public body: ApiError) { super(body.message); }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiFailure(res.status, body ?? { error: "http_" + res.status, message: "Something went wrong. Try again in a minute." });
  return body as T;
}

/** Server components: talk to the API directly (public endpoints only). */
export async function serverGet<T>(path: string, revalidate = 60): Promise<T> {
  const base = process.env.API_URL ?? "http://localhost:3000";
  const res = await fetch(base + path, { next: { revalidate } });
  return parse<T>(res);
}

/** Browser: everything goes through the same-origin BFF, which adds the session from httpOnly cookies. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; idempotent?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotent) headers["idempotency-key"] = crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch("/api/bff" + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    throw new ApiFailure(0, { error: "offline", message: "You're offline. Check your connection and try again." });
  }
  return parse<T>(res);
}

export async function authCall<T>(path: "otp" | "verify" | "logout", body?: unknown): Promise<T> {
  const res = await fetch("/api/auth/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return parse<T>(res);
}
