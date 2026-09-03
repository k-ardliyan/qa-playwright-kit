/**
 * Test inventory contract: Playwright tests and standalone Node harnesses are
 * intentionally separate execution models.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const standaloneHarnesses = [
  'tools/scripts/__tests__/auth-paths.test.ts',
  'tools/scripts/__tests__/env-edit-lib.test.ts',
  'tools/scripts/__tests__/parse-auth-context.test.ts',
  'tools/scripts/__tests__/role-projects.test.ts',
  'tools/scripts/__tests__/wizard-auth-template.test.ts',
  'tools/scripts/__tests__/wizard-login-template.test.ts',
  'src/support/pw/__tests__/file-content-core.test.ts',
  'src/support/pw/__tests__/network-assert-core.test.ts',
  'src/utils/__tests__/dotenv-keys.test.ts',
];

const playwrightTests = [
  'tools/scripts/__tests__/env-use.test.ts',
  'tools/scripts/__tests__/pick-requirement.test.ts',
  'tools/scripts/__tests__/qa-run-contract.test.ts',
  'tools/scripts/__tests__/qa-run.test.ts',
  'src/support/pw/__tests__/../',
  'src/utils/__tests__/env-clean.test.ts',
  'src/utils/__tests__/env-secrets.test.ts',
];

test.describe('test inventory', () => {
  test('standalone harness inventory exists and is not counted as Playwright tests', () => {
    for (const relativePath of standaloneHarnesses) {
      const filePath = path.join(repoRoot, relativePath);
      expect(fs.existsSync(filePath), `missing standalone harness: ${relativePath}`).toBe(true);
      const source = fs.readFileSync(filePath, 'utf8');
      expect(source).toContain('node:assert');
      expect(source).not.toContain("from '@playwright/test'");
      expect(source).not.toContain('from "@playwright/test"');
    }
  });

  test('Playwright inventory remains distinct from direct Node harnesses', () => {
    for (const relativePath of playwrightTests.filter((entry) => !entry.endsWith('/../'))) {
      const filePath = path.join(repoRoot, relativePath);
      expect(fs.existsSync(filePath), `missing Playwright test: ${relativePath}`).toBe(true);
      const source = fs.readFileSync(filePath, 'utf8');
      expect(source).toContain("from '@playwright/test'");
    }
  });
});
