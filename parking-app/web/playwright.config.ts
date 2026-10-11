import { defineConfig, devices } from "@playwright/test";

// Runs in CI (.github/workflows/web.yml) against the built app, the API on the fake gateway, and the dev seed.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: process.env.WEB_URL ?? "http://localhost:3001", trace: "retain-on-failure" },
  projects: [
    { name: "phone-390", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, browserName: "chromium" } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 900 } } }
  ]
});
