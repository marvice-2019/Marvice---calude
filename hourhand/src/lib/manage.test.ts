import { describe, expect, it } from "vitest";
import { freeSlots } from "./booking";
import { createMemoryStore } from "./data/memory-store";
import { buildSeed } from "./data/seed";
import type { DataStore } from "./data/types";
import { handleCancel, handleReschedule } from "./manage";

const now = new Date("2026-10-10T04:00:00Z");
const DAY = 86_400_000;
const MIN = 60_000;
const fresh = () => createMemoryStore(buildSeed(now));

async function coachingSlots(store: DataStore): Promise<Date[]> {
  const found = await store.getPublicEventType("priya", "coaching");
  return freeSlots(store, found!.host, found!.eventType, now, new Date(now.getTime() + 14 * DAY), now);
}

async function bookCoaching(store: DataStore, start: Date, key = "seed-key-0001") {
  return store.createBooking({
    eventTypeId: "evt_coaching", startAt: start, idempotencyKey: key,
    invitee: {
      name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata", phone: "+91 98765 43210",
      answers: [{ questionId: "q_goal", label: "What would you like to work on?", answer: "Planning a career move." }],
    },
  });
}

describe("handleCancel", () => {
  it("cancels a booking as the guest, with the reason", async () => {
    const store = fresh();
    const res = await handleCancel(store, "tok_bkg_1", "Something came up.", now);
    expect(res).toEqual({ status: 200, body: { status: "cancelled" } });
    const b = await store.getBookingByManageToken("tok_bkg_1");
    expect(b).toMatchObject({ status: "cancelled", cancelledBy: "guest", cancelReason: "Something came up." });
  });

  it("returns 404 for an unknown token", async () => {
    expect((await handleCancel(fresh(), "nope", undefined, now)).status).toBe(404);
  });

  it("refuses once the start is inside the cut-off", async () => {
    const store = fresh();
    const intro = (await store.getBookingByManageToken("tok_bkg_2"))!; // intro call, 120-min cut-off
    const res = await handleCancel(store, "tok_bkg_2", undefined, new Date(intro.startAt.getTime() - 60 * MIN));
    expect(res).toEqual({ status: 409, body: { error: "past_cutoff" } });
    expect((await store.getBookingByManageToken("tok_bkg_2"))!.status).toBe("confirmed");
    const early = await handleCancel(store, "tok_bkg_2", undefined, new Date(intro.startAt.getTime() - 180 * MIN));
    expect(early.status).toBe(200);
  });

  it("is idempotent: cancelling twice still returns cancelled", async () => {
    const store = fresh();
    await handleCancel(store, "tok_bkg_1", "First reason", now);
    const again = await handleCancel(store, "tok_bkg_1", "Second reason", now);
    expect(again).toEqual({ status: 200, body: { status: "cancelled" } });
    expect((await store.getBookingByManageToken("tok_bkg_1"))!.cancelReason).toBe("First reason");
  });
});

describe("handleReschedule", () => {
  it("moves the booking: old cancelled, new confirmed with a new token and the same guest details", async () => {
    const store = fresh();
    const slots = await coachingSlots(store);
    const old = await bookCoaching(store, slots[0]);
    const res = await handleReschedule(store, old.invitee.manageToken, { start: slots[3].toISOString(), idempotencyKey: "move-key-0001" }, now);
    expect(res.status).toBe(201);
    const { bookingId, manageToken } = res.body as { bookingId: string; manageToken: string };
    expect(manageToken).not.toBe(old.invitee.manageToken);

    const before = (await store.getBookingByManageToken(old.invitee.manageToken))!;
    expect(before).toMatchObject({ status: "cancelled", cancelledBy: "guest", cancelReason: "Rescheduled" });
    const moved = (await store.getBookingByManageToken(manageToken))!;
    expect(moved).toMatchObject({ id: bookingId, status: "confirmed", rescheduledFromId: old.id, startAt: slots[3] });
    expect(moved.invitee).toMatchObject({ name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata", phone: "+91 98765 43210" });
    expect(moved.invitee.answers).toEqual(old.invitee.answers);

    // A repeated submit returns the same new booking instead of failing on the now-cancelled old one.
    const repeat = await handleReschedule(store, old.invitee.manageToken, { start: slots[3].toISOString(), idempotencyKey: "move-key-0001" }, now);
    expect(repeat).toEqual({ status: 200, body: { bookingId, manageToken } });
  });

  it("returns slot_taken with three next times when the new time is booked", async () => {
    const store = fresh();
    const slots = await coachingSlots(store);
    const mine = await bookCoaching(store, slots[0]);
    await bookCoaching(store, slots[4], "other-key-0001");
    const res = await handleReschedule(store, mine.invitee.manageToken, { start: slots[4].toISOString(), idempotencyKey: "move-key-0002" }, now);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "slot_taken" });
    expect((res.body as { nextSlots: string[] }).nextSlots).toHaveLength(3);
    expect((await store.getBookingByManageToken(mine.invitee.manageToken))!.status).toBe("confirmed");
  });

  it("allows a time that overlaps only the booking's own buffered window", async () => {
    const store = fresh();
    const slots = await coachingSlots(store);
    const start = slots.find((s) => slots.some((t) => t.getTime() === s.getTime() + 30 * MIN))!;
    const target = new Date(start.getTime() + 30 * MIN);
    const mine = await bookCoaching(store, start);
    // Sanity: for anyone else, the target is now blocked by this booking's buffers.
    expect((await coachingSlots(store)).some((s) => s.getTime() === target.getTime())).toBe(false);

    const res = await handleReschedule(store, mine.invitee.manageToken, { start: target.toISOString(), idempotencyKey: "move-key-0003" }, now);
    expect(res.status).toBe(201);
  });

  it("refuses to move a cancelled booking", async () => {
    const res = await handleReschedule(fresh(), "tok_bkg_3", { start: now.toISOString(), idempotencyKey: "move-key-0004" }, now);
    expect(res).toEqual({ status: 409, body: { error: "cancelled" } });
  });

  it("rejects a short request key", async () => {
    const res = await handleReschedule(fresh(), "tok_bkg_1", { start: now.toISOString(), idempotencyKey: "short" }, now);
    expect(res).toMatchObject({ status: 400, body: { fields: { idempotencyKey: expect.any(String) } } });
  });
});
