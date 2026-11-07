import { defineConfig, devices } from "@playwright/test";

/**
 * Browser specs (tests/e2e/*.spec.ts) run against an already-running server:
 *   E2E_BASE_URL=http://localhost:3000 pnpm e2e
 * Both viewports from the brief (§15): 390x844 phone and 1440x900 desktop.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "off",
  },
  projects: [
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
