import { expect, test } from "@playwright/test";
import { E2E } from "./env";
import { bookingCount, capture, checkout, freshPhone, knownOtp, payInTestGateway } from "./helpers";

// Runs at 390 px (phone) and 1280 px (desktop): see the projects in the config.

test("happy path: search → lot → checkout → pass (DRV-01, 02, 04, GST-01, DRV-10)", async ({ page }) => {
  await page.goto("/?area=mg-road");
  await expect(page.getByRole("heading", { level: 1, name: /Car parking near MG Road · 3 h/ })).toBeVisible();

  const lot = page.getByRole("link", { name: /MG Road Metro Multilevel/ }).first();
  await expect(lot).toContainText("₹159.30"); // 3 h × ₹40 + ₹15 fee + 18% GST, priced by the API
  await lot.click();

  await expect(page.getByRole("heading", { level: 1, name: "MG Road Metro Multilevel" })).toBeVisible();
  const bill = page.getByTestId("bill");
  await expect(bill).toContainText("Parking · 3 h at ₹40/hr");
  await expect(bill).toContainText("GST 18%");
  await expect(page.getByTestId("total")).toHaveText("₹159.30");

  const { orderId, amount } = await checkout(page, { plate: "KA 01 AB 1234", phone: freshPhone() });
  expect(amount).toBe(15930);

  // The browser says "paid" before the webhook lands: the pass page must wait, not show a pass.
  await expect(page.getByRole("heading", { name: "Confirming payment…" })).toBeVisible();
  await capture(orderId, amount); // webhook arrives late
  const pass = page.getByTestId("pass");
  await expect(pass).toBeVisible();
  await expect(pass).toHaveAttribute("data-code", /^BL-[A-Z0-9]{5}$/);
  await expect(pass).toContainText("Starts in");
  await expect(pass).toContainText("KA01AB1234");
  await expect(pass).toContainText("₹159.30");
  await expect(page.getByRole("img", { name: /Entry QR code for pass BL-/ })).toBeVisible();

  // The pass is listed under My passes too.
  await page.getByRole("link", { name: /^(My passes|Passes)$/ }).filter({ visible: true }).click();
  await expect(page.getByTestId("pass")).toHaveCount(1);
});

test("Park now: lot code from the board, live pass (DRV-09)", async ({ page }) => {
  await page.goto("/park-now?area=mg-road");
  await page.getByLabel("Lot code").fill("blr 999");
  await page.getByRole("button", { name: "Continue to pay" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No lot with code BLR999" })).toBeVisible();

  await page.getByLabel("Lot code").fill("blr-101");
  await page.getByRole("button", { name: "1 h" }).click();
  await page.getByRole("button", { name: "Continue to pay" }).click();

  await expect(page.getByText("Park now", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Now · /)).toBeVisible();
  await expect(page.getByTestId("bill")).toContainText("Parking · 1 h at ₹40/hr");
  await expect(page.getByTestId("total")).toHaveText("₹64.90"); // ₹40 + ₹15 + 18% GST

  const { orderId, amount } = await checkout(page, { plate: "KA 05 MN 4821", phone: freshPhone() });
  expect(amount).toBe(6490);
  await capture(orderId, amount);
  const pass = page.getByTestId("pass");
  await expect(pass).toContainText("Live · ends in");
  await expect(pass).toContainText("Park now");
  await expect(pass.getByRole("button", { name: "Cancel free" })).toHaveCount(0); // DRV-12: Park now can't be cancelled
});

test("promo code: errors, FIRST50 discount carried into the payment (DRV-06)", async ({ page }) => {
  await page.goto("/?area=mg-road");
  await page.getByRole("link", { name: /MG Road Metro Multilevel/ }).first().click();
  await expect(page.getByTestId("total")).toHaveText("₹159.30");

  await page.getByLabel("Promo code").fill("nope");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "NOPE isn't a valid code. Check the spelling, or try FIRST50." })).toBeVisible();
  await expect(page.getByTestId("total")).toHaveText("₹159.30");

  await page.getByLabel("Promo code").fill("first50");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("FIRST50 applied. You save ₹60.")).toBeVisible();
  const bill = page.getByTestId("bill");
  await expect(bill).toContainText("Promo FIRST50");
  await expect(page.getByTestId("total")).toHaveText("₹88.50"); // (120 − 60 + 15) × 1.18

  const { orderId, amount } = await checkout(page, { plate: "KA 03 CD 5678", phone: freshPhone() });
  expect(amount).toBe(8850);
  await capture(orderId, amount);
  await expect(page.getByTestId("pass")).toContainText("₹88.50 · FIRST50");
});

test("failed and cancelled payments say nothing was charged (DRV-04)", async ({ page }) => {
  await page.goto("/?area=mg-road");
  await page.getByRole("link", { name: /Brigade Road Basement P1/ }).first().click();
  await page.getByLabel("Vehicle number").fill("KA 02 EF 9012");
  const phone = freshPhone();
  await page.getByLabel("Mobile for WhatsApp pass").fill(phone);
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
  await page.getByLabel("Code from SMS").fill(await knownOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Simulate a failed payment" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Payment didn't go through. You weren't charged." })).toBeVisible();

  await page.getByRole("button", { name: /^Pay ₹/ }).click(); // signed in now: straight to the gateway
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Payment cancelled. You weren't charged." })).toBeVisible();

  // Paying again reuses the same Idempotency-Key: one booking (one held bay), not one per attempt.
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
  const { orderId, amount } = await payInTestGateway(page);
  await capture(orderId, amount);
  await expect(page.getByTestId("pass")).toBeVisible();
  expect(await bookingCount(phone)).toBe(1);
});

test("Razorpay: a failed attempt then a successful retry in the same modal is a success (no double charge)", async ({ page }) => {
  // Make the app take the real-Razorpay branch: rewrite the key on the booking response, and serve
  // a stand-in checkout.js that fails once, then succeeds, the way Razorpay's retry works.
  await page.route(`${E2E.apiUrl}/v1/bookings`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const res = await route.fetch();
    const json = await res.json();
    if (json.razorpay_order) json.razorpay_order.key_id = "rzp_test_e2e_stub";
    await route.fulfill({ response: res, json });
  });
  await page.route("https://checkout.razorpay.com/v1/checkout.js", route => route.fulfill({ contentType: "text/javascript", body: `
    window.Razorpay = function (o) { this.o = o; this.h = {}; };
    window.Razorpay.prototype.on = function (e, f) { this.h[e] = f; };
    window.Razorpay.prototype.open = function () {
      var s = this; window.__rzp = { order_id: s.o.order_id, amount: s.o.amount };
      setTimeout(function () {
        if (s.h["payment.failed"]) s.h["payment.failed"]({ error: { description: "declined" } });
        setTimeout(function () { s.o.handler({ razorpay_payment_id: "pay_retry" }); }, 150);
      }, 150);
    };` }));

  await page.goto("/?area=mg-road");
  await page.getByRole("link", { name: /MG Road Metro Multilevel/ }).first().click();
  const phone = freshPhone();
  await page.getByLabel("Vehicle number").fill("KA 04 GH 3456");
  await page.getByLabel("Mobile for WhatsApp pass").fill(phone);
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
  await page.getByLabel("Code from SMS").fill(await knownOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();

  await expect(page).toHaveURL(/\/passes\/[0-9a-f-]{36}\?new=1$/);
  await expect(page.getByText("Payment didn't go through")).toHaveCount(0);
  const rzp = await page.evaluate(() => (window as unknown as { __rzp: { order_id: string; amount: number } }).__rzp);
  await capture(rzp.order_id, rzp.amount);
  await expect(page.getByTestId("pass")).toBeVisible();
  expect(await bookingCount(phone)).toBe(1);
});

test("sign-in return path stays on this site; sign-out wipes device data; promo refused at booking resets the price", async ({ page }) => {
  // Book once so this phone is no longer a first-time customer.
  const phone = freshPhone();
  await page.goto("/?area=mg-road");
  await page.getByRole("link", { name: /MG Road Metro Multilevel/ }).first().click();
  const first = await checkout(page, { plate: "KA 06 JK 7890", phone });
  await capture(first.orderId, first.amount);
  await expect(page.getByTestId("pass")).toBeVisible();

  // Sign out from Account: no pass, phone or plate left on the device.
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/\?|\/$/);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("bayline.") && k !== "bayline.area"))).toEqual([]);
  await page.goto("/passes");
  await expect(page.getByText("Sign in with your mobile number to see your passes")).toBeVisible();
  await expect(page.getByTestId("pass")).toHaveCount(0);

  // FIRST50 quotes fine anonymously, but the API refuses it at booking for this repeat customer:
  // the bill must drop back to the undiscounted total, never keep showing ₹88.50.
  await page.goto("/?area=mg-road");
  await page.getByRole("link", { name: /MG Road Metro Multilevel/ }).first().click();
  await page.getByLabel("Promo code").fill("FIRST50");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("total")).toHaveText("₹88.50");
  await page.getByLabel("Vehicle number").fill("KA 06 JK 7890");
  await page.getByLabel("Mobile for WhatsApp pass").fill(phone);
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
  await page.getByLabel("Code from SMS").fill(await knownOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "FIRST50 works on your first booking only." })).toBeVisible();
  await expect(page.getByTestId("total")).toHaveText("₹159.30");
  await expect(page.getByRole("button", { name: "Pay ₹159.30 and get pass" })).toBeVisible();

  // Open redirect: "/\evil.com" must resolve to our own fallback, not another origin.
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/signin?next=%2F%5Cevil.com");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code from SMS").fill(await knownOtp(phone));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(`${E2E.webUrl}/passes`);
});

test("search validation and public SEO lot page (DRV-01, S12)", async ({ page }) => {
  await page.goto("/?area=mg-road");
  const arrive = await page.getByLabel("Arrive").inputValue();
  await page.getByLabel("Leave").fill(arrive.slice(0, 11) + "00:00");
  await page.getByLabel("Arrive").fill(arrive.slice(0, 11) + "05:00");
  await expect(page.getByRole("alert").filter({ hasText: "Leaving time must be after arrival. Move it later." })).toBeVisible();

  const res = await page.goto("/parking/bengaluru/lot/BLR101");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "MG Road Metro Multilevel" })).toBeVisible();
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld).toMatchObject({ "@type": "ParkingFacility", identifier: "BLR101", makesOffer: { "@type": "Offer", priceCurrency: "INR", price: "40.00" } });
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/parking\/bengaluru\/lot\/BLR101$/);
  expect((await page.goto("/parking/bengaluru/lot/BLR999"))?.status()).toBe(404);
});
