import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

// Start the application separately. This suite uses intercepted synthetic data.
export default defineConfig({
  testDir: "./tests", testMatch: ["organisation-dashboard.spec.ts", "organisation-dashboard-performance.spec.ts", "sales-legal-workflow.spec.ts", "sales-stage-tasks.spec.ts"],
  timeout: 60_000, workers: 1, retries: 0, reporter: "list",
  outputDir: "test-results/organisation-dashboard/browser",
  use: { ...devices["Desktop Chrome"], baseURL: process.env.DASHBOARD_BROWSER_ORIGIN ?? "http://localhost:3011", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
