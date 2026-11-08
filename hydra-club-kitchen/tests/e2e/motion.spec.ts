import { expect, test, type Page } from "@playwright/test";

/** Header, hero light show, sound, Run the room and reduced-motion behaviour (brief §3–4, §10). */

const countDraws = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __draws: Record<string, number> };
    w.__draws = {};
    const orig = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      const id = (this.canvas as HTMLCanvasElement).id || "?";
      w.__draws[id] = (w.__draws[id] ?? 0) + 1;
      return orig.apply(this, args);
    };
  });
const draws = (page: Page, id: string) => page.evaluate((i) => (window as unknown as { __draws: Record<string, number> }).__draws[i] ?? 0, id);

test("home renders with no console errors and no sideways scroll", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hydra");
  // Regression: the phone header once pushed the Menu button off-screen, and the wordmark was clipped.
  // Measure against the real screen width: on phones window.innerWidth grows with any overflow, so it hides the bug.
  const screenW = page.viewportSize()!.width;
  expect(await page.evaluate(() => window.innerWidth)).toBe(screenW);
  const outside = await page.evaluate((vw) =>
    [...document.querySelectorAll<HTMLElement>("[data-site-header] a, [data-site-header] button, h1")]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const range = document.createRange();
        // Visible text only: the h1's sr-only suffix is deliberately positioned off-screen.
        range.selectNodeContents(el.tagName === "H1" ? (el.firstChild ?? el) : el);
        const text = range.getBoundingClientRect();
        return r.left < 0 || r.right > vw || text.left < 0 || text.right > vw;
      })
      .map((el) => (el.textContent ?? "").trim().slice(0, 20)),
    screenW,
  );
  expect(outside).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500); // overflow from an unanchored animated layer grows over time
  expect(await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth])).toEqual([screenW, screenW]);
  expect(errors).toEqual([]);
});

test("the hero light show runs on WebGL and keeps animating", async ({ page }) => {
  await countDraws(page);
  await page.goto("/");
  await expect(page.locator("#fx").locator("..")).toHaveAttribute("data-gl", "pending"); // CSS beams until the visitor interacts
  await page.waitForTimeout(1500);
  await expect(page.locator("#fx").locator("..")).toHaveAttribute("data-gl", "pending");
  await page.mouse.move(200, 300); // first interaction starts the WebGL show
  const host = page.locator("#fx").locator("..");
  await expect(host).toHaveAttribute("data-gl", "on", { timeout: 10000 });
  await expect(host.locator(".hydra-beams")).toBeHidden();
  const first = await draws(page, "fx");
  // Headless Chromium renders WebGL in software, so frame rates are low here; prove it keeps drawing.
  await page.waitForTimeout(1500);
  expect(await draws(page, "fx")).toBeGreaterThan(first + 3);
});

test("without WebGL the CSS beams stay", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl" || type === "experimental-webgl" || type === "webgl2") return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // hydrated, so the interaction listener is attached
  await page.mouse.move(200, 300); // the hero show starts on first interaction
  const host = page.locator("#fx").locator("..");
  await expect(host).toHaveAttribute("data-gl", "off", { timeout: 10000 });
  await expect(host.locator(".hydra-beams")).toBeVisible();
});

test("reduced motion: one static frame, no pinning, stacked clock", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await countDraws(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // hydrated, so the interaction listener is attached
  await page.mouse.move(200, 300); // the hero show starts on first interaction
  await expect(page.locator("#fx").locator("..")).toHaveAttribute("data-gl", "on", { timeout: 10000 });
  await page.waitForTimeout(800);
  expect(await draws(page, "fx")).toBeLessThanOrEqual(2);
  const heroHeight = await page.locator("#top").evaluate((el) => el.getBoundingClientRect().height);
  expect(heroHeight).toBeLessThan(844 * 1.2);
  const clockHeight = await page.locator("#day-to-night").evaluate((el) => el.getBoundingClientRect().height);
  expect(clockHeight).toBeLessThan(844 * 2);
  await context.close();
});

test("Sound toggles and Drop flashes", async ({ page }) => {
  await page.goto("/");
  const sound = page.locator("header").getByRole("button", { name: /sound/i });
  await expect(sound).toHaveCount(1); // regression: a duplicate responsive button once showed twice on phones
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await page.locator("#run-the-room").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Violet" }).click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--neon").trim().toLowerCase())).toBe("#8b5cf6");
  await page.getByRole("button", { name: "Drop" }).click();
  await expect(page.locator(".hydra-flash")).toHaveAttribute("data-flash", "true");
});

test("phone menu traps focus and closes on Escape", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-390", "phone menu only");
  await page.goto("/");
  await page.getByRole("link", { name: "Menu", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Site menu" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
