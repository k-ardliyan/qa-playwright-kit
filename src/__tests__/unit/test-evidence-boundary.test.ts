import { test, expect } from '@playwright/test';
import { validateTestEvidenceBoundary } from '../../../tools/mcp/src/tools/rules/test-evidence-rules';

const SPEC = 'tests/payroll.spec.ts';

test.describe('generated spec evidence boundary', () => {
  test('rejects raw API calls in normal UI specs', () => {
    const violations = validateTestEvidenceBoundary(
      "test('SC-01', async ({ page }) => { await page.request.get('/api/items'); await page.getByRole('button').click(); await expect(page.getByText('Saved')).toBeVisible(); });",
      'x',
      SPEC,
    );
    expect(violations.some((item) => item.ruleName.includes('raw fetch/request'))).toBe(true);
  });

  test('rejects imported HTTP client calls', () => {
    const violations = validateTestEvidenceBoundary(
      "import axios from 'axios';\naxios.get('https://api.dev.test/items');",
      'x',
      SPEC,
    );
    expect(violations.some((item) => item.ruleName.includes('raw fetch/request'))).toBe(true);
  });

  test('does not flag ordinary UI locator calls', () => {
    const violations = validateTestEvidenceBoundary(
      "test('SC-01', async ({ page }) => { await page.getByRole('button').click(); await expect(page.getByText('Saved')).toBeVisible(); });",
      'x',
      SPEC,
    );
    expect(violations.some((item) => item.ruleName.includes('raw fetch/request'))).toBe(false);
  });

  test('rejects auth-state token extraction', () => {
    const violations = validateTestEvidenceBoundary(
      "const state = fs.readFileSync('.auth/dev/user.json', 'utf8');",
      'x',
      SPEC,
    );
    expect(violations.some((item) => item.ruleName.includes('Auth boundary'))).toBe(true);
  });

  test('accepts declared hybrid setup with browser action and visible assertion', () => {
    const source = [
      "import { apiSeed, apiCleanup } from '@/support/pw';",
      "test('SC-01: view seeded record (@hybrid)', async ({ page, request }) => {",
      "  setTestMetadata({ evidenceMode: 'hybrid-ui' });",
      "  const seeded = await apiSeed(request, '/api/items', { name: 'QA item' });",
      "  await page.goto('/items');",
      "  await expect(page.getByText('QA item')).toBeVisible();",
      '  await apiCleanup(request, `/api/items/${seeded.body.id}`);',
      '});',
    ].join('\n');
    expect(validateTestEvidenceBoundary(source, 'x', SPEC)).toEqual([]);
  });

  test('rejects hybrid API setup without a UI assertion', () => {
    const source = [
      "import { apiSeed } from '@/support/pw';",
      "test('SC-01 (@hybrid)', async ({ page, request }) => {",
      "  setTestMetadata({ evidenceMode: 'hybrid-ui' });",
      "  await apiSeed(request, '/api/items', { name: 'QA item' });",
      "  await page.goto('/items');",
      '});',
    ].join('\n');
    expect(
      validateTestEvidenceBoundary(source, 'x', SPEC).some((item) =>
        item.ruleName.includes('UI result'),
      ),
    ).toBe(true);
  });

  test('rejects broad API cleanup and expected copied as actual', () => {
    const source = [
      "import { apiCleanup } from '@/support/pw';",
      "test('SC-01 (@hybrid)', async ({ page, request }) => {",
      "  setTestMetadata({ evidenceMode: 'hybrid-ui', expectedResult: 'Item saved' });",
      "  await page.getByRole('button', { name: 'Save' }).click();",
      "  await expect(page.getByText('Item saved')).toBeVisible();",
      "  captureActualResult('Item saved');",
      "  await apiCleanup(request, '/api/items');",
      '});',
    ].join('\n');
    const violations = validateTestEvidenceBoundary(source, 'x', SPEC);
    expect(violations.some((item) => item.ruleName.includes('read from the UI'))).toBe(true);
    expect(
      violations.some((item) => item.ruleName.includes('resource ID created by this test')),
    ).toBe(true);
  });

  test('accepts actual values read from UI locator variables', () => {
    const source = [
      "test('SC-01', async ({ page }) => {",
      "  const status = page.getByRole('status');",
      "  await expect(status).toHaveText('Saved');",
      '  const actual = await status.innerText();',
      '  captureActualResult(actual);',
      '});',
    ].join('\n');
    expect(validateTestEvidenceBoundary(source, 'x', SPEC)).toEqual([]);
  });

  test('does not classify live network observation as direct API setup', () => {
    const source = [
      "import { waitAndAssertApi } from '@/support/pw';",
      "test('SC-01 (@network-assert)', async ({ page }) => {",
      "  await waitAndAssertApi(page, { method: 'POST', urlIncludes: '/api/items', status: [201] }, async () => {",
      "    await page.getByRole('button', { name: 'Save' }).click();",
      '  });',
      "  await expect(page.getByText('Saved')).toBeVisible();",
      '});',
    ].join('\n');
    expect(validateTestEvidenceBoundary(source, 'x', SPEC)).toEqual([]);
  });
});
