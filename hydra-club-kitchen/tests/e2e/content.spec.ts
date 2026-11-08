import { expect, test } from "@playwright/test";

/** Content sections and subpages with today's data: no photos, menu or nights yet, no WhatsApp/phone. */

for (const path of ["/", "/menu", "/gallery", "/privacy", "/terms"]) {
  test(`${path} loads clean: no errors, no failed requests, no sideways scroll`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth])).toEqual([page.viewportSize()!.width, page.viewportSize()!.width]); // phones widen innerWidth on overflow
    expect(errors).toEqual([]);
  });
}

test("empty states render, and unconfirmed contact links are absent", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#gallery")).toContainText("New photos from the floor are on the way");
  await expect(page.locator("#menu")).toContainText(/coming soon/i);
  await expect(page.locator("#nights")).toContainText(/Instagram/);
  await expect(page.locator('a[href^="https://wa.me"]')).toHaveCount(0);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.locator("#visit")).toContainText("11:30 AM");
});

test("the map loads only after a click", async ({ page }) => {
  await page.goto("/");
  await page.locator("#visit").scrollIntoViewIfNeeded();
  await expect(page.locator('iframe[src*="google.com/maps"]')).toHaveCount(0);
  await page.getByRole("button", { name: /show map/i }).click();
  await expect(page.locator('iframe[src*="google.com/maps"]')).toHaveCount(1);
});

test("a VIP card jumps to the floor plan filtered to that zone", async ({ page }) => {
  await page.goto("/");
  await page.locator("#vip").scrollIntoViewIfNeeded();
  await page.locator("#vip").getByRole("button").filter({ hasText: /^VVIP/ }).first().click();
  await expect(page.getByRole("button", { name: "VVIP", exact: true })).toHaveAttribute("aria-pressed", "true");
});
