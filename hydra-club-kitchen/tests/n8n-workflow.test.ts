import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { signPayload } from "../src/lib/notify";

/**
 * Runs the workflow's Code-node scripts outside n8n with stubbed n8n globals,
 * proving the signature check accepts exactly what the site sends.
 */
type Node = { name: string; type: string; parameters: { jsCode?: string } };
const wf = JSON.parse(readFileSync(new URL("../n8n/hydra-booking-notify.json", import.meta.url), "utf8")) as {
  nodes: Node[];
  connections: Record<string, { main: { node: string }[][] }>;
};
const code = (name: string) => wf.nodes.find((n) => n.name === name)!.parameters.jsCode!;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const nodeRequire = createRequire(import.meta.url);

function runCode(name: string, globals: Record<string, unknown>, self: unknown = {}) {
  const fn = new AsyncFunction("require", ...Object.keys(globals), code(name));
  return fn.call(self, nodeRequire, ...Object.values(globals)) as Promise<{ json: Record<string, unknown> }[]>;
}

const SECRET = "test-webhook-secret";
const booking = {
  ref: "HYD-AB23", status: "pending", table: "VIP-1", zone: "vip", service_date: "2026-12-04", time: "21:00",
  starts_at: "2026-12-04T15:30:00.000Z", ends_at: "2026-12-04T17:30:00.000Z", guests: 6, name: "Asha", phone_e164: "+919876543210", notes: null,
};
const body = JSON.stringify({ id: "x", type: "booking.created", occurred_at: "2026-12-01T00:00:00Z", booking });

const verify = (raw: string, signature: string, secret = SECRET) =>
  runCode(
    "Verify signature",
    { $env: { HYDRA_WEBHOOK_SECRET: secret }, $input: { first: () => ({ json: { headers: { "x-hydra-signature": signature } } }) } },
    { helpers: { getBinaryDataBuffer: async () => Buffer.from(raw, "utf8") } },
  );

describe("n8n workflow", () => {
  it("every connection points at a node that exists", () => {
    const names = new Set(wf.nodes.map((n) => n.name));
    for (const [from, out] of Object.entries(wf.connections)) {
      expect(names.has(from)).toBe(true);
      for (const branch of out.main) for (const c of branch) expect(names.has(c.node)).toBe(true);
    }
  });

  it("accepts the site's signature and parses the event", async () => {
    const [r] = await verify(body, signPayload(SECRET, body, Math.floor(Date.now() / 1000)));
    expect(r!.json.valid).toBe(true);
    expect(r!.json.event).toMatchObject({ type: "booking.created", booking: { ref: "HYD-AB23" } });
  });

  it("rejects a tampered body, a wrong secret, a stale timestamp and a missing header", async () => {
    const now = Math.floor(Date.now() / 1000);
    const sig = signPayload(SECRET, body, now);
    expect((await verify(body.replace("Asha", "Mallory"), sig))[0]!.json.valid).toBe(false);
    expect((await verify(body, sig, "other-secret"))[0]!.json.valid).toBe(false);
    expect((await verify(body, signPayload(SECRET, body, now - 600)))[0]!.json.valid).toBe(false);
    expect((await verify(body, ""))[0]!.json).toEqual({ valid: false, event: null });
  });

  it("builds one alert per host plus the guest template, with Telegram fallback text", async () => {
    const event = JSON.parse(body);
    const items = await runCode("Build messages", {
      $env: { HOST_WHATSAPP_NUMBERS: "+919000000001, +919000000002" },
      $: () => ({ first: () => ({ json: { event } }) }),
    });
    expect(items.map((i) => i.json.audience)).toEqual(["host", "host", "guest"]);
    const guest = items[2]!.json.wa as { to: string; template: { name: string; components: { parameters: { text: string }[] }[] } };
    expect(guest.to).toBe("919876543210");
    expect(guest.template.name).toBe("hydra_booking_received");
    expect(guest.template.components[0]!.parameters.map((p) => p.text)).toEqual(["Asha", "HYD-AB23", expect.stringContaining("9:00"), "VIP-1", "6"]);
    expect(String(items[0]!.json.fallbackText)).toContain("NEW HYD-AB23");
    expect(String(items[0]!.json.fallbackText)).not.toContain("\n"); // WhatsApp template params can't hold newlines
  });

  it("with no host numbers set, still routes the alert to Telegram", async () => {
    const event = { ...JSON.parse(body), type: "booking.no_show" };
    const items = await runCode("Build messages", { $env: {}, $: () => ({ first: () => ({ json: { event } }) }) });
    expect(items).toEqual([{ json: { audience: "none", wa: null, fallbackText: expect.stringContaining("No WhatsApp host numbers set") } }]);
  });
});
