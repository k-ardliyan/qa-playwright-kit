/**
 * Conditional download helpers — download templates only when preconditions are met.
 *
 * Common ERP pattern: download a template only when master data exists. A missing
 * prerequisite is NOT "not applicable to automation" — it is unfinished work
 * (the seed/environment is not ready), so the helper marks the test with
 * `test.fixme` rather than `test.skip`. Playwright's `skip` means "irrelevant";
 * using it here would hide a real data gap behind a neutral status.
 *
 * @module src/support/pw/conditional-download
 */

import type { Page } from '@playwright/test';
import { downloadAndSave } from './files';
import { test } from '@playwright/test';

export interface DownloadIfOptions {
  /** Mark the test `fixme` instead of returning null — annotates it with the reason. */
  fixmeOnFalse?: boolean;
  /** @deprecated Use `fixmeOnFalse`. Kept so existing specs keep working. */
  skipOnFalse?: boolean;
  /** Reason recorded on the fixme marker. */
  skipReason?: string;
  /** Custom download directory */
  dir?: string;
}

export interface DownloadResult {
  path: string;
  suggestedFilename: string;
  size: number;
}

/**
 * Download a file only when a precondition is met.
 * Returns null when the condition is not met — the test can branch, or be
 * marked `test.fixme` when `fixmeOnFalse` is set.
 *
 * @example
 * ```ts
 * const result = await downloadIf(
 *   page,
 *   async () => await masterDataExists(page),
 *   async () => page.click('button.download-template'),
 *   { fixmeOnFalse: true, skipReason: 'Master data not found' },
 * );
 * if (!result) return; // precondition not met — test is marked fixme
 * ```
 */
export async function downloadIf(
  page: Page,
  condition: () => Promise<boolean>,
  trigger: () => Promise<void>,
  options?: DownloadIfOptions,
): Promise<DownloadResult | null> {
  const conditionMet = await condition();

  if (!conditionMet) {
    if (options?.fixmeOnFalse ?? options?.skipOnFalse) {
      const reason =
        options.skipReason ?? 'Download precondition not met — data/environment not ready';
      test.fixme(true, reason);
    }
    return null;
  }

  const { path, suggestedFilename, size } = await downloadAndSave(page, trigger, {
    dir: options?.dir,
  });

  return { path, suggestedFilename, size };
}

/**
 * Download a template when master data exists (selector-based check).
 * Navigates to `masterCheckUrl`, verifies `masterSelector` is visible,
 * then triggers the download.
 *
 * Common ERP pattern: download the employee template only when the department
 * master exists.
 *
 * @example
 * ```ts
 * const result = await downloadTemplateWithMaster(page, {
 *   masterCheckUrl: '/settings/departments',
 *   masterSelector: 'table.departments tbody tr',
 *   downloadTrigger: async () => page.click('button.download-template'),
 * });
 * ```
 */
export async function downloadTemplateWithMaster(
  page: Page,
  options: {
    /** Navigate here to check master data exists */
    masterCheckUrl: string;
    /** Selector that confirms master data is present (e.g. a table row) */
    masterSelector: string;
    /** Trigger the download action */
    downloadTrigger: () => Promise<void>;
    /** Download directory */
    dir?: string;
    /** Mark the test fixme when master data is missing (default: false) */
    fixmeOnMissing?: boolean;
    /** @deprecated Use `fixmeOnMissing`. Kept so existing specs keep working. */
    skipOnMissing?: boolean;
  },
): Promise<DownloadResult | null> {
  return downloadIf(
    page,
    async () => {
      await page.goto(options.masterCheckUrl);
      const locator = page.locator(options.masterSelector);
      const count = await locator.count();
      return count > 0;
    },
    options.downloadTrigger,
    {
      dir: options.dir,
      fixmeOnFalse: options.fixmeOnMissing ?? options.skipOnMissing,
      skipReason: `Master data not found at ${options.masterCheckUrl} (selector: ${options.masterSelector})`,
    },
  );
}

/**
 * Download a template when master data exists (API-based check).
 * Calls `masterApiUrl` and uses `masterApiCheck` to decide whether the
 * response indicates master data is present.
 *
 * @example
 * ```ts
 * const result = await downloadTemplateWithMasterApi(page, {
 *   masterApiUrl: '/api/v1/departments',
 *   masterApiCheck: (res) => Array.isArray(res) && res.length > 0,
 *   downloadTrigger: async () => page.click('button.download-template'),
 * });
 * ```
 */
export async function downloadTemplateWithMasterApi(
  page: Page,
  options: {
    /** API endpoint to check master data */
    masterApiUrl: string;
    /** Response check: truthy = master exists */
    masterApiCheck: (response: unknown) => boolean;
    /** Trigger the download action */
    downloadTrigger: () => Promise<void>;
    /** Download directory */
    dir?: string;
    /** Mark the test fixme when master data is missing (default: false) */
    fixmeOnMissing?: boolean;
    /** @deprecated Use `fixmeOnMissing`. Kept so existing specs keep working. */
    skipOnMissing?: boolean;
  },
): Promise<DownloadResult | null> {
  return downloadIf(
    page,
    async () => {
      try {
        const response = await page.request.get(options.masterApiUrl);
        if (!response.ok()) return false;
        const body = await response.json();
        return options.masterApiCheck(body);
      } catch {
        return false;
      }
    },
    options.downloadTrigger,
    {
      dir: options.dir,
      fixmeOnFalse: options.fixmeOnMissing ?? options.skipOnMissing,
      skipReason: `Master data not found via API: ${options.masterApiUrl}`,
    },
  );
}
