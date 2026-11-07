import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Accessibility scan (axe, WCAG 2.2 AA rules) and security headers (brief §10). */

for (const path of ["/", "/book", "/menu", "/gallery", "/privacy", "/terms", "/admin/login"]) {
  test(`axe: ${path} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    // Scroll through like a reader so scroll-revealed text (the story) is at its reading state.
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 30));
      }
    });
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(" ")}`);
    expect(summary).toEqual([]);
  });
}

test("security headers and a nonce-based CSP on pages", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
  const again = await request.get("/");
  expect(again.headers()["content-security-policy"]).not.toBe(h["content-security-policy"]); // fresh nonce per request
});

test("the site's own scripts run under the CSP, injected markup can't execute", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => m.type() === "error" && /Content Security Policy/.test(m.text()) && violations.push(m.text()));
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // hydrated, so the interaction listener is attached
  await page.mouse.move(200, 300); // the hero show starts on first interaction
  await expect(page.locator("#fx").locator("..")).toHaveAttribute("data-gl", "on", { timeout: 10000 }); // hydrated and WebGL running
  expect(violations).toEqual([]); // nothing of ours was refused
  // An XSS-style injection: HTML with an inline event handler. No 'unsafe-inline', so it must not run.
  const ran = await page.evaluate(async () => {
    document.body.insertAdjacentHTML("beforeend", '<img src="data:," onerror="window.__pwned = true" alt="">');
    await new Promise((r) => setTimeout(r, 300));
    return (window as unknown as { __pwned?: boolean }).__pwned === true;
  });
  expect(ran).toBe(false);
});

test("search engines: robots keeps admin out, sitemap lists the pages, JSON-LD is valid", async ({ page, request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toContain("Sitemap:");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const p of ["/book", "/menu", "/gallery"]) expect(sitemap).toContain(p);
  await page.goto("/");
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld["@type"]).toEqual(["NightClub", "Restaurant"]);
  expect(ld.telephone).toBeUndefined();
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/^https?:\/\/[^/]+\/?$/);
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toContain("opengraph-image");
  expect((await request.get("/opengraph-image")).headers()["content-type"]).toContain("image/png");
});
