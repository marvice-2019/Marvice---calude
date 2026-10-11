import { drain, sendScan, type GateScan, type SendOutcome } from "@/lib/gateQueue";

jest.mock("@/lib/api", () => {
  class ApiFailure extends Error {
    status: number; body: { error: string; message: string };
    constructor(s: number, b: { error: string; message: string }) { super(b.message); this.status = s; this.body = b; }
  }
  return { api: jest.fn(), ApiFailure };
});
jest.mock("@/lib/kv", () => ({ kv: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
const { ApiFailure } = jest.requireMock("@/lib/api");

const scan = (id: string, direction: "in" | "out" = "in"): GateScan =>
  ({ lot_id: "lot1", direction, pass_code: "BL-" + id, scanned_at: "2026-10-11T10:00:00.000Z", client_event_id: "m-" + id });
const ok: SendOutcome = { kind: "ok", result: { result: "ok" } };

test("sendScan: a 4xx is a real answer (rejected), network and 5xx keep the scan (offline)", async () => {
  expect(await sendScan(scan("1"), async () => ({ result: "ok" }))).toEqual(ok);
  expect(await sendScan(scan("2"), async () => { throw new ApiFailure(409, { error: "expired", message: "This pass has expired." }); }))
    .toEqual({ kind: "rejected", message: "This pass has expired." });
  expect(await sendScan(scan("3"), async () => { throw new ApiFailure(0, { error: "offline", message: "offline" }); })).toEqual({ kind: "offline" });
  expect(await sendScan(scan("4"), async () => { throw new ApiFailure(503, { error: "down", message: "down" }); })).toEqual({ kind: "offline" });
});

test("drain sends in order and stops at the first scan that can't reach the server", async () => {
  const sent: string[] = [];
  const answers: SendOutcome[] = [ok, { kind: "rejected", message: "This pass has expired." }, { kind: "offline" }, ok];
  const q = [scan("a"), scan("b"), scan("c"), scan("d", "out")];
  const r = await drain(q, async s => { sent.push(s.client_event_id); return answers[sent.length - 1]; });
  expect(sent).toEqual(["m-a", "m-b", "m-c"]); // d is never tried while c is stuck, so "out" can't overtake "in"
  expect(r.settled.map(x => x.outcome.kind)).toEqual(["ok", "rejected"]);
  expect(r.remaining.map(x => x.client_event_id)).toEqual(["m-c", "m-d"]);
});

test("a fully drained queue is empty and keeps each scan's original time and id for dedupe", async () => {
  const q = [scan("x"), scan("y", "out")];
  const seen: GateScan[] = [];
  const r = await drain(q, async s => { seen.push(s); return ok; });
  expect(r.remaining).toEqual([]);
  expect(seen).toEqual(q); // same scanned_at and client_event_id as when scanned
});
