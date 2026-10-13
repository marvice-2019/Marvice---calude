import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./data/memory-store";
import { buildSeed } from "./data/seed";
import { EventTypeInUseError, type EventTypeDraft } from "./data/types";
import { PRICE_INVALID, SLUG_TAKEN, priceGateError, priceInput, slugify, validateEventType, validateQuestions, type EventTypeForm } from "./event-types";

const NOW = new Date("2026-10-10T06:00:00Z");

const valid: EventTypeForm = {
  name: "30-min strategy call", slug: "strategy", durationMinutes: "30", description: "  Plan the next quarter.  ",
  locationKind: "zoom", locationValue: "", minNoticeMinutes: "240", bookingWindowDays: "60", startIncrementMinutes: "15",
  bufferBeforeMinutes: "0", bufferAfterMinutes: "10", dailyLimit: "", cancelCutoffMinutes: "120", maxRepeats: "1", deposit: "", price: "", hidden: false,
};

function draft(overrides: Partial<EventTypeForm> = {}): EventTypeDraft {
  const result = validateEventType({ ...valid, ...overrides }, []);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

describe("priceGateError", () => {
  const ok = { priceMinor: 49900, demo: false, plan: "solo", razorpayConnected: true } as const;

  it("lets a paid-plan host with Razorpay connected set a price", () => {
    expect(priceGateError(ok)).toBeNull();
    expect(priceGateError({ ...ok, plan: "duo" })).toBeNull();
  });

  it("refuses a price on the demo data", () => {
    expect(priceGateError({ ...ok, demo: true })).toBe("Prices can't be set on the demo data.");
  });

  it("refuses a price on the Free plan", () => {
    expect(priceGateError({ ...ok, plan: "free" })).toBe("Charging guests needs the Solo or Duo plan.");
  });

  it("refuses a price until Razorpay is connected", () => {
    expect(priceGateError({ ...ok, razorpayConnected: false })).toBe("Connect Razorpay first, so payments go to your account.");
  });

  it("always allows a free event", () => {
    expect(priceGateError({ priceMinor: null, demo: true, plan: "free", razorpayConnected: false })).toBeNull();
  });
});

describe("validateEventType", () => {
  it("accepts valid input and returns typed values", () => {
    const result = validateEventType(valid, ["coaching", "intro"]);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "30-min strategy call", slug: "strategy", description: "Plan the next quarter.", durationMinutes: 30, minNoticeMinutes: 240,
        bookingWindowDays: 60, startIncrementMinutes: 15, bufferBeforeMinutes: 0, bufferAfterMinutes: 10, dailyLimit: null,
        cancelCutoffMinutes: 120, maxRepeats: 1, depositMinor: null, priceMinor: null, currency: null, location: { kind: "zoom", value: null }, hidden: false,
        redirectUrl: null, weeklyLimit: null, cancelPolicy: null, seatLimit: null,
      },
    });
  });

  it("takes a weekly limit no lower than the daily one, and a policy of up to 1,000 characters", () => {
    expect(validateEventType({ ...valid, weeklyLimit: "5", cancelPolicy: " Cancel 24 hours ahead for a refund. " }, []))
      .toMatchObject({ ok: true, value: { weeklyLimit: 5, cancelPolicy: "Cancel 24 hours ahead for a refund." } });
    expect(validateEventType({ ...valid, dailyLimit: "3", weeklyLimit: "2" }, [])).toMatchObject({ ok: false, errors: { weeklyLimit: expect.any(String) } });
    // Past what the database column holds: a field error, not a failed save.
    expect(validateEventType({ ...valid, weeklyLimit: "3000000000" }, [])).toMatchObject({ ok: false, errors: { weeklyLimit: expect.any(String) } });
    expect(validateEventType({ ...valid, minNoticeMinutes: "3000000000", cancelCutoffMinutes: "3000000000", dailyLimit: "3000000000" }, []))
      .toMatchObject({ ok: false, errors: { minNoticeMinutes: expect.any(String), cancelCutoffMinutes: expect.any(String), dailyLimit: expect.any(String) } });
    expect(validateEventType({ ...valid, weeklyLimit: "0" }, [])).toMatchObject({ ok: false, errors: { weeklyLimit: expect.any(String) } });
    expect(validateEventType({ ...valid, cancelPolicy: "x".repeat(1001) }, [])).toMatchObject({ ok: false, errors: { cancelPolicy: expect.any(String) } });
  });

  it("takes an https page to send guests to after booking, and nothing else", () => {
    // Guests per session: blank or 1 is one-on-one, 2 to 500 makes it a group class, which can't take payment or repeat.
    expect(validateEventType({ ...valid, seats: "1" }, [])).toMatchObject({ ok: true, value: { seatLimit: null } });
    expect(validateEventType({ ...valid, seats: "12" }, [])).toMatchObject({ ok: true, value: { seatLimit: 12 } });
    expect(validateEventType({ ...valid, seats: "501" }, [])).toMatchObject({ ok: false, errors: { seats: expect.any(String) } });
    expect(validateEventType({ ...valid, seats: "12", price: "500" }, [])).toMatchObject({ ok: false });
    expect(validateEventType({ ...valid, redirectUrl: "https://priya.coach/thanks" }, [])).toMatchObject({ ok: true, value: { redirectUrl: "https://priya.coach/thanks" } });
    expect(validateEventType({ ...valid, redirectUrl: "javascript:alert(1)" }, [])).toMatchObject({ ok: false, errors: { redirectUrl: expect.any(String) } });
  });

  it("carries the 'only people with the link' choice, and refuses anything but true or false", () => {
    const hidden = validateEventType({ ...valid, hidden: true }, []);
    expect(hidden.ok && hidden.value.hidden).toBe(true);
    const bad = validateEventType({ ...valid, hidden: "yes" as unknown as boolean }, []);
    expect(bad).toEqual({ ok: false, errors: { hidden: "Choose whether it shows on your booking page." } });
  });

  it.each([
    ["", null, null], ["  ", null, null], ["499", 49900, "INR"], ["499.5", 49950, "INR"], ["499.50", 49950, "INR"], ["1", 100, "INR"],
    ["500000", 50_000_000, "INR"],
  ] as const)("reads price %j as %j paise", (price, priceMinor, currency) => {
    const value = draft({ price });
    expect([value.priceMinor, value.currency]).toEqual([priceMinor, currency]);
  });

  it.each(["0", "0.99", "-1", "abc", "1.234", "5000001", "500000.01", "1,000", ".5", "1e3"])("rejects price %j", (price) => {
    const result = validateEventType({ ...valid, price }, []);
    expect(result).toEqual({ ok: false, errors: { price: PRICE_INVALID } });
  });

  it("shows a saved price back as rupees", () => {
    expect([priceInput(null), priceInput(49900), priceInput(49950), priceInput(49905), priceInput(100)]).toEqual(["", "499", "499.50", "499.05", "1"]);
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

describe("validateEventType input checks", () => {
  it("rejects a location kind outside the list without throwing", () => {
    const result = validateEventType({ ...valid, locationKind: "evil" as unknown as EventTypeForm["locationKind"] }, []);
    expect(result).toEqual({ ok: false, errors: { locationKind: "Pick a location from the list." } });
  });

  it("rejects a non-string field without throwing", () => {
    const result = validateEventType({ ...valid, name: 123 as unknown as string }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeTruthy();
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
    expect(await store.listEventLocations(host.id, created.id)).toMatchObject([{ kind: "in_person", value: "MG Road office" }]);
    await expect(store.createEventType(host.id, draft())).rejects.toThrow(SLUG_TAKEN);
    await expect(store.updateEventType(host.id, created.id, draft({ slug: "coaching" }))).rejects.toThrow(SLUG_TAKEN);

    await store.updateEventType(host.id, created.id, draft({ durationMinutes: "60", locationKind: "" }));
    expect(await store.getEventType(host.id, created.id)).toMatchObject({ durationMinutes: 60, slug: "strategy" });
    expect(await store.listEventLocations(host.id, created.id)).toEqual([]);

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
    await store.saveQuestions("usr_priya", "evt_coaching", checked.value);

    const back = await store.listCustomQuestions("usr_priya", "evt_coaching");
    expect(back.map((q) => [q.label, q.required, q.position])).toEqual([
      ["Company name", false, 0],
      ["What would you like to work on?", true, 1],
      ["How did you hear about me?", true, 2],
    ]);
    expect(back[1].id).toBe("q_goal");
    expect(back[2].choices).toEqual(["Friend", "LinkedIn"]);
    expect(await store.listCustomQuestions("usr_priya", "evt_intro")).toEqual([]);
  });
});

describe("no-show deposit", () => {
  it("is for free events, without weekly repeats", () => {
    expect(validateEventType({ ...valid, deposit: "200" }, [])).toMatchObject({ ok: true, value: { depositMinor: 20_000, priceMinor: null } });
    expect(validateEventType({ ...valid, deposit: "200", price: "499" }, [])).toMatchObject({ ok: false, errors: { deposit: expect.stringContaining("priced") } });
    expect(validateEventType({ ...valid, deposit: "200", maxRepeats: "4" }, [])).toMatchObject({ ok: false, errors: { maxRepeats: expect.stringContaining("deposit") } });
    expect(validateEventType({ ...valid, deposit: "0.5" }, [])).toMatchObject({ ok: false, errors: { deposit: expect.any(String) } });
  });
});
