import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "developer-sales*.spec.ts", workers: 1, retries: 0, timeout: 60_000,
  reporter: "list", outputDir: "test-results/sales-ux",
  use: { ...devices["Desktop Chrome"], baseURL: process.env.SALES_UX_ORIGIN ?? "http://localhost:3012", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
