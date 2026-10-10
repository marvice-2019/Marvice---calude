import { describe, expect, it } from "vitest";
import { computeSlots } from "../slots";
import { createMemoryStore } from "./memory-store";
import { buildSeed } from "./seed";
import { SlotTakenError } from "./types";

const NOW = new Date("2026-10-10T06:00:00Z");
const guest = { name: "Meera Iyer", email: "meera@example.com", timezone: "Asia/Kolkata", phone: null, answers: [] };

async function setup() {
  const store = createMemoryStore(buildSeed(NOW));
  const host = await store.getCurrentUser();
  const first = (await store.getBooking(host.id, "bkg_1"))!; // confirmed coaching booking
  return { store, host, first };
}

describe("memory store createBooking", () => {
  it("rejects an overlapping booking for the same host with SlotTakenError", async () => {
    const { store, first } = await setup();
    const startAt = new Date(first.startAt.getTime() + 30 * 60_000);
    await expect(store.createBooking({ eventTypeId: "evt_intro", startAt, idempotencyKey: "k1", invitee: guest })).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("returns the existing booking for a repeated idempotency key", async () => {
    const { store, host, first } = await setup();
    const startAt = new Date(first.endAt.getTime() + 3 * 60 * 60_000);
    const input = { eventTypeId: "evt_intro", startAt, idempotencyKey: "same-key", invitee: guest };
    const a = await store.createBooking(input);
    const b = await store.createBooking(input);
    expect(b.id).toBe(a.id);
    expect((await store.listBookings(host.id)).filter((x) => x.idempotencyKey === "same-key")).toHaveLength(1);
  });

  it("a cancelled booking frees its slot", async () => {
    const { store, host, first } = await setup();
    const { schedule, rules } = await store.getDefaultSchedule(host.id);
    const eventType = (await store.getEventType(host.id, "evt_coaching"))!;
    const day = { rangeStart: new Date(first.startAt.getTime() - 3_600_000), rangeEnd: new Date(first.startAt.getTime() + 3_600_000) };
    const slotsNow = async () =>
      computeSlots({ eventType, schedule, rules, busyBlocks: [], bookings: await store.listBookings(host.id), now: NOW, syncStale: false, ...day }).map((d) => d.getTime());

    expect(await slotsNow()).not.toContain(first.startAt.getTime());
    await expect(store.createBooking({ eventTypeId: eventType.id, startAt: first.startAt, idempotencyKey: "k2", invitee: guest })).rejects.toBeInstanceOf(SlotTakenError);

    await store.cancelBooking(first.id, "guest");
    expect(await slotsNow()).toContain(first.startAt.getTime());
    const rebooked = await store.createBooking({ eventTypeId: eventType.id, startAt: first.startAt, idempotencyKey: "k3", invitee: guest });
    expect(rebooked.status).toBe("confirmed");
  });

  it("does not reuse a question id that belongs to another event type", async () => {
    const { store } = await setup();
    const q = { label: "Anything else?", kind: "short_text" as const, required: false, choices: [] };
    const [saved] = await store.saveQuestions("evt_intro", [{ ...q, id: "q_goal" }]);
    expect(saved.id).not.toBe("q_goal");
    const coaching = await store.listCustomQuestions("evt_coaching");
    expect(coaching.map((c) => c.id)).toEqual(["q_goal"]);
    expect(coaching[0].label).toBe("What would you like to work on?");
  });

  it("keeps a question id that belongs to the same event type", async () => {
    const { store } = await setup();
    const [saved] = await store.saveQuestions("evt_coaching", [{ label: "Goal?", kind: "long_text", required: true, choices: [], id: "q_goal" }]);
    expect(saved.id).toBe("q_goal");
  });

  it("seeds Priya's public event types", async () => {
    const { store } = await setup();
    expect((await store.getPublicEventType("priya", "coaching"))?.eventType.durationMinutes).toBe(45);
    expect((await store.getPublicEventType("priya", "intro"))?.eventType.name).toBe("Free 15-min intro call");
  });
});
