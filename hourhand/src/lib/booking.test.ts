import { describe, expect, it } from "vitest";
import { handleCreateBooking, handleGetSlots, validateBookingRequest } from "./booking";
import { createMemoryStore } from "./data/memory-store";
import { buildSeed } from "./data/seed";

const now = new Date("2026-10-10T04:00:00Z");
const DAY = 86_400_000;
const fresh = () => createMemoryStore(buildSeed(now));

async function firstSlots(store = fresh()): Promise<string[]> {
  const params = new URLSearchParams({ slug: "priya", event: "coaching", from: now.toISOString(), to: new Date(now.getTime() + 14 * DAY).toISOString(), tz: "Asia/Kolkata" });
  const res = await handleGetSlots(store, params, now);
  return (res.body as { slots: string[] }).slots;
}

const good = (start: string, key = "key-0001-abcd") => ({
  slug: "priya", event: "coaching", start, name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata",
  answers: { q_goal: "Planning a career move." }, idempotencyKey: key,
});

describe("validateBookingRequest", () => {
  it("accepts good input", () => {
    const v = validateBookingRequest(good("2026-10-20T05:30:00.000Z"));
    expect(v.ok).toBe(true);
  });
  it("rejects a bad email", () => {
    const v = validateBookingRequest({ ...good("2026-10-20T05:30:00.000Z"), email: "meera@" });
    expect(v).toMatchObject({ ok: false, fields: { email: expect.any(String) } });
  });
  it("rejects an unknown time zone", () => {
    const v = validateBookingRequest({ ...good("2026-10-20T05:30:00.000Z"), timezone: "Mars/Olympus" });
    expect(v).toMatchObject({ ok: false, fields: { timezone: expect.any(String) } });
  });
  it("rejects an empty or overlong name", () => {
    expect(validateBookingRequest({ ...good("2026-10-20T05:30:00.000Z"), name: " " }).ok).toBe(false);
    expect(validateBookingRequest({ ...good("2026-10-20T05:30:00.000Z"), name: "x".repeat(101) }).ok).toBe(false);
  });
});

describe("handleGetSlots", () => {
  it("lists slots, 400s on bad params and 404s an unknown event", async () => {
    expect((await firstSlots()).length).toBeGreaterThan(0);
    expect((await handleGetSlots(fresh(), new URLSearchParams({ slug: "priya", event: "coaching", from: "nope", to: "x" }), now)).status).toBe(400);
    const params = new URLSearchParams({ slug: "priya", event: "nope", from: now.toISOString(), to: new Date(now.getTime() + DAY).toISOString() });
    expect((await handleGetSlots(fresh(), params, now)).status).toBe(404);
  });
});

describe("handleCreateBooking", () => {
  it("returns 409 slot_taken for a start the engine does not offer", async () => {
    const store = fresh();
    const [first] = await firstSlots(store);
    const offGrid = new Date(new Date(first).getTime() + 7 * 60_000).toISOString(); // not on the 30-min increment
    const res = await handleCreateBooking(store, good(offGrid), now);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "slot_taken" });
    expect((res.body as { nextSlots: string[] }).nextSlots).toHaveLength(3);
  });

  it("books with 201, rejects the same slot with 409 and next slots, and repeats the same key with 200", async () => {
    const store = fresh();
    const [first] = await firstSlots(store);
    const created = await handleCreateBooking(store, good(first, "key-first-0001"), now);
    expect(created.status).toBe(201);
    const { bookingId } = created.body as { bookingId: string; manageToken: string };

    const clash = await handleCreateBooking(store, good(first, "key-second-0002"), now);
    expect(clash.status).toBe(409);
    const next = (clash.body as { nextSlots: string[] }).nextSlots;
    expect(next).toHaveLength(3);
    expect(next).not.toContain(first);

    const repeat = await handleCreateBooking(store, good(first, "key-first-0001"), now);
    expect(repeat.status).toBe(200);
    expect(repeat.body).toMatchObject({ bookingId });
    expect((await store.listBookings("usr_priya")).filter((b) => b.id === bookingId)).toHaveLength(1);
  });

  it("400s with field errors on invalid input and on a missing required answer", async () => {
    const store = fresh();
    const [first] = await firstSlots(store);
    const bad = await handleCreateBooking(store, { ...good(first), email: "no" }, now);
    expect(bad).toMatchObject({ status: 400, body: { fields: { email: expect.any(String) } } });
    const noAnswer = await handleCreateBooking(store, { ...good(first), answers: {} }, now);
    expect(noAnswer).toMatchObject({ status: 400, body: { fields: { "answers.q_goal": expect.any(String) } } });
  });
});
