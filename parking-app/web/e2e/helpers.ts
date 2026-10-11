import { expect, type Page } from "@playwright/test";
import { createHash, createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import { E2E } from "./env";

/** A fresh valid mobile number per test, so the 5-OTPs-per-hour limit never bites. */
export const freshPhone = () => "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");

async function q<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: E2E.dbUrl });
  await c.connect();
  try { return (await c.query(sql, args)).rows as T[]; } finally { await c.end(); }
}

/**
 * Plays the SMS: once the app has requested a code, store a known one as the newest code for
 * that phone (same hash the API uses). Returns the code to type.
 */
export async function knownOtp(phone: string): Promise<string> {
  const e164 = "+91" + phone;
  await expect.poll(async () => (await q<{ n: number }>("SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1", [e164]))[0].n).toBeGreaterThan(0);
  const code = String(100000 + Math.floor(Math.random() * 900000));
  await q(`INSERT INTO otp_codes (phone, code_hash, expires_at, created_at) VALUES ($1, $2, now() + interval '5 minutes', now() + interval '1 second')`,
    [e164, createHash("sha256").update(e164 + code).digest("hex")]);
  return code;
}

/** Plays Razorpay's server: a signed payment.captured webhook for the order the app opened. */
export async function capture(orderId: string, amount: number) {
  const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_" + randomBytes(6).toString("hex"), order_id: orderId, amount, method: "upi", fee: 300 } } } });
  const res = await fetch(`${E2E.apiUrl}/v1/webhooks/razorpay`, {
    method: "POST", body: raw,
    headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", E2E.webhookSecret).update(raw).digest("hex"), "x-razorpay-event-id": "evt_" + randomBytes(6).toString("hex") }
  });
  expect(res.status).toBe(200);
  expect((await res.json()).result).toBe("captured");
}

/** Pays in the test gateway and returns the order the API created. */
export async function payInTestGateway(page: Page) {
  const dlg = page.getByRole("dialog", { name: /^Pay ₹/ });
  await expect(dlg).toBeVisible();
  const orderId = (await dlg.getAttribute("data-order-id"))!;
  const amount = Number(await dlg.getAttribute("data-amount"));
  await dlg.getByRole("button", { name: /^Pay ₹/ }).click();
  return { orderId, amount };
}

/** Fills the checkout form, pays, passes OTP and returns the gateway order. */
export async function checkout(page: Page, opts: { plate: string; phone: string }) {
  await page.getByLabel("Vehicle number").fill(opts.plate);
  await page.getByLabel("Mobile for WhatsApp pass").fill(opts.phone);
  await page.getByRole("button", { name: /^Pay ₹.* and get pass$/ }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  await page.getByLabel("Code from SMS").fill(await knownOtp(opts.phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  return payInTestGateway(page);
}
