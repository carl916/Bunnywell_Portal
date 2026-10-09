import { defineConfig, devices } from "@playwright/test";

// Explicit synthetic fixtures intercept every data request. Start the local server separately.
export default defineConfig({
  testDir: "./tests", testMatch: ["conveyancer-sales*.spec.ts", "sales-loading.spec.ts"], workers: 1, retries: 0,
  timeout: 60_000, reporter: "list", outputDir: "test-results/conveyancer",
  use: { ...devices["Desktop Chrome"], baseURL: process.env.CONVEYANCER_BROWSER_ORIGIN ?? "http://localhost:3011", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
