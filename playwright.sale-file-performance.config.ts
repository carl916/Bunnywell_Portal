import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "conveyancer-file-performance.spec.ts", workers: 1, retries: 0,
  reporter: "list", outputDir: "test-results/sale-file-performance",
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3011", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
