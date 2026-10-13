import { defineConfig, devices } from "@playwright/test";

// Run a local dev server with NEXT_PUBLIC_SHOW_ENV_BANNER=true and
// NEXT_PUBLIC_PORTAL_ENV=staging. All requests use the existing synthetic fixture.
export default defineConfig({
  testDir: "./tests",
  testMatch: ["mobile-navigation.spec.ts", "sales-mobile-responsive.spec.ts", "developer-sales-overview-stability.spec.ts"],
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/mobile-navigation",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3017",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
