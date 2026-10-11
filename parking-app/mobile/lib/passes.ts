import type { Booking } from "@/shared/types";
import { api } from "./api";
import { kv } from "./kv";

const KEY = "bl_passes_v1";
export const LIVE = ["confirmed", "checked_in"];

export type PassesResult = { bookings: Booking[]; source: "network" | "cache"; savedAt: number | null };

/** Live passes from the API, falling back to the last saved copy when there's no signal. */
export async function loadPasses(): Promise<PassesResult> {
  try {
    const bookings = await api<Booking[]>("/v1/bookings");
    const keep = bookings.filter(b => LIVE.includes(b.status) && Date.parse(b.to) > Date.now() - 86_400_000);
    await kv.set(KEY, JSON.stringify({ savedAt: Date.now(), bookings: keep }));
    return { bookings, source: "network", savedAt: Date.now() };
  } catch (e) {
    const raw = await kv.get(KEY);
    if (!raw) throw e;
    const saved = JSON.parse(raw) as { savedAt: number; bookings: Booking[] };
    return { bookings: saved.bookings, source: "cache", savedAt: saved.savedAt };
  }
}

export async function forgetPasses() { await kv.del(KEY); }
