import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
dotenv.config({path:".env.local",quiet:true});

// Separate from the normal suite: never starts a development server, and never
// runs live mutations. All workflow writes use the existing intercepted fixtures.
export default defineConfig({
  testDir:"./tests/diagnostics", testMatch:"sales-performance.spec.ts", timeout:180_000,
  workers:1, fullyParallel:false, retries:0, reporter:"list", expect:{timeout:30_000},
  outputDir:".next/performance/playwright",
  use:{...devices["Desktop Chrome"],baseURL:process.env.SALES_PERF_BASE_URL ?? "https://staging.bunnywell.co.uk",trace:"off",screenshot:"off",video:"off"},
});
