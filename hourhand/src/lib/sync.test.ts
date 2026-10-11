import { describe, expect, it } from "vitest";
import { summarizeSync } from "./sync";

const now = new Date("2026-10-12T10:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

describe("summarizeSync", () => {
  it("reports ok with minutes since the oldest sync", () => {
    expect(summarizeSync([{ status: "ok", lastSyncedAt: ago(2) }, { status: "ok", lastSyncedAt: ago(7) }], now))
      .toEqual({ status: "ok", minutesAgo: 7 });
  });

  it("reports degraded when a sync is stale or slow", () => {
    expect(summarizeSync([{ status: "ok", lastSyncedAt: ago(16) }], now).status).toBe("degraded");
    expect(summarizeSync([{ status: "degraded", lastSyncedAt: ago(1) }], now).status).toBe("degraded");
  });

  it("reports disconnected when any connection is down, or none exist", () => {
    expect(summarizeSync([{ status: "ok", lastSyncedAt: ago(1) }, { status: "disconnected", lastSyncedAt: null }], now))
      .toEqual({ status: "disconnected", minutesAgo: null });
    expect(summarizeSync([], now).status).toBe("disconnected");
  });
});
