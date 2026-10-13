import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: ["sales-deposits.spec.ts", "sales-commercial-editor.spec.ts"],
  timeout: 90_000, workers: 1, retries: 0, reporter: "list",
  outputDir: "test-results/deposits",
  use: { ...devices["Desktop Chrome"], baseURL: process.env.DEPOSITS_BROWSER_ORIGIN ?? "http://127.0.0.1:3027", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
