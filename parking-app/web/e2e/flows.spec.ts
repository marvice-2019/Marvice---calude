import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Each test signs in with its own number so runs never share state.
const phone = () => "98" + String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-8);

async function otpFor(p: string) {
  for (let i = 0; i < 20; i++) {
    const m = [...readFileSync(process.env.API_LOG!, "utf8").matchAll(new RegExp(`\\+91${p}: (\\d{6})`, "g"))].pop();
    if (m) return m[1];
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error("no OTP in API log");
}

async function signIn(page: Page) {
  const p = phone();
  await page.getByLabel("Mobile number").fill(p);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code from SMS").fill(await otpFor(p));
  await page.getByRole("button", { name: "Verify and continue" }).click();
}

test("search → lot → checkout → pass at the gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your bay is/ })).toBeVisible();
  await page.getByRole("button", { name: "In 1 hour" }).click();
  const first = page.locator(".lot").first();
  await expect(first).toContainText("incl. GST");
  await first.click();
  await expect(page.getByText("GST 18%").first()).toBeVisible();
  await signIn(page);
  await page.getByLabel("Number plate").fill("KA01AB1234");
  await page.getByRole("button", { name: /^Pay ₹/ }).first().click();
  await expect(page).toHaveURL(/\/passes\?new=/);
  await expect(page.getByRole("img", { name: /Gate QR for pass/ }).first()).toBeVisible({ timeout: 20_000 });
});

test("promo code lowers the total before GST", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Tomorrow 9 am" }).click();
  await page.locator(".lot").first().click();
  await signIn(page);
  const before = await page.locator(".bill .tot").first().innerText();
  await page.getByLabel("Promo code").fill("FIRST50");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/Applied\. You save/)).toBeVisible();
  await expect(page.locator(".bill .disc")).toContainText("FIRST50");
  expect(await page.locator(".bill .tot").first().innerText()).not.toBe(before);
});

test("bad promo shows the reason, keeps the price", async ({ page }) => {
  await page.goto("/");
  await page.locator(".lot").first().click();
  await signIn(page);
  await page.getByLabel("Promo code").fill("NOPE");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("#promo-msg")).not.toBeEmpty();
  await expect(page.locator(".bill .disc")).toHaveCount(0);
});

test("Park now with digits from the board", async ({ page }) => {
  await page.goto("/park-now");
  await page.getByLabel("Lot number").fill("102");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText("Brigade Road Basement P1")).toBeVisible();
  await page.getByRole("button", { name: "1 h", exact: true }).click();
  await signIn(page);
  await page.getByLabel("Number plate").fill("KA05MN4321");
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
  await expect(page).toHaveURL(/\/passes\?new=/);
  await expect(page.getByText(/Parked · .* left/).first()).toBeVisible({ timeout: 20_000 });
});

test("unknown lot number explains what to do", async ({ page }) => {
  await page.goto("/park-now");
  await page.getByLabel("Lot number").fill("999");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("alert")).toContainText("No lot with code");
});

test("no horizontal scroll on key pages", async ({ page }) => {
  for (const path of ["/", "/park-now", "/valet", "/monthly", "/list-your-space", "/parking/mg-road"]) {
    await page.goto(path);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw, path).toBeLessThanOrEqual(cw);
  }
});
