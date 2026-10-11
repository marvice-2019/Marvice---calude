import { randomUUID } from "expo-crypto";
import type { GateResult } from "@/shared/types";
import { api, ApiFailure } from "./api";
import { kv } from "./kv";

/**
 * Gate scans for basements with no signal (OPS-01/02). Every scan gets a client_event_id when it happens and keeps
 * its real scan time, so a scan sent later is billed for the right time and a retried send is deduplicated by the API.
 * Order matters (in before out), so the queue drains front to back and stops at the first network failure.
 */
export type GateScan = { lot_id: string; direction: "in" | "out"; pass_code?: string; plate?: string; scanned_at: string; client_event_id: string };
export type SendOutcome = { kind: "ok"; result: GateResult } | { kind: "rejected"; message: string } | { kind: "offline" };
export type Drained = { scan: GateScan; outcome: SendOutcome };

const KEY = "bl_gate_queue_v1";

export function newScan(lot_id: string, direction: "in" | "out", ref: { pass_code?: string; plate?: string }, now = new Date()): GateScan {
  return { lot_id, direction, ...ref, scanned_at: now.toISOString(), client_event_id: "m-" + randomUUID() };
}

/** Network errors (status 0) and 5xx keep the scan for later; 4xx are real answers (expired, wrong lot) and leave the queue. */
export async function sendScan(scan: GateScan, send: (s: GateScan) => Promise<GateResult> = defaultSend): Promise<SendOutcome> {
  try { return { kind: "ok", result: await send(scan) }; }
  catch (e) {
    if (e instanceof ApiFailure && e.status >= 400 && e.status < 500) return { kind: "rejected", message: e.message };
    return { kind: "offline" };
  }
}

/** Pure drain step: sends queued scans in order until one can't reach the server. Returns what was settled and what remains. */
export async function drain(queue: GateScan[], send: (s: GateScan) => Promise<SendOutcome>): Promise<{ settled: Drained[]; remaining: GateScan[] }> {
  const settled: Drained[] = [];
  for (let i = 0; i < queue.length; i++) {
    const outcome = await send(queue[i]);
    if (outcome.kind === "offline") return { settled, remaining: queue.slice(i) };
    settled.push({ scan: queue[i], outcome });
  }
  return { settled, remaining: [] };
}

const defaultSend = (s: GateScan) => api<GateResult>("/v1/ops/gate-events", { method: "POST", body: s });

export async function loadQueue(): Promise<GateScan[]> {
  const raw = await kv.get(KEY);
  return raw ? (JSON.parse(raw) as GateScan[]) : [];
}
export async function saveQueue(q: GateScan[]) { await kv.set(KEY, JSON.stringify(q)); }

/**
 * Submit a new scan: if anything is already waiting, it joins the back of the queue (order is preserved);
 * otherwise it is sent now and queued only if there is no signal.
 */
export async function submit(scan: GateScan): Promise<{ outcome: SendOutcome; queued: number }> {
  const q = await loadQueue();
  if (q.length) { await saveQueue([...q, scan]); return { outcome: { kind: "offline" }, queued: q.length + 1 }; }
  const outcome = await sendScan(scan);
  if (outcome.kind === "offline") { await saveQueue([scan]); return { outcome, queued: 1 }; }
  return { outcome, queued: 0 };
}

/** Try to send everything waiting. Called on a timer and when the staff member taps Retry. */
export async function flush(): Promise<{ settled: Drained[]; queued: number }> {
  const q = await loadQueue();
  if (!q.length) return { settled: [], queued: 0 };
  const { settled, remaining } = await drain(q, s => sendScan(s));
  await saveQueue(remaining);
  return { settled, queued: remaining.length };
}
