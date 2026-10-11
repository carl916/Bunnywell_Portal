import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "developer-fees*.spec.ts", workers: 1, retries: 0, timeout: 60_000,
  reporter: "list", outputDir: "test-results/fees-ux",
  use: { ...devices["Desktop Chrome"], baseURL: process.env.FEES_UX_ORIGIN ?? "http://localhost:3013", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
