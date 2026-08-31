import type { PlaywrightTestConfig, Project } from '@playwright/test';
import { devices } from '@playwright/test';

/**
 * Shared Playwright execution policy for template core and Reference Adapter.
 * Forks merge this file from upstream, then override testDir / projects / reporter paths locally.
 *
 * Call buildPlaywrightSharedDefaults() only after loadEnvironment() in each config entry file.
 */

function warnConfig(message: string): void {
  console.warn(`[playwright.config] ${message}`);
}

/** Parse SLOW_MO from process.env. CI always returns 0. */
export function resolveSlowMo(): number {
  if (process.env.CI) {
    return 0;
  }

  const raw = process.env.SLOW_MO?.trim();
  if (raw === undefined || raw === '') {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    warnConfig(`Invalid SLOW_MO='${raw}'. Falling back to 0.`);
    return 0;
  }

  return parsed;
}

/** Parse HEADLESS from process.env (default true). */
export function resolveHeadless(): boolean {
  const raw = process.env.HEADLESS?.trim();
  if (raw === undefined || raw === '') {
    return true;
  }

  const normalized = raw.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  warnConfig(`Invalid HEADLESS='${raw}'. Falling back to true.`);
  return true;
}

export function buildPlaywrightSharedDefaults(): Partial<PlaywrightTestConfig> {
  return {
    fullyParallel: true,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    timeout: 30_000,
    expect: {
      timeout: 10_000,
    },
    use: {
      baseURL: process.env.BASE_URL || 'http://localhost:3000',
      headless: resolveHeadless(),
      launchOptions: {
        slowMo: resolveSlowMo(),
      },
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    },
  };
}

export function createFrameworkReporters(options: {
  jsonOutput: string;
  htmlFolder: string;
  customReporterPath: string;
  /**
   * When true (typically CI + shard), append Playwright `blob` reporter so
   * shards can be merged with `npx playwright merge-reports`.
   * Default false keeps the stable 4-reporter tuple for local/property tests.
   */
  includeBlob?: boolean;
  /** Blob output directory (default: `blob-report`). */
  blobOutputDir?: string;
}): PlaywrightTestConfig['reporter'] {
  const reporters: NonNullable<PlaywrightTestConfig['reporter']> = [
    ['list'],
    ['json', { outputFile: options.jsonOutput }],
    ['html', { outputFolder: options.htmlFolder, open: 'never' }],
    [options.customReporterPath],
  ];

  if (options.includeBlob) {
    reporters.push(['blob', { outputDir: options.blobOutputDir ?? 'artifacts/blob-report' }]);
  }

  return reporters;
}

/**
 * Browser target type supported by the multi-browser executor.
 */
export type ConfigBrowserTarget = 'chromium' | 'firefox' | 'webkit';

/**
 * Options for building multi-browser project definitions.
 */
export interface MultiBrowserProjectOptions {
  /** Test directory for all browser projects */
  testDir?: string;
  /** Test match pattern */
  testMatch?: string;
  /** Test ignore patterns */
  testIgnore?: string[];
  /** Storage state to apply to all browser projects */
  storageState?: { cookies: unknown[]; origins: unknown[] };
}

/**
 * Builds a Firefox project definition compatible with Playwright config.
 *
 * @param options - Project customization options
 * @returns A Playwright project definition for Firefox
 */
export function buildFirefoxProject(options?: MultiBrowserProjectOptions): Project {
  return {
    name: 'firefox',
    use: {
      ...devices['Desktop Firefox'],
      ...(options?.storageState ? { storageState: options.storageState } : {}),
    },
    ...(options?.testDir ? { testDir: options.testDir } : {}),
    ...(options?.testMatch ? { testMatch: options.testMatch } : {}),
    ...(options?.testIgnore ? { testIgnore: options.testIgnore } : {}),
  };
}

/**
 * Builds a WebKit project definition compatible with Playwright config.
 *
 * @param options - Project customization options
 * @returns A Playwright project definition for WebKit
 */
export function buildWebkitProject(options?: MultiBrowserProjectOptions): Project {
  return {
    name: 'webkit',
    use: {
      ...devices['Desktop Safari'],
      ...(options?.storageState ? { storageState: options.storageState } : {}),
    },
    ...(options?.testDir ? { testDir: options.testDir } : {}),
    ...(options?.testMatch ? { testMatch: options.testMatch } : {}),
    ...(options?.testIgnore ? { testIgnore: options.testIgnore } : {}),
  };
}

/**
 * Builds all multi-browser project definitions (chromium, firefox, webkit).
 * Each project uses the standard device emulation from Playwright's device list.
 *
 * @param options - Shared project customization options applied to all browsers
 * @returns Array of Playwright project definitions for chromium, firefox, and webkit
 */
export function buildMultiBrowserProjects(options?: MultiBrowserProjectOptions): Project[] {
  const storageState = options?.storageState ?? { cookies: [], origins: [] };
  const commonProps = {
    ...(options?.testDir ? { testDir: options.testDir } : {}),
    ...(options?.testMatch ? { testMatch: options.testMatch } : {}),
    ...(options?.testIgnore ? { testIgnore: options.testIgnore } : {}),
  };

  return [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState,
      },
      ...commonProps,
    },
    buildFirefoxProject({ ...options, storageState }),
    buildWebkitProject({ ...options, storageState }),
  ];
}
