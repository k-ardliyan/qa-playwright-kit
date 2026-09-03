/**
 * Post-upload verification helpers — verify file appears in list/gallery
 * after upload, check upload via API response, and complete upload roundtrip.
 *
 * @module src/support/pw/upload-verify
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { uploadFixture, resolveUploadFixturePath } from './files';
import { detectFileKind, type FileKind } from './file-content-core';
import { waitForApi, type WaitForApiMatch } from './network-assert';

export interface UploadVerifyResult {
  /** File was successfully uploaded */
  uploaded: boolean;
  /** File appears in the list/gallery */
  inList: boolean;
  /** Preview is visible (for images) */
  previewVisible: boolean;
  /** Detected file kind */
  kind: FileKind;
}

/**
 * Verify file appears in a list/gallery after upload.
 *
 * @example
 * ```ts
 * const found = await verifyUploadedFileInList(page, {
 *   fileName: 'report.xlsx',
 *   listLocator: page.locator('.file-list'),
 *   timeout: 5000,
 * });
 * expect(found).toBe(true);
 * ```
 */
export async function verifyUploadedFileInList(
  _page: Page,
  options: {
    /** File name to look for in the list */
    fileName: string;
    /** List container or gallery locator */
    listLocator: Locator;
    /** File item selector within list (default: any text match) */
    itemSelector?: string;
    /** Timeout for file to appear (ms) */
    timeout?: number;
  },
): Promise<boolean> {
  const { fileName, listLocator, itemSelector, timeout } = options;

  try {
    const searchLocator = itemSelector ? listLocator.locator(itemSelector) : listLocator;

    await expect(searchLocator).toContainText(fileName, {
      timeout: timeout ?? 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify upload completed via API response.
 * Captures the upload API call and checks response status and body.
 *
 * @example
 * ```ts
 * const result = await verifyUploadViaApi(page, {
 *   uploadApiPattern: '/api/v1/upload',
 *   uploadAction: async () => page.click('button.upload'),
 *   expectedStatus: 200,
 * });
 * expect(result.success).toBe(true);
 * ```
 */
export async function verifyUploadViaApi(
  page: Page,
  options: {
    /** Upload API URL pattern (urlIncludes) */
    uploadApiPattern: string;
    /** Trigger the upload */
    uploadAction: () => Promise<void>;
    /** Expected response status (default: 200) */
    expectedStatus?: number;
    /** Response body assertion */
    responseCheck?: (body: unknown) => boolean;
  },
): Promise<{ success: boolean; responseBody?: unknown }> {
  const match: WaitForApiMatch = {
    method: 'POST',
    urlIncludes: options.uploadApiPattern,
    status: options.expectedStatus ?? 200,
  };

  try {
    const result = await waitForApi(page, match, options.uploadAction);

    if (options.responseCheck) {
      const checkResult = options.responseCheck(result.resBody);
      return { success: checkResult, responseBody: result.resBody };
    }

    return { success: true, responseBody: result.resBody };
  } catch {
    return { success: false };
  }
}

/**
 * Complete upload roundtrip: upload → verify in list → verify preview (if image).
 *
 * @example
 * ```ts
 * const result = await uploadAndVerify(page, {
 *   trigger: page.locator('input[type="file"]'),
 *   fixturePath: 'images/sample.png',
 *   listLocator: page.locator('.file-gallery'),
 *   previewLocator: page.locator('.preview img'),
 * });
 * expect(result.inList).toBe(true);
 * ```
 */
export async function uploadAndVerify(
  page: Page,
  options: {
    /** File input locator */
    trigger: Locator;
    /** Fixture path under tests/data/ or absolute */
    fixturePath: string;
    /** List/gallery to verify file appears */
    listLocator?: Locator;
    /** Preview locator (for images) */
    previewLocator?: Locator;
    /** Timeout for verification (ms) */
    timeout?: number;
  },
): Promise<UploadVerifyResult> {
  const { trigger, fixturePath, listLocator, previewLocator, timeout } = options;

  // Resolve fixture path and detect kind
  const resolvedPath = resolveUploadFixturePath(fixturePath);
  const kind = detectFileKind(resolvedPath);

  // Upload
  await uploadFixture(trigger, fixturePath);

  // Verify in list
  let inList = false;
  if (listLocator) {
    const fileName = fixturePath.split(/[/\\]/).pop() ?? fixturePath;
    inList = await verifyUploadedFileInList(page, {
      fileName,
      listLocator,
      timeout,
    });
  }

  // Verify preview (for images)
  let previewVisible = false;
  if (previewLocator) {
    try {
      await expect(previewLocator).toBeVisible({ timeout: timeout ?? 10_000 });
      previewVisible = true;
    } catch {
      previewVisible = false;
    }
  }

  return {
    uploaded: true,
    inList,
    previewVisible,
    kind,
  };
}
