// Automatic WhatsApp (D7): the message we send, and (with TEST_DATABASE_URL, own database <name>_wa) who gets it and when.
import { createHmac } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { seed } from "../../scripts/seed";
import { validateBookingRequest } from "./booking";
import { createPgStore } from "./data/pg-store";
import type { DataStore, EventType, User } from "./data/types";
import { processDueNotifications } from "./jobs/worker";
import type { Mail } from "./mail/mailer";
import { isStop, templateMessage, verifyWebhookSignature, whatsappConfig, type WhatsAppConfig } from "./whatsapp-cloud";
import { handleWhatsAppWebhook, verifyWhatsAppSubscription } from "./whatsapp-webhook";

const BASE = process.env.TEST_DATABASE_URL;
const ctx = { guestName: "Kiran\nRao", hostName: "Priya Raman", eventName: "Coaching", startAt: new Date("2031-05-01T05:00:00Z"), guestTimezone: "Asia/Kolkata", locale: "en", manageToken: "tok123" };
const cfg: WhatsAppConfig = { phoneNumberId: "555", accessToken: "test-access", appSecret: "test-app-secret", verifyToken: "verify-me", baseUrl: "https://graph.test" };
const sign = (body: string) => `sha256=${createHmac("sha256", cfg.appSecret).update(body).digest("hex")}`;

describe("WhatsApp messages", () => {
  it("fills the approved template: first name, event, host, time in the guest's zone, and the manage link button", () => {
    const m = templateMessage("booked_guest", ctx, "919876543210");
    expect(m.to).toBe("919876543210");
    expect(m.template.name).toBe("hh_booking_confirmed");
    expect(m.template.language.code).toBe("en");
    const [body, button] = m.template.components;
    expect(body.parameters.map((p) => p.text)).toEqual(["Kiran", "Coaching", "Priya Raman", expect.stringMatching(/1 May 2031, 10:30 am IST$/i)]);
    expect(button).toMatchObject({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "tok123" }] });
  });

  it("writes Hindi for a Hindi booking, English for languages without approved templates yet, and what changed", () => {
    expect(templateMessage("reminder_guest", { ...ctx, locale: "hi" }, "91").template.language.code).toBe("hi");
    expect(templateMessage("reminder_guest", { ...ctx, locale: "ta" }, "91").template.language.code).toBe("en");
    const cancelled = templateMessage("cancelled_guest", ctx, "91").template;
    expect(cancelled.name).toBe("hh_booking_changed");
    expect(cancelled.components[0].parameters[3].text).toBe("it has been cancelled");
    expect(templateMessage("rescheduled_guest", { ...ctx, locale: "hi" }, "91").template.components[0].parameters[3].text).toMatch(/^अब यह .* को है$/);
  });

  it("never puts a line break or a long run of spaces into a template variable", () => {
    const m = templateMessage("booked_guest", { ...ctx, eventName: "Deep\n\nwork     session\t1" }, "91");
    expect(m.template.components[0].parameters[1].text).toBe("Deep work session 1");
  });

  it("is off unless all four settings are there, and only tests may point it at another server", () => {
    const env = { WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_APP_SECRET: "s", WHATSAPP_VERIFY_TOKEN: "v" };
    expect(whatsappConfig({ ...env, WHATSAPP_VERIFY_TOKEN: undefined })).toBeNull();
    expect(whatsappConfig({ ...env, NODE_ENV: "production", WHATSAPP_API_BASE_URL: "http://evil.test" })!.baseUrl).toBe("https://graph.facebook.com");
    expect(whatsappConfig({ ...env, NODE_ENV: "production", HOURHAND_E2E: "1", WHATSAPP_API_BASE_URL: "http://127.0.0.1:9" })!.baseUrl).toBe("http://127.0.0.1:9");
  });

  it("checks Meta's signature and the subscription handshake, and knows a STOP", () => {
    expect(verifyWebhookSignature(cfg.appSecret, "{}", sign("{}"))).toBe(true);
    expect(verifyWebhookSignature(cfg.appSecret, "{}", sign("{ }"))).toBe(false);
    expect(verifyWebhookSignature(cfg.appSecret, "{}", null)).toBe(false);
    const q = (token: string) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "42" });
    expect(verifyWhatsAppSubscription(cfg, q("verify-me"))).toEqual({ status: 200, body: "42" });
    expect(verifyWhatsAppSubscription(cfg, q("wrong")).status).toBe(403);
    expect(["STOP", " stop ", "Unsubscribe"].every(isStop)).toBe(true);
    expect(isStop("please stop by at 5")).toBe(false);
  });

  it("asks for a usable number when the guest ticks WhatsApp", () => {
    const req = { slug: "priya", event: "coaching", start: "2031-04-01T05:00:00.000Z", name: "Kiran", email: "kiran@example.in", timezone: "Asia/Kolkata", idempotencyKey: "wa-key-1" };
    expect(validateBookingRequest({ ...req, whatsappOptIn: true })).toMatchObject({ ok: false, fields: { phone: expect.any(String) } });
    expect(validateBookingRequest({ ...req, whatsappOptIn: true, phone: "12345678" })).toMatchObject({ ok: false, fields: { phone: expect.any(String) } });
    expect(validateBookingRequest({ ...req, whatsappOptIn: true, phone: "98765 43210" })).toMatchObject({ ok: true, value: { whatsappOptIn: true } });
    expect(validateBookingRequest({ ...req, phone: "98765 43210" })).toMatchObject({ ok: true, value: { whatsappOptIn: false } });
  });
});

describe.skipIf(!BASE)("WhatsApp sending (Postgres)", () => {
  let pool: pg.Pool;
  let store: DataStore;
  let priya: User;
  let coaching: EventType;
  let n = 0;
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  let reply: () => Response = () => Response.json({ messages: [{ id: `wamid.${sent.length}` }] });
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return reply();
  }) as unknown as typeof fetch;
  const mailer = { async send(m: Mail) { void m; return { id: "mail" }; } };
  const run = (now = new Date()) => processDueNotifications(pool, mailer, { baseUrl: "https://hourhand.test", now, whatsapp: cfg, fetch: fakeFetch });
  const plan = (p: string) => pool.query("insert into subscriptions (user_id, plan, status) values ($1, $2, 'active') on conflict (user_id) do update set plan = $2, status = 'active'", [priya.id, p]);
  const book = async (opts: { phone?: string | null; optIn?: boolean; days?: number } = {}) => {
    n++;
    return store.createBooking({
      eventTypeId: coaching.id, startAt: new Date(Date.now() + (opts.days ?? 3) * 86_400_000 + n * 3 * 3_600_000), idempotencyKey: `wa-${n}`,
      invitee: { name: "Kiran Rao", email: `kiran${n}@example.in`, timezone: "Asia/Kolkata", phone: opts.phone === undefined ? "+91 98765 43210" : opts.phone, answers: [], whatsappOptIn: opts.optIn ?? true },
    });
  };
  const waRows = async (bookingId: string) =>
    (await pool.query("select kind, recipient, status, last_error, provider_message_id from notifications where booking_id = $1 and channel = 'whatsapp' order by kind", [bookingId])).rows;

  beforeAll(async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = cfg.phoneNumberId;
    process.env.WHATSAPP_ACCESS_TOKEN = cfg.accessToken;
    process.env.WHATSAPP_APP_SECRET = cfg.appSecret;
    process.env.WHATSAPP_VERIFY_TOKEN = cfg.verifyToken;
    const u = new URL(BASE!);
    const name = `${u.pathname.slice(1)}_wa`;
    if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`TEST_DATABASE_URL must name a test database, got "${name}"`);
    u.pathname = `/${name}`;
    const admin = new URL(BASE!);
    admin.pathname = "/postgres";
    const c = new pg.Client({ connectionString: admin.toString() });
    await c.connect();
    try {
      await c.query(`drop database if exists ${name} with (force)`);
      await c.query(`create database ${name}`);
    } finally {
      await c.end();
    }
    await migrate(u.toString());
    await seed(u.toString());
    pool = new pg.Pool({ connectionString: u.toString() });
    store = createPgStore(pool);
    priya = (await store.getUserBySlug("priya"))!;
    coaching = (await store.listEventTypes(priya.id)).find((e) => e.slug === "coaching")!;
  });

  afterAll(async () => {
    for (const k of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]) delete process.env[k];
    await pool?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
    reply = () => Response.json({ messages: [{ id: `wamid.${sent.length}` }] });
    await pool.query("delete from notifications");
    await pool.query("delete from whatsapp_opt_outs");
    await plan("solo");
  });

  it("queues the confirmation and the day-ahead reminder for a guest who ticked it, and sends them as templates", async () => {
    const b = await book();
    expect((await waRows(b.id)).map((r) => [r.kind, r.recipient])).toEqual([["booked_guest", "919876543210"], ["reminder_guest", "919876543210"]]);
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://graph.test/v23.0/555/messages");
    expect(sent[0].body).toMatchObject({ to: "919876543210", template: { name: "hh_booking_confirmed" } });
    expect((await waRows(b.id)).find((r) => r.kind === "booked_guest")).toMatchObject({ status: "sent", provider_message_id: "wamid.1" });
  });

  it("queues nothing without the tick, without a phone, or for a number that replied STOP", async () => {
    expect(await waRows((await book({ optIn: false })).id)).toEqual([]);
    expect(await waRows((await book({ phone: null })).id)).toEqual([]);
    await pool.query("insert into whatsapp_opt_outs (phone) values ('919876543210')");
    expect(await waRows((await book()).id)).toEqual([]);
  });

  it("tells the guest when the booking is cancelled, and drops the reminder", async () => {
    const b = await book();
    await store.cancelBooking(priya.id, b.id, "host");
    const rows = await waRows(b.id);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["booked_guest", "skipped"], ["cancelled_guest", "queued"], ["reminder_guest", "skipped"]]);
    await run();
    expect(sent.map((s) => (s.body.template as { name: string }).name)).toEqual(["hh_booking_changed"]);
  });

  it("sends nothing for a host on the free plan, and stops at the monthly limit", async () => {
    await plan("free");
    const b = await book();
    await run();
    expect(sent).toHaveLength(0);
    expect((await waRows(b.id))[0]).toMatchObject({ status: "skipped", last_error: "the host's plan doesn't include WhatsApp" });

    await plan("solo");
    await pool.query(
      `insert into notifications (user_id, channel, kind, recipient, send_at, status, sent_at, dedupe_key)
       select $1, 'whatsapp', 'booked_guest', '91', now(), 'sent', now(), 'filler:' || g from generate_series(1, 300) g`, [priya.id]);
    const c = await book();
    await run();
    expect(sent).toHaveLength(0);
    expect((await waRows(c.id))[0]).toMatchObject({ status: "skipped", last_error: "monthly WhatsApp limit reached (300)" });
  });

  it("retries when Meta is down, and gives up on a number WhatsApp refuses", async () => {
    const b = await book();
    reply = () => Response.json({ error: { code: 1 } }, { status: 503 });
    await run();
    expect((await waRows(b.id))[0]).toMatchObject({ status: "queued", last_error: "WhatsApp 503 (code 1)" });
    reply = () => Response.json({ error: { code: 131026 } }, { status: 400 });
    await pool.query("update notifications set send_at = now() where booking_id = $1", [b.id]);
    await run();
    expect((await waRows(b.id))[0]).toMatchObject({ status: "failed", last_error: "WhatsApp 400 (code 131026)" });
  });

  it("STOP opts the number out for every host, drops queued messages and confirms once; a failed delivery is recorded", async () => {
    const b = await book();
    await run();
    const stop = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "919876543210", type: "text", text: { body: "STOP" } }] } }] }] });
    expect((await handleWhatsAppWebhook(pool, cfg, stop, sign("x"), fakeFetch)).status).toBe(401);
    expect((await handleWhatsAppWebhook(pool, cfg, stop, sign(stop), fakeFetch)).status).toBe(200);
    await handleWhatsAppWebhook(pool, cfg, stop, sign(stop), fakeFetch);
    expect((await pool.query("select phone from whatsapp_opt_outs")).rows).toEqual([{ phone: "919876543210" }]);
    expect((await waRows(b.id)).find((r) => r.kind === "reminder_guest")).toMatchObject({ status: "skipped", last_error: "guest replied STOP on WhatsApp" });
    expect(sent.filter((s) => s.body.type === "text")).toHaveLength(1);

    const failed = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "failed", errors: [{ code: 131049 }] }] } }] }] });
    await handleWhatsAppWebhook(pool, cfg, failed, sign(failed), fakeFetch);
    expect((await waRows(b.id)).find((r) => r.kind === "booked_guest")).toMatchObject({ status: "failed", last_error: "WhatsApp delivery failed (code 131049)" });
  });
});
