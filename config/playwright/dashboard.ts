import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

/**
 * Dashboard browser test config — boots the real dashboard HTTP server against
 * an isolated QA_REPORT_DIR (seeded by globalSetup) so tests exercise the full
 * HTML + hash-router + fragment stack with deterministic data.
 *
 * Run: npx playwright test -c config/playwright/dashboard.ts
 */
export default defineConfig({
  testDir: path.resolve(__dirname, '../../src/__tests__/dashboard-browser'),
  globalSetup: path.resolve(__dirname, '../dashboard-seed.ts'),
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4567',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx ../src/cli/dashboard-server.ts --port=4567 --no-idle --no-open',
    url: 'http://127.0.0.1:4567/heartbeat',
    reuseExistingServer: false,
    timeout: 30_000,
    cwd: path.resolve(__dirname, '..'), // dashboard server resolves cwd-relative paths
    env: {
      QA_REPORT_DIR: path.resolve(__dirname, '../../.tmp/dashboard-browser/reports'),
    },
  },
  projects: [{ name: 'dashboard-chromium', testMatch: '**/*.spec.ts' }],
});
