import { defineConfig, devices } from "@playwright/test";

// Explicit synthetic fixtures intercept every data request. Start the local server separately.
export default defineConfig({
  testDir: "./tests", testMatch: "conveyancer-sales*.spec.ts", workers: 1, retries: 0,
  timeout: 60_000, reporter: "list", outputDir: "test-results/conveyancer",
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3011", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
