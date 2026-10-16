/**
 * Soft assertion helpers — official `expect.soft` patterns for multi-field checks.
 *
 * Soft failures do not stop the test immediately; Playwright fails the test at the end
 * if any soft assertion failed.
 *
 * @see https://playwright.dev/docs/test-assertions#soft-assertions
 */

import { expect, type Locator } from '@playwright/test';

/** Soft-assert every locator is visible (continues on failure). */
export async function expectAllVisible(locators: Locator[]): Promise<void> {
  for (const locator of locators) {
    await expect.soft(locator).toBeVisible();
  }
}

/** Soft-assert each locator contains the paired text. */
export async function expectAllToContainText(
  pairs: Array<{ locator: Locator; text: string | RegExp }>,
): Promise<void> {
  for (const { locator, text } of pairs) {
    await expect.soft(locator).toContainText(text);
  }
}

/**
 * Soft-assert validation errors for form fields.
 * Useful for `(@failure)` multi-field validation scenarios.
 */
export async function expectSoftFieldErrors(
  fields: Array<{ locator: Locator; message?: string | RegExp }>,
): Promise<void> {
  for (const field of fields) {
    await expect.soft(field.locator).toBeVisible();
    if (field.message !== undefined) {
      await expect.soft(field.locator).toContainText(field.message);
    }
  }
}
