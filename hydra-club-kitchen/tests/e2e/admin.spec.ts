import { expect, test, type Page } from "@playwright/test";

/**
 * Staff admin in a real browser (brief §8). Needs E2E_OWNER / E2E_MANAGER / E2E_HOST and
 * E2E_STAFF_SECRET accounts in the server's database (see .smoke/admin-fixture.ts for dev).
 */
const SECRET = process.env.E2E_STAFF_SECRET ?? "";
const istDate = (offsetDays: number) => {
  const d = new Date(Date.now() + 330 * 60_000 - 5 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function signIn(page: Page, email: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SECRET);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

test.describe.configure({ mode: "serial" });
test.skip(!SECRET, "staff fixture accounts not configured");

test("manager runs the night: walk-in, confirm, hold, CSV, no sideways scroll", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, process.env.E2E_MANAGER!);
  await expect(page.getByRole("heading", { name: "Tonight" })).toBeVisible();

  // An online booking for tomorrow, then confirm it from the Bookings page.
  const tomorrow = istDate(1);
  const table = info.project.name === "mobile-390" ? "T11" : "T12";
  const res = await page.request.post("/api/bookings", {
    headers: { "x-real-ip": `198.51.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` },
    data: { table, date: tomorrow, time: "21:00", guests: 3, name: `Admin E2E ${info.project.name}`, phone: "9988776655", consent: true, website: "" },
  });
  expect(res.status()).toBe(201);
  const { booking } = (await res.json()) as { booking: { ref: string } };
  await page.goto(`/admin/bookings?date=${tomorrow}`);
  const row = page.locator("li").filter({ hasText: booking.ref });
  await expect(row).toContainText("pending");
  await row.getByRole("button", { name: "Confirm" }).click();
  await expect(row).toContainText("confirmed");

  // Walk-in without a phone, tonight.
  await page.goto("/admin/bookings");
  const walkIn = page.locator("form").filter({ hasText: "Add a walk-in" });
  await walkIn.getByLabel("Table").selectOption(info.project.name === "mobile-390" ? "M3" : "M4");
  await walkIn.getByLabel("Name").fill(`Walk ${info.project.name}`);
  await walkIn.getByRole("button", { name: "Add walk-in" }).click();
  await expect(page.getByRole("status")).toContainText("Walk-in added");
  await page.goto("/admin");
  await expect(page.locator("main")).toContainText(`Walk ${info.project.name}`);

  // Hold a zone for tomorrow: it reports the clash, then remove it.
  await page.goto("/admin/holds");
  const hold = page.locator("form").filter({ hasText: "Block a table or zone" });
  await hold.getByLabel("What").selectOption(`table:${table}`);
  await hold.getByLabel("Night").fill(tomorrow);
  await hold.getByLabel("Reason").fill("E2E private party");
  await hold.getByRole("button", { name: "Block it" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already booked" })).toContainText(booking.ref);
  const held = page.locator("li").filter({ hasText: "E2E private party" });
  await expect(held).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await held.getByRole("button", { name: "Remove" }).click();
  await expect(held).toHaveCount(0);

  // CSV export includes the booking, with the phone neutralised for spreadsheets.
  const csv = await page.request.get(`/api/admin/bookings/export?from=${tomorrow}&to=${tomorrow}`);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body).toContain(booking.ref);
  expect(body).toContain("'+919988776655");

  expect(await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth])).toEqual([page.viewportSize()!.width, page.viewportSize()!.width]); // phones widen innerWidth on overflow
  expect(errors).toEqual([]);
});

test("a host sees bookings but not holds or staff", async ({ page }) => {
  await signIn(page, process.env.E2E_HOST!);
  const nav = page.getByRole("navigation", { name: "Admin" }).first();
  await expect(nav.getByRole("link", { name: "Bookings" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Holds" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
  const res = await page.goto("/admin/users");
  expect(res?.status()).toBe(404);
  const api = await page.request.post("/api/admin/holds", { data: { zone: "vip", date: istDate(2), reason: "x" } });
  expect(api.status()).toBe(403);
});

test("the owner adds a staff account", async ({ page }, info) => {
  await signIn(page, process.env.E2E_OWNER!);
  await page.goto("/admin/users");
  const email = `e2e-new-${info.project.name}@hydra.local`;
  const form = page.locator("form").filter({ hasText: "Add staff" });
  await form.getByLabel("Name").fill("New Host");
  await form.getByLabel("Email").fill(email);
  await form.getByLabel(/Temporary password/).fill("temporary-pass-123");
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("main")).toContainText(email);
  await expect(page.locator("li").filter({ hasText: email })).toContainText("must set a new password");
});
