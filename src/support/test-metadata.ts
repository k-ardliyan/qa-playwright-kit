/**
 * Test metadata helper — inject structured metadata into Playwright tests
 * via test.info().annotations at runtime (not comments).
 *
 * Use this helper in generated tests to populate Test ID, Priority, Role, etc.
 * that will be extracted by CustomReporter.
 */

import { test } from '@playwright/test';

export interface TestMetadata {
  testId?: string;
  /** Stable requirement scenario identifier (for example `SC-01`). */
  scenarioId?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  role?: string;
  /** Module this test belongs to — matches requirement `- **Module:** <name>`. */
  module?: string;
  /** Feature within the module — matches requirement `- **Feature:** <name>`. */
  feature?: string;
  /** Must match AffectedLayer type: 'FE' | 'BE' | 'DB' | 'API' */
  affectedLayer?: Array<'FE' | 'BE' | 'DB' | 'API'>;
  inputData?: Record<string, string>;
  expectedResult?: string;
  /** Optional QA failure source for dashboard decision badges. */
  failureSource?: 'app' | 'test' | 'requirement' | 'env' | 'ai_generation' | 'unknown';
}

/**
 * Set test metadata via Playwright annotations API.
 * Call this at the top of your test body.
 *
 * @example
 * ```ts
 * test('should login successfully', async ({ page }) => {
 *   setTestMetadata({
 *     testId: 'TC-LOGIN-01',
 *     priority: 'HIGH',
 *     role: 'finance',
 *     affectedLayer: ['ui', 'api'],
 *     inputData: { username: 'finance@example.com' },
 *     expectedResult: 'User redirected to dashboard'
 *   });
 *
 *   // ... test steps ...
 * });
 * ```
 */
export function setTestMetadata(metadata: TestMetadata): void {
  const info = test.info();

  if (metadata.testId) {
    info.annotations.push({ type: 'testId', description: metadata.testId });
  }
  if (metadata.scenarioId) {
    info.annotations.push({ type: 'scenarioId', description: metadata.scenarioId });
  }
  if (metadata.priority) {
    info.annotations.push({ type: 'priority', description: metadata.priority });
  }
  if (metadata.role) {
    info.annotations.push({ type: 'role', description: metadata.role });
  }
  if (metadata.module) {
    info.annotations.push({ type: 'module', description: metadata.module });
  }
  if (metadata.feature) {
    info.annotations.push({ type: 'feature', description: metadata.feature });
  }
  if (metadata.affectedLayer && metadata.affectedLayer.length > 0) {
    info.annotations.push({ type: 'affectedLayer', description: metadata.affectedLayer.join(',') });
  }
  if (metadata.inputData && Object.keys(metadata.inputData).length > 0) {
    info.annotations.push({ type: 'inputData', description: JSON.stringify(metadata.inputData) });
  }
  if (metadata.expectedResult) {
    info.annotations.push({ type: 'expectedResult', description: metadata.expectedResult });
  }
  if (metadata.failureSource) {
    info.annotations.push({ type: 'failureSource', description: metadata.failureSource });
  }
}

/**
 * Capture actual result in test body — call after the action that produces the observable result.
 * This will be picked up by CustomReporter's onTestEnd().
 *
 * @example
 * ```ts
 * await page.click('button[type="submit"]');
 * await expect(page).toHaveURL('/dashboard');
 * captureActualResult('User successfully redirected to dashboard');
 * ```
 */
export function captureActualResult(result: string): void {
  const info = test.info();
  info.annotations.push({ type: 'actualResult', description: result });
}
