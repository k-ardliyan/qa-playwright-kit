import { defineConfig } from '@playwright/test';
import * as path from 'node:path';

// Playwright configuration for unit tests (.test.ts files).
// Separate from the main E2E config which matches .spec.ts only.
// Scans: src and tools/scripts tests dirs.
export default defineConfig({
  testDir: path.resolve(__dirname, '../..'),
  testMatch: [
    'src/**/*.test.ts',
    'src/__tests__/**/*.test.ts',
    'tools/scripts/__tests__/**/*.test.ts',
    'tools/validators/__tests__/**/*.test.ts',
  ],
  reporter: [['list']],
  timeout: 15_000,
  fullyParallel: false,
});
