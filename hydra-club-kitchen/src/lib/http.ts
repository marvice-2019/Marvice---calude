import "server-only";
import { after } from "next/server";
import type { Fail, PendingEvent } from "@/booking/service";
import { getDb } from "@/db";
import { deliverBookingEvent } from "./notify";

const NO_STORE = { "cache-control": "no-store" };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

/** Sends a service failure; the HTTP status is not repeated in the body. */
export function failed(f: Fail) {
  const { ok: _ok, status, ...body } = f;
  const headers: Record<string, string> = {};
  if (typeof f.retryAfterSec === "number") headers["retry-after"] = String(f.retryAfterSec);
  return json({ ok: false, ...body }, status, headers);
}

export class BadBody extends Error {}

/** Reads a small JSON body (bookings are tiny; anything over 16 KB is not a real form). */
export async function readJson(req: Request, maxBytes = 16_384): Promise<unknown> {
  if (!req.headers.get("content-type")?.includes("application/json")) throw new BadBody("Expected JSON");
  const text = await req.text();
  if (text.length > maxBytes) throw new BadBody("Body too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new BadBody("Malformed JSON");
  }
}

export const badBody = () => json({ ok: false, code: "bad_request", message: "Bad request." }, 400);

/** Notify n8n after the response has gone out: never delays or fails the guest's request. */
export function notifyLater(event: PendingEvent | null) {
  if (!event) return;
  after(() => deliverBookingEvent(getDb(), event.type, event.payload));
}
