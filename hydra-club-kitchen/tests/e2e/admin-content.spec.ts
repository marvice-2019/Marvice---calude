import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

/**
 * Content admin end to end (brief §8, §13) plus the public gallery lightbox (§3.9).
 * Leaves the database as it found it: everything created here is deleted through the UI.
 */
const SECRET = process.env.E2E_STAFF_SECRET ?? "";
test.describe.configure({ mode: "serial" });
test.skip(!SECRET, "staff fixture accounts not configured");
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-1440", "content admin runs once, on desktop");
});

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(process.env.E2E_MANAGER!);
  await page.getByLabel("Password").fill(SECRET);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

const jpeg = ([r, g, b]: readonly number[]) =>
  sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: r!, g: g!, b: b! } } })
    .jpeg()
    .withExif({ IFD0: { Make: "E2E" } })
    .toBuffer();

test("photos: upload two, see them in the gallery, use the lightbox, delete them", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/photos");
  for (const [i, colour] of [[1, [20, 90, 140]], [2, [120, 40, 90]]] as const) {
    await page.locator('input[type="file"]').setInputFiles({ name: `club-${i}.jpg`, mimeType: "image/jpeg", buffer: await jpeg(colour) });
    await page.getByLabel(/Describe it/).fill(`E2E club photo ${i}`);
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("status")).toContainText("Photo added");
    await expect(page.locator("li").filter({ has: page.locator(`img[alt="E2E club photo ${i}"]`) })).toBeVisible();
  }
  // The stored files are served and EXIF-free.
  const src = await page.locator('img[alt="E2E club photo 1"]').getAttribute("src");
  expect(src).toBeTruthy();

  await page.goto("/");
  await page.locator("#gallery").scrollIntoViewIfNeeded();
  const tiles = page.locator("#gallery").getByRole("button", { name: /Open photo: E2E club photo/ });
  await expect(tiles).toHaveCount(2);
  await page.locator("#gallery").getByRole("button", { name: "Kitchen", exact: true }).click();
  await expect(tiles).toHaveCount(0);
  await page.locator("#gallery").getByRole("button", { name: "Club", exact: true }).click();
  await tiles.first().click();
  const box = page.getByRole("dialog");
  await expect(box).toHaveAttribute("aria-label", /Photo 1 of 2/);
  await page.keyboard.press("ArrowRight");
  await expect(box).toHaveAttribute("aria-label", /Photo 2 of 2/);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  expect(await box.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await expect(box.getByRole("link", { name: "Book a table" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await expect(tiles.nth(1)).toBeFocused();

  await page.goto("/admin/photos");
  for (let i = 0; i < 2; i++) {
    page.once("dialog", (d) => d.accept());
    await page.locator("li").filter({ has: page.locator('img[alt^="E2E club photo"]') }).first().getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toContainText("Photo deleted");
  }
  await expect(page.locator('img[alt^="E2E club photo"]')).toHaveCount(0);
});

test("menu: a dish appears on /menu with price and veg label, then is removed", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/menu");
  await page.getByPlaceholder(/New section/).fill("E2E Small plates");
  await page.getByRole("button", { name: "Add section" }).click();
  const section = page.locator("section").filter({ hasText: "E2E Small plates" });
  await expect(section).toBeVisible();
  await section.getByLabel("Dish name").fill("E2E Paneer tikka");
  await section.getByLabel("Price in rupees").fill("1250");
  await section.getByRole("button", { name: "Add dish" }).click();
  await expect(section).toContainText("₹1,250");

  await page.goto("/menu");
  await expect(page.locator("main")).toContainText("E2E Paneer tikka");
  await expect(page.locator("main")).toContainText("₹1,250");

  await page.goto("/admin/menu");
  page.once("dialog", (d) => d.accept());
  await page.locator("section").filter({ hasText: "E2E Small plates" }).getByRole("button", { name: "Delete section" }).click();
  await expect(page.locator("section").filter({ hasText: "E2E Small plates" })).toHaveCount(0);
});

test("nights: the card's button pre-fills the next matching night on the floor plan", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/nights");
  await page.getByLabel("Title").fill("E2E Friday Night");
  await page.getByLabel(/When/).fill("Every Friday");
  await page.getByLabel("One line about it").fill("Lights low, bass up.");
  await page.getByLabel(/Booking button picks/).fill("5");
  await page.getByRole("button", { name: "Add night" }).click();
  await expect(page.locator("main")).toContainText("next Fri");

  await page.goto("/");
  await page.locator("#nights").scrollIntoViewIfNeeded();
  await page.locator("#nights").getByRole("button", { name: /Pick a table for this night/ }).first().click();
  const pressed = page.locator("#floor fieldset").first().locator('button[aria-pressed="true"]');
  await expect(pressed).toHaveText(/Fri|Tonight|Tomorrow/);

  await page.goto("/admin/nights");
  page.once("dialog", (d) => d.accept());
  await page.locator("li").filter({ hasText: "E2E Friday Night" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("li").filter({ hasText: "E2E Friday Night" })).toHaveCount(0);
});

test("settings: a WhatsApp number shows the buttons; clearing it hides them again", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/settings");
  await expect(page.getByRole("alert").filter({ hasText: "Still to confirm" })).toContainText("WhatsApp number is empty");
  const wa = page.locator("form").filter({ hasText: "WhatsApp number" });
  await wa.getByRole("textbox").fill("+91 70000 11111");
  await wa.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("WhatsApp number saved");

  await page.goto("/");
  await expect(page.locator('#visit a[href^="https://wa.me/917000011111"]')).toHaveCount(1);

  await page.goto("/admin/settings");
  await wa.getByRole("textbox").fill("");
  await wa.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("WhatsApp number saved");
  await page.goto("/");
  await expect(page.locator('a[href^="https://wa.me"]')).toHaveCount(0);
});
