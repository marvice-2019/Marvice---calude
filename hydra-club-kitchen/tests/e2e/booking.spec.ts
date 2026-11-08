import { expect, test, type Page } from "@playwright/test";

/**
 * Booking flow in a real browser (brief §15), on both projects (390x844 and 1440x900).
 * Needs a running server on a dev DB with confirmed hours; reset bookings first:
 *   truncate bookings, rate_limit_hits
 * Each test sends its own X-Real-IP so the 5-per-IP-per-hour limit doesn't interfere,
 * and each project uses different tables so the two runs never collide.
 */

const istServiceDate = (offsetDays: number) => {
  const d = new Date(Date.now() + 330 * 60_000 - 5 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const NIGHT = istServiceDate(1); // tomorrow: always has evening slots
let ipN = 0;

async function setup(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setExtraHTTPHeaders({ "x-real-ip": `198.18.${Math.floor(Math.random() * 250)}.${++ipN}` });
  await page.goto(`/book?date=${NIGHT}`);
  await page.getByRole("button", { name: /^9:00 PM/ }).click();
  await expect(page.locator('[data-id="T1"]')).toBeVisible();
  // Every chip in the scrolling time row must be reachable on a phone (regression: fieldset min-content width).
  expect(await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth])).toEqual([page.viewportSize()!.width, page.viewportSize()!.width]); // phones widen innerWidth on overflow
  return errors;
}

const tableFor = (project: string, n: number) => `T${(project === "mobile-390" ? 0 : 6) + n}`;

async function fillDetails(page: Page) {
  await page.getByLabel("Name").fill("E2E Guest");
  await page.getByLabel(/Mobile number/).fill("98765 43210");
  await page.getByRole("checkbox").check();
}

async function apiBook(page: Page, table: string) {
  const res = await page.request.post("/api/bookings", {
    headers: { "x-real-ip": `198.19.${Math.floor(Math.random() * 250)}.${++ipN}` },
    data: { table, date: NIGHT, time: "21:00", guests: 2, name: "Other Guest", phone: "9123456780", consent: true, website: "" },
  });
  expect(res.status()).toBe(201);
}

test("book a table end to end and get a reference", async ({ page }, info) => {
  const errors = await setup(page);
  const code = tableFor(info.project.name, 1);
  await page.locator(`[data-id="${code}"]`).click();
  await expect(page.getByRole("status").first()).toContainText(`${code} selected`);
  await fillDetails(page);
  await page.getByRole("button", { name: new RegExp(`^Book ${code}`) }).click();
  const ref = page.locator("#booking-confirmation").getByText(/^HYD-[A-Z0-9]{4}$/);
  await expect(ref).toBeVisible();
  await expect(page.getByRole("link", { name: /WhatsApp/ })).toHaveCount(0); // no venue number set yet
  const ics = await page.getByRole("link", { name: "Add to calendar" }).getAttribute("href");
  expect(ics).toMatch(/\/api\/bookings\/HYD-[A-Z0-9]{4}\/ics\?last4=3210$/);
  const file = await page.request.get(ics!);
  expect(file.headers()["content-type"]).toContain("text/calendar");
  expect(await file.text()).toContain("BEGIN:VEVENT");
  expect(await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth])).toEqual([page.viewportSize()!.width, page.viewportSize()!.width]); // phones widen innerWidth on overflow
  expect(errors).toEqual([]);
});

test("pick a table with the keyboard only", async ({ page }, info) => {
  await setup(page);
  const code = tableFor(info.project.name, 2);
  const cell = page.locator(`[data-id="${code}"]`);
  await cell.focus();
  await page.keyboard.press("Enter");
  await expect(cell).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").first()).toContainText(`${code} selected`);
});

test("a table booked at that time is greyed out and can't be picked", async ({ page }, info) => {
  const code = tableFor(info.project.name, 3);
  await setup(page);
  await apiBook(page, code);
  await page.getByRole("button", { name: /^9:30 PM/ }).click();
  await page.getByRole("button", { name: /^9:00 PM/ }).click();
  const cell = page.locator(`[data-id="${code}"]`);
  await expect(cell).toHaveAttribute("aria-disabled", "true");
  await cell.click({ force: true });
  await expect(cell).toHaveAttribute("aria-pressed", "false");
});

test("losing a race shows 'just taken' with alternatives", async ({ page }, info) => {
  const code = tableFor(info.project.name, 4);
  await setup(page);
  await page.locator(`[data-id="${code}"]`).click();
  await fillDetails(page);
  await apiBook(page, code); // someone else gets there first
  await page.getByRole("button", { name: new RegExp(`^Book ${code}`) }).click();
  const alert = page.getByRole("alert").filter({ hasText: "just taken" }); // Next.js adds its own empty route-announcer alert
  await expect(alert).toContainText("That table was just taken");
  const alternatives = alert.getByRole("button");
  expect(await alternatives.count()).toBeGreaterThan(0);
  await alternatives.first().click();
  await expect(page.getByRole("button", { name: /^Book T/ })).toBeVisible();
});

test("phone bottom bar: hidden over hero and floor plan, shown in between", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-390", "the bar is phones only");
  await page.goto("/");
  const bar = page.locator("[data-bottom-bar]");
  await expect(bar).toHaveAttribute("aria-hidden", "true");
  await page.evaluate(() => {
    const el = document.getElementById("numbers")!;
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY);
  });
  await expect(bar).toHaveAttribute("aria-hidden", "false");
  await expect(bar.getByRole("link")).toHaveText("Pick your table");
  await page.locator("#floor").scrollIntoViewIfNeeded();
  await expect(bar).toHaveAttribute("aria-hidden", "true");
});

test("/book?date= pre-selects that night", async ({ page }) => {
  await page.goto(`/book?date=${NIGHT}`);
  await expect(page.getByRole("button", { name: "Tomorrow" })).toHaveAttribute("aria-pressed", "true");
});
