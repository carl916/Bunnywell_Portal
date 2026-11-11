import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: ["sales-workspace-prototype.spec.ts", "building-workspace-prototype.spec.ts"],
  workers: 1, retries: 0, timeout: 90_000, reporter: "list",
  outputDir: "test-results/sales-prototype",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3027", serviceWorkers: "block", trace: "retain-on-failure" },
});
