import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { listRequirementFiles } from '../pick-requirement';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

test.describe('listRequirementFiles', () => {
  test('lists sample requirements and skips templates', () => {
    const files = listRequirementFiles(repoRoot);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith('requirements/') && f.endsWith('.md'))).toBe(true);
    expect(files.some((f) => f.includes('_TEMPLATE'))).toBe(false);
    expect(files.some((f) => f.endsWith('README.md'))).toBe(false);
    // Every underscore-prefixed file is internal (templates, fixtures).
    expect(files.some((f) => f.split('/').pop()?.startsWith('_'))).toBe(false);
    expect(files).toContain('requirements/auth/login-none.md');
  });
});
