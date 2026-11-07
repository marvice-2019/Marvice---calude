// Owner first-login journey (stage 2), driven in Chromium at 390x844.
// Needs a running server and a database where the owner was just bootstrapped from
// ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD (see README). Run: node tests/e2e/auth-journey.cjs
// Becomes a @playwright/test spec in stage 8.
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.ADMIN_SEED_EMAIL;
const FIRST = process.env.ADMIN_SEED_PASSWORD;
const NEXT = `e2e-${Math.random().toString(36).slice(2)}-new`;
if (!EMAIL || !FIRST) throw new Error("Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD");

const results = [];
const check = (name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/admin`);
  check("signed-out /admin redirects to login", page.url().startsWith(`${BASE}/admin/login`), page.url());

  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', "wrong-password-x");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=don't match");
  check("wrong password shows a generic error", true);

  // Only the password is re-typed: the email must survive the failed attempt.
  await page.fill('input[name="password"]', FIRST);
  await page.click('button[type="submit"]');
  await page.waitForURL(/change-password/);
  check("first login is forced to change password", page.url().endsWith("/admin/change-password"));

  const session = (await ctx.cookies()).find((c) => c.name.includes("authjs.session-token"));
  check(
    "session cookie is HttpOnly + SameSite=Lax",
    !!session && session.httpOnly && session.sameSite === "Lax",
    JSON.stringify(session && { httpOnly: session.httpOnly, sameSite: session.sameSite }),
  );

  await page.goto(`${BASE}/admin`);
  check("cannot skip the password change", page.url().endsWith("/admin/change-password"), page.url());

  await page.fill('input[name="current"]', FIRST);
  await page.fill('input[name="next"]', "short");
  await page.fill('input[name="confirm"]', "short");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=at least 12 characters");
  check("weak new password is rejected", true);

  await page.fill('input[name="current"]', FIRST);
  await page.fill('input[name="next"]', NEXT);
  await page.fill('input[name="confirm"]', NEXT);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/login\?changed=1/);
  check("password change signs out and confirms", await page.isVisible("text=Password changed"));

  // Replay the session cookie captured before the change: it must be dead.
  const replay = await browser.newContext();
  await replay.addCookies([session]);
  const rp = await replay.newPage();
  await rp.goto(`${BASE}/admin`);
  check("old session cookie lands on the login page", new URL(rp.url()).pathname === "/admin/login", rp.url());
  await replay.close();

  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', NEXT);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/admin`);
  const body = await page.textContent("main");
  const ownerNav = await page.locator('nav[aria-label="Admin"] a:visible', { hasText: "Users" }).count();
  check("new password signs in to Today, with the owner-only Users link", body.includes("Tonight") && ownerNav > 0, body.slice(0, 80));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("no horizontal overflow at 390px", !overflow);

  await page.locator('button:visible', { hasText: "Sign out" }).click();
  await page.waitForURL(/\/admin\/login/);
  await page.goto(`${BASE}/admin`);
  check("sign out ends the session", page.url().includes("/admin/login"), page.url());

  await browser.close();
  console.log(results.join("\n"));
})().catch((e) => {
  console.log(results.join("\n"));
  console.error(e);
  process.exit(1);
});
