import { describe, expect, it } from "vitest";
import { clientKey, sessionNumber, summarizeClients } from "./clients";
import { createMemoryStore } from "./data/memory-store";
import { buildSeed } from "./data/seed";
import type { BookingWithInvitee } from "./data/types";

const now = new Date("2026-10-10T04:00:00Z");
const H = 3_600_000;
let n = 0;
function b(email: string, startH: number, o: Partial<BookingWithInvitee> & { name?: string; noShow?: boolean; phone?: string | null } = {}): BookingWithInvitee {
  n += 1;
  const start = new Date(now.getTime() + startH * H);
  return {
    id: `b${n}`, eventTypeId: "e", hostId: "h", startAt: start, endAt: new Date(start.getTime() + H), bufferedStart: start, bufferedEnd: start, status: "confirmed",
    holdExpiresAt: null, locationKind: null, joinUrl: null, idempotencyKey: `k${n}`, cancelledAt: null, cancelledBy: null, cancelReason: null, rescheduledFromId: null,
    seriesId: null, seriesIndex: null, createdAt: new Date(now.getTime() + n), ...o,
    invitee: { id: `i${n}`, bookingId: `b${n}`, hostId: "h", name: o.name ?? "Meera", email, timezone: "Asia/Kolkata", phone: o.phone ?? null, answers: [], manageToken: `t${n}`,
      noShowAt: o.noShow ? now : null, runningLateMinutes: null, runningLateAt: null, guests: [], locale: "en" },
  };
}

describe("clients", () => {
  it("groups by email in any case, counts sessions, no-shows and cancels, and shows the latest name and phone", () => {
    const list = [
      b("meera@example.com", -48, { name: "Meera I", phone: "+91 98765 43210" }),
      b("MEERA@example.com", -24, { name: "Meera Iyer", noShow: true }),
      b("meera@example.com", 24, { name: "Meera Iyer" }),
      b("meera@example.com", 30, { status: "cancelled", cancelledBy: "guest", cancelledAt: now }),
      b("ravi@example.com", -100),
      b("held@example.com", 5, { status: "pending_payment" }),
      b("lapsed@example.com", 5, { status: "cancelled", cancelledBy: "system", cancelledAt: now }),
    ];
    const clients = summarizeClients(list, now);
    expect(clients.map((c) => c.email.toLowerCase())).toEqual(["meera@example.com", "ravi@example.com"]);
    expect(clients[0]).toMatchObject({ sessions: 3, upcoming: 1, noShows: 1, cancelled: 1, phone: "+91 98765 43210", key: clientKey("Meera@Example.com") });
    expect(clients[0].nextAt!.getTime()).toBe(now.getTime() + 24 * H);
    expect(clients[0].lastAt!.getTime()).toBe(now.getTime() - 24 * H);
    expect(sessionNumber(list, list[2])).toBe(3);
    expect(sessionNumber(list, list[3])).toBe(0);
  });

  it("puts clients with a session coming up first, soonest first, then the rest by most recent", () => {
    const clients = summarizeClients([b("old@x.in", -500), b("later@x.in", 50), b("recent@x.in", -5), b("soon@x.in", 3)], now);
    expect(clients.map((c) => c.email)).toEqual(["soon@x.in", "later@x.in", "recent@x.in", "old@x.in"]);
  });

  it("keeps a private note per client, any email case, and an empty note removes it", async () => {
    const store = createMemoryStore(buildSeed(now));
    await store.saveClientNote("usr_priya", "Meera@Example.com", "Working on interview prep.");
    expect(await store.getClientNote("usr_priya", "meera@example.com")).toBe("Working on interview prep.");
    expect(await store.getClientNote("usr_arun", "meera@example.com")).toBe("");
    await store.saveClientNote("usr_priya", "meera@example.com", "  ");
    expect(await store.getClientNote("usr_priya", "meera@example.com")).toBe("");
  });
});
