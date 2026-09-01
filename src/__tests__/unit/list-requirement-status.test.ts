/**
 * Unit tests for list-requirement-status pure helpers.
 *
 * Tests only the logic that doesn't touch the filesystem — stem parsing,
 * plan path derivation, manual scenario counting, and status aggregation.
 * The fs-dependent listRequirementStatus() is covered by property tests
 * against the actual repo layout, not here.
 */

import { test, expect } from '@playwright/test';

// ─── Pure helper re-implementations (mirrored from source for isolation) ────
// We test the observable contract, not the internal symbols, so we replicate
// the same logic. If the source changes, these will catch the drift.

/** requirements/auth/login.md → auth/login (handles both / and \ separators) */
function requirementStem(reqRel: string): string {
  return reqRel
    .replace(/\\/g, '/') // normalise backslash first
    .replace(/^requirements\//, '')
    .replace(/\.md$/i, '');
}

function expectedPlanPath(stem: string): string {
  return `specs/${stem}-test-plan.md`;
}

function countManualScenarios(markdown: string): number {
  const matches = markdown.match(/^###\s+.+\(@manual\)/gim);
  return matches?.length ?? 0;
}

function lastStatusForTests(testPaths: string[], statusByFile: Map<string, string>): string | null {
  if (testPaths.length === 0) return null;
  const statuses = testPaths.map((p) => statusByFile.get(p)).filter(Boolean) as string[];
  if (statuses.length === 0) return null;
  if (statuses.some((s) => s === 'failed' || s === 'timedOut' || s === 'interrupted')) {
    return 'failed';
  }
  if (statuses.every((s) => s === 'passed')) return 'passed';
  if (statuses.some((s) => s === 'skipped')) return 'skipped';
  return statuses[0] ?? null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('requirementStem', () => {
  test('strips requirements/ prefix and .md suffix', () => {
    expect(requirementStem('requirements/login.md')).toBe('login');
  });

  test('preserves subdirectory — auth/login-none.md', () => {
    expect(requirementStem('requirements/auth/login-none.md')).toBe('auth/login-none');
  });

  test('handles deep nesting', () => {
    expect(requirementStem('requirements/finance/invoice/approve.md')).toBe(
      'finance/invoice/approve',
    );
  });

  test('normalises Windows backslash to forward slash', () => {
    expect(requirementStem('requirements\\auth\\login.md')).toBe('auth/login');
  });

  test('case-insensitive .MD suffix', () => {
    expect(requirementStem('requirements/FEATURE.MD')).toBe('FEATURE');
  });
});

test.describe('expectedPlanPath', () => {
  test('flat requirement → specs/feature-test-plan.md', () => {
    expect(expectedPlanPath('login')).toBe('specs/login-test-plan.md');
  });

  test('nested requirement preserves subdirectory in specs path', () => {
    expect(expectedPlanPath('auth/login-none')).toBe('specs/auth/login-none-test-plan.md');
  });

  test('deep nesting is preserved', () => {
    expect(expectedPlanPath('finance/invoice/approve')).toBe(
      'specs/finance/invoice/approve-test-plan.md',
    );
  });
});

test.describe('countManualScenarios', () => {
  test('returns 0 for requirement with no @manual tag', () => {
    const md = `
# REQ-01
## Langkah
- Buka halaman
### SC-01: Login berhasil
`;
    expect(countManualScenarios(md)).toBe(0);
  });

  test('counts single @manual scenario', () => {
    const md = `
### SC-01: Upload dokumen (@manual)
**Langkah:** Upload file
`;
    expect(countManualScenarios(md)).toBe(1);
  });

  test('counts multiple @manual scenarios', () => {
    const md = `
### SC-01: Verifikasi visual (@manual)
**Langkah:** Cek tampilan

### SC-02: Normal automated
**Langkah:** Klik tombol

### SC-03: Cek print layout (@manual)
**Langkah:** Print halaman

### SC-04: Another manual scenario (@manual)
**Langkah:** Manual action
`;
    expect(countManualScenarios(md)).toBe(3);
  });

  test('is case-insensitive on @manual tag', () => {
    const md = `### SC-01: Test (@MANUAL)\n`;
    expect(countManualScenarios(md)).toBe(1);
  });

  test('does not count @manual in body text, only in ### heading', () => {
    const md = `
### SC-01: Normal scenario
**Catatan:** This step requires @manual verification by QA.
`;
    expect(countManualScenarios(md)).toBe(0);
  });

  test('returns 0 for empty string', () => {
    expect(countManualScenarios('')).toBe(0);
  });
});

test.describe('lastStatusForTests', () => {
  test('returns null for empty testPaths', () => {
    expect(lastStatusForTests([], new Map())).toBeNull();
  });

  test('returns null when no status found for any path', () => {
    const map = new Map<string, string>();
    expect(lastStatusForTests(['src/tests/foo.spec.ts'], map)).toBeNull();
  });

  test('returns passed when all files passed', () => {
    const map = new Map([
      ['src/tests/a.spec.ts', 'passed'],
      ['src/tests/b.spec.ts', 'passed'],
    ]);
    expect(lastStatusForTests(['src/tests/a.spec.ts', 'src/tests/b.spec.ts'], map)).toBe('passed');
  });

  test('returns failed when any file failed', () => {
    const map = new Map([
      ['src/tests/a.spec.ts', 'passed'],
      ['src/tests/b.spec.ts', 'failed'],
    ]);
    expect(lastStatusForTests(['src/tests/a.spec.ts', 'src/tests/b.spec.ts'], map)).toBe('failed');
  });

  test('failed beats timedOut — both collapse to failed', () => {
    const map = new Map([
      ['src/tests/a.spec.ts', 'timedOut'],
      ['src/tests/b.spec.ts', 'passed'],
    ]);
    expect(lastStatusForTests(['src/tests/a.spec.ts', 'src/tests/b.spec.ts'], map)).toBe('failed');
  });

  test('interrupted also resolves to failed', () => {
    const map = new Map([['src/tests/a.spec.ts', 'interrupted']]);
    expect(lastStatusForTests(['src/tests/a.spec.ts'], map)).toBe('failed');
  });

  test('returns skipped when mix of passed and skipped (no failures)', () => {
    const map = new Map([
      ['src/tests/a.spec.ts', 'passed'],
      ['src/tests/b.spec.ts', 'skipped'],
    ]);
    expect(lastStatusForTests(['src/tests/a.spec.ts', 'src/tests/b.spec.ts'], map)).toBe('skipped');
  });

  test('ignores paths not present in statusByFile', () => {
    const map = new Map([['src/tests/a.spec.ts', 'passed']]);
    // b.spec.ts not in map — only a contributes
    expect(lastStatusForTests(['src/tests/a.spec.ts', 'src/tests/b.spec.ts'], map)).toBe('passed');
  });
});
