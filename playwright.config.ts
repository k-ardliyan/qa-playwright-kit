import { defineConfig, devices } from '@playwright/test';
import { loadEnvironment } from './src/utils/env-loader';
import { buildPlaywrightSharedDefaults, createFrameworkReporters } from './config/playwright/base';

loadEnvironment();

const includeBlob = process.env.CI === 'true' && process.env.PW_BLOB === '1';

const challengeMode = (process.env.AUTH_CHALLENGE_MODE ?? 'none').trim().toLowerCase();
const hasInteractiveChallenge = challengeMode !== 'none';
const isInteractiveUi = process.argv.includes('--headed') || process.argv.includes('--debug');

export default defineConfig({
  ...buildPlaywrightSharedDefaults(),
  testDir: './tests',
  reporter: createFrameworkReporters({
    jsonOutput: 'artifacts/test-results/results.json',
    htmlFolder: './artifacts/reports/html',
    customReporterPath: './src/support/custom-reporter.ts',
    includeBlob,
    blobOutputDir: 'artifacts/blob-report',
  }),
  projects: [
    // Auth setup — materializes .auth/{APP_ENV}/<role>.json for every login-ready role.
    // Run: npm run auth:setup  |  npm run auth:setup:headed (OTP/CAPTCHA)
    {
      name: 'setup',
      testDir: './tests',
      testMatch: /auth\.setup\.ts/,
      // Smart concurrency:
      // - Mode normal (AUTH_CHALLENGE_MODE=none) di headless: PARALEL penuh agar cepat.
      // - Mode interaktif (OTP/CAPTCHA atau --headed): SERIAL (fullyParallel: false)
      //   agar input terminal stdin dan browser window tidak bertabrakan.
      fullyParallel: !hasInteractiveChallenge && !isInteractiveUi,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Default unauthenticated. Generated authenticated specs MUST override:
        //   test.use({ storageState: authStatePath('<role>') })
        //   // or `.auth/${process.env.APP_ENV||'local'}/<role>.json`
        // Forcing .auth/.../user.json here would break unauth + public demos.
        storageState: { cookies: [], origins: [] },
      },
      testDir: './tests',
      testMatch: '**/*.spec.ts',
      testIgnore: ['**/demo/**'],
      // Official Playwright auth pattern: setup always runs first.
      dependencies: ['setup'],
    },
    {
      // Public demos — no auth dependency (playwright.dev / setContent fixtures).
      name: 'demo',
      timeout: 60_000,
      retries: 0,
      use: {
        ...devices['Desktop Chrome'],
      },
      testDir: './tests/demo',
      testMatch: '**/*.spec.ts',
    },
  ],
  outputDir: './artifacts/test-results',
});
