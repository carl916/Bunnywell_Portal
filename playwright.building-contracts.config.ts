import { defineConfig, devices } from "@playwright/test";
export default defineConfig({testDir:"./tests",testMatch:["building-contracts-stage1.spec.ts"],workers:1,retries:0,timeout:45000,reporter:"list",
  outputDir:"test-results/building-contracts",use:{...devices["Desktop Chrome"],baseURL:"http://127.0.0.1:3031",serviceWorkers:"block",trace:"off"}});
