import { defineConfig, devices } from '@playwright/test';

// Existing synthetic fixtures intercept all business/auth data. No live writes.
export default defineConfig({
  testDir: './tests',
  testMatch: ['conveyancer-sales.spec.ts', 'conveyancer-sales-loading.spec.ts', 'conveyancer-sales-corrections.spec.ts', 'sales-loading.spec.ts', 'sales-legal-workflow.spec.ts', 'sales-stage-tasks.spec.ts', 'organisation-dashboard.spec.ts'],
  timeout: 60_000, workers: 1, retries: 0, reporter: 'list',
  outputDir: 'test-results/full-region-functional',
  use: { ...devices['Desktop Chrome'], baseURL: process.env.FULL_REGION_ORIGIN, screenshot: 'off', trace: 'off', video: 'off' },
});
