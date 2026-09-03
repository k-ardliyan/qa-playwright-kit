/**
 * Cross-browser config — chromium + firefox + webkit using shared defaults.
 *
 * Usage:
 *   npx playwright test -c config/playwright/cross-browser.ts --grep-invert @demo
 *
 * Nightly job may invoke this for browser-matrix coverage.
 * Auth: setup project materializes .auth/{APP_ENV}/<role>.json; specs override storageState as needed.
 */
import { defineConfig, devices } from '@playwright/test';
import { loadEnvironment } from '../../src/utils/env-loader';
import {
  buildPlaywrightSharedDefaults,
  buildMultiBrowserProjects,
  createFrameworkReporters,
} from './base';

loadEnvironment();

const multiBrowser = buildMultiBrowserProjects({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/demo/**'],
  storageState: { cookies: [], origins: [] },
});

export default defineConfig({
  ...buildPlaywrightSharedDefaults(),
  testDir: './tests',
  reporter: createFrameworkReporters({
    jsonOutput: 'artifacts/test-results/cross-browser-results.json',
    htmlFolder: './artifacts/reports/html-cross-browser',
    customReporterPath: '../../src/support/custom-reporter.ts',
  }),
  projects: [
    {
      name: 'setup',
      testDir: './tests',
      testMatch: /auth\.setup\.ts/,
    },
    ...multiBrowser.map((project) => ({
      ...project,
      dependencies: ['setup'] as string[],
    })),
    // Keep a lightweight demo project optional — excluded from multi-browser matrix
    {
      name: 'demo',
      timeout: 60_000,
      retries: 0,
      use: { ...devices['Desktop Chrome'] },
      testDir: './tests/demo',
      testMatch: '**/*.spec.ts',
    },
  ],
  outputDir: './artifacts/test-results/cross-browser',
});
