import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./e2e/env";

// Real stack: API (../api, fake Razorpay gateway) on a fresh seeded database (e2e/start-api.mjs),
// plus a production build of this app. The test plays Razorpay's server by sending signed
// webhooks (e2e/helpers.ts).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: E2E.webUrl,
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined }
  },
  projects: [
    { name: "phone-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }
  ],
  webServer: [
    {
      command: "node e2e/start-api.mjs",
      url: `${E2E.apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 90_000
    },
    {
      // The same standalone server the Docker image runs (stage 8), not `next dev`/`next start`.
      command: "npx next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && node .next/standalone/server.js",
      url: E2E.webUrl,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { NEXT_PUBLIC_API_URL: E2E.apiUrl, API_INTERNAL_URL: E2E.apiUrl, NEXT_PUBLIC_SITE_URL: E2E.webUrl,
        PORT: String(E2E.webPort), HOSTNAME: "127.0.0.1" }
    }
  ]
});
