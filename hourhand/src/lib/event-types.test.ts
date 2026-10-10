import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./data/memory-store";
import { buildSeed } from "./data/seed";
import { EventTypeInUseError, type EventTypeDraft } from "./data/types";
import { SLUG_TAKEN, slugify, validateEventType, validateQuestions, type EventTypeForm } from "./event-types";

const NOW = new Date("2026-10-10T06:00:00Z");

const valid: EventTypeForm = {
  name: "30-min strategy call", slug: "strategy", durationMinutes: "30", description: "  Plan the next quarter.  ",
  locationKind: "zoom", locationValue: "", minNoticeMinutes: "240", bookingWindowDays: "60", startIncrementMinutes: "15",
  bufferBeforeMinutes: "0", bufferAfterMinutes: "10", dailyLimit: "", cancelCutoffMinutes: "120",
};

function draft(overrides: Partial<EventTypeForm> = {}): EventTypeDraft {
  const result = validateEventType({ ...valid, ...overrides }, []);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

describe("validateEventType", () => {
  it("accepts valid input and returns typed values", () => {
    const result = validateEventType(valid, ["coaching", "intro"]);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "30-min strategy call", slug: "strategy", description: "Plan the next quarter.", durationMinutes: 30, minNoticeMinutes: 240,
        bookingWindowDays: 60, startIncrementMinutes: 15, bufferBeforeMinutes: 0, bufferAfterMinutes: 10, dailyLimit: null,
        cancelCutoffMinutes: 120, location: { kind: "zoom", value: null },
      },
    });
  });

  it.each(["4", "721", "", "30.5", "abc"])("rejects duration %j", (durationMinutes) => {
    const result = validateEventType({ ...valid, durationMinutes }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(["durationMinutes"]);
  });

  it("accepts the duration limits 5 and 720", () => {
    expect(validateEventType({ ...valid, durationMinutes: "5" }, []).ok).toBe(true);
    expect(validateEventType({ ...valid, durationMinutes: "720" }, []).ok).toBe(true);
  });

  it.each(["25", "0", "90"])("rejects start increment %j", (startIncrementMinutes) => {
    const result = validateEventType({ ...valid, startIncrementMinutes }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.startIncrementMinutes).toBeDefined();
  });

  it("rejects buffers over 240 and booking windows outside 1 to 730", () => {
    const result = validateEventType({ ...valid, bufferBeforeMinutes: "241", bookingWindowDays: "731", dailyLimit: "0" }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["bookingWindowDays", "bufferBeforeMinutes", "dailyLimit"]);
  });

  it("generates the slug from the name when it is blank", () => {
    expect(slugify("  45-min Coaching Session! ")).toBe("45-min-coaching-session");
    expect(slugify("Café & chat")).toBe("cafe-chat");
    expect(draft({ slug: "", name: "Quick Catch-up" }).slug).toBe("quick-catch-up");
  });

  it("rejects a slug the user already uses, including a generated one", () => {
    const typed = validateEventType({ ...valid, slug: "coaching" }, ["coaching", "intro"]);
    expect(typed).toEqual({ ok: false, errors: { slug: SLUG_TAKEN } });
    const generated = validateEventType({ ...valid, slug: "", name: "Intro" }, ["coaching", "intro"]);
    expect(generated).toEqual({ ok: false, errors: { slug: SLUG_TAKEN } });
  });

  it("rejects a slug with characters the link can't hold", () => {
    const result = validateEventType({ ...valid, slug: "my link" }, []);
    expect(result.ok).toBe(false);
  });

  it("requires a value for in-person locations", () => {
    const result = validateEventType({ ...valid, locationKind: "in_person", locationValue: " " }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.locationValue).toBeDefined();
  });
});

describe("validateQuestions", () => {
  it("needs a label and two choices for a single select", () => {
    const result = validateQuestions([
      { id: null, label: "", kind: "short_text", required: false, choices: [] },
      { id: null, label: "Pick one", kind: "single_select", required: true, choices: ["Only", " "] },
    ]);
    expect(result).toEqual({ ok: false, errors: [{ label: "Write the question guests will see." }, { choices: "Add at least two choices, one per line." }] });
  });
});

describe("event type store", () => {
  it("refuses to delete an event type with upcoming confirmed bookings", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const host = await store.getCurrentUser();
    const error = await store.deleteEventType(host.id, "evt_coaching", NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EventTypeInUseError);
    expect((error as EventTypeInUseError).reason).toBe("upcoming");
    expect(await store.getEventType(host.id, "evt_coaching")).not.toBeNull();
  });

  it("deletes an event type nobody has booked", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const host = await store.getCurrentUser();
    const created = await store.createEventType(host.id, draft());
    await store.deleteEventType(host.id, created.id, NOW);
    expect(await store.getEventType(host.id, created.id)).toBeNull();
  });

  it("creates, updates and switches an event type, keeping slugs unique", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const host = await store.getCurrentUser();
    const created = await store.createEventType(host.id, draft({ locationKind: "in_person", locationValue: "MG Road office" }));
    expect(created).toMatchObject({ slug: "strategy", active: true, durationMinutes: 30, position: 2 });
    expect(await store.listEventLocations(created.id)).toMatchObject([{ kind: "in_person", value: "MG Road office" }]);
    await expect(store.createEventType(host.id, draft())).rejects.toThrow(SLUG_TAKEN);
    await expect(store.updateEventType(host.id, created.id, draft({ slug: "coaching" }))).rejects.toThrow(SLUG_TAKEN);

    await store.updateEventType(host.id, created.id, draft({ durationMinutes: "60", locationKind: "" }));
    expect(await store.getEventType(host.id, created.id)).toMatchObject({ durationMinutes: 60, slug: "strategy" });
    expect(await store.listEventLocations(created.id)).toEqual([]);

    await store.setEventTypeActive(host.id, created.id, false);
    expect(await store.getPublicEventType(host.slug, "strategy")).toBeNull();
  });

  it("saves questions and reads them back in order with their required flags", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const checked = validateQuestions([
      { id: null, label: "Company name", kind: "short_text", required: false, choices: [] },
      { id: "q_goal", label: "What would you like to work on?", kind: "long_text", required: true, choices: [] },
      { id: null, label: "How did you hear about me?", kind: "single_select", required: true, choices: ["Friend", "LinkedIn"] },
    ]);
    if (!checked.ok) throw new Error("questions should be valid");
    await store.saveQuestions("evt_coaching", checked.value);

    const back = await store.listCustomQuestions("evt_coaching");
    expect(back.map((q) => [q.label, q.required, q.position])).toEqual([
      ["Company name", false, 0],
      ["What would you like to work on?", true, 1],
      ["How did you hear about me?", true, 2],
    ]);
    expect(back[1].id).toBe("q_goal");
    expect(back[2].choices).toEqual(["Friend", "LinkedIn"]);
    expect(await store.listCustomQuestions("evt_intro")).toEqual([]);
  });
});
