import { describe, expect, it } from "vitest";
import { createMailer, MailError, resendMailer } from "./mailer";

const KEY = "re_fake_for_tests";
const mail = { to: "meera@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "notification-1", replyTo: "priya@example.com",
  attachments: [{ filename: "booking.ics", content: "QkVHSU4=", contentType: "text/calendar" }] };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("resendMailer", () => {
  it("posts the message to Resend with the key, the idempotency key and Resend's field names", async () => {
    const f = fakeFetch(200, { id: "re_123" });
    const out = await resendMailer(KEY, "Hourhand <bookings@mail.example.com>", f.impl).send(mail);
    expect(out).toEqual({ id: "re_123" });
    expect(f.calls[0].url).toBe("https://api.resend.com/emails");
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers["idempotency-key"]).toBe("notification-1");
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body).toMatchObject({ from: "Hourhand <bookings@mail.example.com>", to: ["meera@example.com"], subject: "Hi", reply_to: "priya@example.com" });
    expect(body.attachments).toEqual([{ filename: "booking.ics", content: "QkVHSU4=", content_type: "text/calendar" }]);
  });

  it.each([[429, "rate_limit_exceeded", true], [500, "application_error", true], [503, "service_unavailable", true],
    [409, "concurrent_idempotent_requests", true], [409, "invalid_idempotent_request", false],
    [422, "validation_error", false], [403, "validation_error", false], [400, "validation_error", false]])("status %i %s is retryable: %s", async (status, name, retryable) => {
    const f = fakeFetch(status, { name, message: "nope" });
    const err = await resendMailer(KEY, "a@b.c", f.impl).send(mail).catch((e) => e);
    expect(err).toBeInstanceOf(MailError);
    expect(err.retryable).toBe(retryable);
    expect(err.message).toContain(String(status));
    expect(err.message).not.toContain(KEY);
  });

  it("treats a network failure as retryable", async () => {
    const impl = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const err = await resendMailer(KEY, "a@b.c", impl).send(mail).catch((e) => e);
    expect(err).toBeInstanceOf(MailError);
    expect(err.retryable).toBe(true);
  });
});

describe("createMailer", () => {
  it("refuses to run in production without a key, so email can't silently go nowhere", () => {
    expect(() => createMailer({ NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
  });
  it("needs a sender address with a key", () => {
    expect(() => createMailer({ RESEND_API_KEY: KEY })).toThrow(/EMAIL_FROM/);
  });
  it("logs in development, and in a production build only with HOURHAND_MAIL_TO_LOG=1", () => {
    expect(createMailer({ NODE_ENV: "development" })).toBeTruthy();
    expect(createMailer({ NODE_ENV: "production", HOURHAND_MAIL_TO_LOG: "1" })).toBeTruthy();
  });
});
