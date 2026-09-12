import { test, expect } from '@playwright/test';
import {
  validateNoEphemeralRefs,
  validateNoHardcodedWaits,
  validateNoInlineAuth,
  validateAuthRolesRegistered,
  validateAuthenticatedSpecsDeclareStorageState,
  validateNoVisiblePseudoClass,
  extractAuthRolesFromSpec,
  looksLikeClonedRoleName,
} from '../../../tools/mcp/src/tools/validate-generated-tests';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const SPEC = 'feature-fixtures.spec.ts'; // non-exempt relative path

test.describe('validate-generated-tests ref/wait rules (MCP-041/042)', () => {
  test('rejects persisted snapshot refs in the real MCP format (ref: <id>)', () => {
    const src = "await page.getByRole('button', { name: 'Save' }).click();\nconst r = { ref: 12 };";
    const violations = validateNoEphemeralRefs(src, 'x', SPEC);
    expect(violations.length).toBe(1);
    expect(violations[0].severity).toBe('error');
    expect(violations[0].ruleName).toContain('Ephemeral ref');
  });

  test('rejects JSON-serialized snapshot refs ("ref": <id>)', () => {
    const src = 'const snap = {"ref": 7, "role": "button"};';
    const violations = validateNoEphemeralRefs(src, 'x', SPEC);
    expect(violations.length).toBe(1);
  });

  test('does NOT flag a legitimate node_id= URL query parameter', () => {
    const src = "await page.goto('/admin/node?id=5&node_id=55');";
    const violations = validateNoEphemeralRefs(src, 'x', SPEC);
    expect(violations).toEqual([]);
  });

  test('does not flag semantic locator usage without refs', () => {
    const src = "await page.getByLabel('Email').fill('a@b.c');";
    expect(validateNoEphemeralRefs(src, 'x', SPEC)).toEqual([]);
  });

  test('warns on page.waitForTimeout but not on bare setTimeout utility code', () => {
    const src = 'await page.waitForTimeout(500);\nawait new Promise(r => setTimeout(r, 200));';
    const violations = validateNoHardcodedWaits(src, 'x', SPEC);
    expect(violations.length).toBe(1);
    expect(violations[0].severity).toBe('warning');
    expect(violations[0].ruleName).toContain('waitForTimeout');
  });

  test('does not warn on observable assertions', () => {
    const src = "await expect(page.getByText('Saved')).toBeVisible();";
    expect(validateNoHardcodedWaits(src, 'x', SPEC)).toEqual([]);
  });

  test('skips traceability-exempt files', () => {
    const src = 'await page.waitForTimeout(500); const r = { ref: 12 };';
    const violations = [
      ...validateNoEphemeralRefs(src, 'x', '__property_p/fixture.spec.ts'),
      ...validateNoHardcodedWaits(src, 'x', '__property_p/fixture.spec.ts'),
    ];
    expect(violations).toEqual([]);
  });
});

test.describe('validate-generated-tests inline-auth rule (CC-AUTH-RECOVERY)', () => {
  test('flags password fill + submit inside a regular spec', () => {
    const src = [
      "await page.goto('https://app.test/login');",
      "await page.fill('input[name=\"email\"]', 'user@example.com');",
      "await page.fill('input[type=\"password\"]', 'secret');",
      'await page.click(\'button[type="submit"]\');',
    ].join('\n');
    const violations = validateNoInlineAuth(src, 'x', 'tests/create-user.spec.ts');
    expect(violations.some((v) => v.ruleName.includes('inline login'))).toBe(true);
  });

  test('flags storage-state injection', () => {
    const src =
      "await browser_set_storage_state({ cookies: [] });\nlocalStorage.setItem('token', 'x');";
    const violations = validateNoInlineAuth(src, 'x', 'tests/create-user.spec.ts');
    expect(violations.some((v) => v.ruleName.includes('storage-state injection'))).toBe(true);
  });

  test('does not flag a login-subject spec (login.feature / @auth)', () => {
    const src =
      "await page.goto('/login');\nawait page.fill('input[type=\"password\"]', 'x');\nawait page.click('button[type=\"submit\"]');";
    expect(validateNoInlineAuth(src, 'x', 'tests/login.spec.ts')).toEqual([]);
    expect(
      validateNoInlineAuth(
        "test.describe('Login', { tag: ['@auth'] }, () => {});\n" + src,
        'x',
        'tests/auth-flow.spec.ts',
      ),
    ).toEqual([]);
  });

  test('does not flag normal authenticated spec actions', () => {
    const src =
      "await page.getByRole('button', { name: 'Approve' }).click();\nawait expect(page.getByText('Approved')).toBeVisible();";
    expect(validateNoInlineAuth(src, 'x', 'tests/invoice-finance.spec.ts')).toEqual([]);
  });
});

test.describe('validate-generated-tests role-vs-env rule (CC-AUTH-RECOVERY)', () => {
  test('extracts roles from authStatePath and .auth paths', () => {
    const src = [
      "test.use({ storageState: authStatePath('finance') });",
      'test.use({ storageState: `.auth/${process.env.APP_ENV}/admin.json` });',
      "test.use({ storageState: '.auth/dev/super-admin.json' });",
    ].join('\n');
    expect(extractAuthRolesFromSpec(src).sort()).toEqual(['admin', 'finance', 'super-admin']);
  });

  test('flags a spec referencing an unregistered role (user-2 clone)', () => {
    const src = "test.use({ storageState: authStatePath('user-2') });";
    withEnv({ USER_2_PASSWORD: undefined, TEST_USER_PASSWORD: undefined }, () => {
      const violations = validateAuthRolesRegistered(src, 'x', 'tests/report.spec.ts');
      expect(violations.length).toBe(1);
      expect(violations[0].ruleName).toContain('user-2');
      expect(violations[0].ruleName).toContain('NEVER duplicate or rename');
    });
  });

  test('flags duplicated-name roles even when the env contract is not loadable', () => {
    // Simulate env unavailability by stubbing the parser seam indirectly:
    // clone-looking names are flagged on naming evidence alone.
    expect(looksLikeClonedRoleName('user-2')).toBe(true);
    expect(looksLikeClonedRoleName('admin-copy')).toBe(true);
    expect(looksLikeClonedRoleName('finance_backup')).toBe(true);
    expect(looksLikeClonedRoleName('finance')).toBe(false);
    expect(looksLikeClonedRoleName('super-admin')).toBe(false);
    expect(looksLikeClonedRoleName('qa-1')).toBe(true); // trailing -N is suspicious; a real "qa-1" role would be env-registered so it still passes the rule
  });

  test('passes when the role is registered in env', () => {
    const src = "test.use({ storageState: authStatePath('finance') });";
    withEnv({ FINANCE_PASSWORD: 'real-pass', FINANCE_EMAIL: 'f@corp.test' }, () => {
      expect(validateAuthRolesRegistered(src, 'x', 'tests/report.spec.ts')).toEqual([]);
    });
  });

  test('passes for specs without auth references', () => {
    const src = "await page.getByRole('button', { name: 'Go' }).click();";
    expect(validateAuthRolesRegistered(src, 'x', 'tests/browse.spec.ts')).toEqual([]);
  });
});

/**
 * Requirement-driven session rule: a spec whose requirement says
 * `Auth state: authenticated` MUST declare a storageState — otherwise it runs
 * with the config default (empty storage) and silently tests the login page.
 * The requirement is resolved from the `// req:` comment (already mandatory).
 */
test.describe('validate-generated-tests authenticated-session rule (CC-AUTH-RECOVERY)', () => {
  function withRequirements(files: Record<string, string>, run: (repo: string) => void): void {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-req-'));
    const reqDir = path.join(repo, 'requirements');
    fs.mkdirSync(reqDir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(reqDir, name), body, 'utf-8');
    }
    try {
      run(repo);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }

  const AUTH_REQ = [
    '# REQ-INV-001: Approve Invoice',
    '## Metadata',
    '- **Auth state:** authenticated',
    '- **Halaman awal:** /finance/invoices',
    '',
  ].join('\n');
  const PUBLIC_REQ = [
    '# REQ-PUB-001: Public Page',
    '## Metadata',
    '- **Auth state:** unauthenticated',
    '- **Halaman awal:** /',
    '',
  ].join('\n');

  const specWith = (extra: string): string =>
    [
      '// spec: requirements/approve-invoice.md',
      '// seed: tests/seed.spec.ts',
      '// req: requirements/approve-invoice.md',
      "import { test } from '@/fixtures/base.fixture';",
      extra,
      "test.describe('x', () => { test('y', async () => {}); });",
    ].join('\n');

  test('flags an authenticated spec that declares no storageState', () => {
    withRequirements({ 'approve-invoice.md': AUTH_REQ }, (repo) => {
      const violations = validateAuthenticatedSpecsDeclareStorageState(
        specWith(''),
        'tests/approve-invoice.spec.ts',
        'tests/approve-invoice.spec.ts',
        repo,
      );
      expect(violations.length).toBe(1);
      expect(violations[0].ruleName).toContain('authenticated');
      expect(violations[0].ruleName).toContain('storageState');
      expect(violations[0].severity).toBe('error');
    });
  });

  test('passes when the authenticated spec declares storageState via authStatePath', () => {
    withRequirements({ 'approve-invoice.md': AUTH_REQ }, (repo) => {
      const src = specWith("test.use({ storageState: authStatePath('finance') });");
      expect(
        validateAuthenticatedSpecsDeclareStorageState(
          src,
          'tests/approve-invoice.spec.ts',
          'tests/approve-invoice.spec.ts',
          repo,
        ),
      ).toEqual([]);
    });
  });

  test('passes for an unauthenticated requirement with no storageState', () => {
    withRequirements({ 'approve-invoice.md': PUBLIC_REQ }, (repo) => {
      expect(
        validateAuthenticatedSpecsDeclareStorageState(
          specWith(''),
          'tests/approve-invoice.spec.ts',
          'tests/approve-invoice.spec.ts',
          repo,
        ),
      ).toEqual([]);
    });
  });

  test('passes for a login-subject spec (login*.spec.ts / @auth) even when authenticated', () => {
    withRequirements({ 'approve-invoice.md': AUTH_REQ }, (repo) => {
      expect(
        validateAuthenticatedSpecsDeclareStorageState(
          specWith(''),
          'tests/login.spec.ts',
          'tests/login.spec.ts',
          repo,
        ),
      ).toEqual([]);
      const tagged = specWith("test.describe('L', { tag: ['@auth'] }, () => {});");
      expect(
        validateAuthenticatedSpecsDeclareStorageState(
          tagged,
          'tests/auth-flow.spec.ts',
          'tests/auth-flow.spec.ts',
          repo,
        ),
      ).toEqual([]);
    });
  });

  test('stays silent when the requirement file or // req: comment is absent', () => {
    withRequirements({}, (repo) => {
      expect(
        validateAuthenticatedSpecsDeclareStorageState(
          specWith(''),
          'tests/approve-invoice.spec.ts',
          'tests/approve-invoice.spec.ts',
          repo,
        ),
      ).toEqual([]);
      const noReq = [
        "import { test } from '@/fixtures/base.fixture';",
        "test.describe('x', () => { test('y', async () => {}); });",
      ].join('\n');
      expect(
        validateAuthenticatedSpecsDeclareStorageState(
          noReq,
          'tests/approve-invoice.spec.ts',
          'tests/approve-invoice.spec.ts',
          repo,
        ),
      ).toEqual([]);
    });
  });

  test('accepts a literal .auth path declaration', () => {
    withRequirements({ 'approve-invoice.md': AUTH_REQ }, (repo) => {
      const src = specWith("test.use({ storageState: '.auth/dev/finance.json' });");
      expect(
        validateAuthenticatedSpecsDeclareStorageState(
          src,
          'tests/approve-invoice.spec.ts',
          'tests/approve-invoice.spec.ts',
          repo,
        ),
      ).toEqual([]);
    });
  });

  test('skips traceability-exempt files', () => {
    withRequirements({ 'approve-invoice.md': AUTH_REQ }, (repo) => {
      expect(
        validateAuthenticatedSpecsDeclareStorageState(
          specWith(''),
          'tests/demo/demo-x.spec.ts',
          'tests/demo/demo-x.spec.ts',
          repo,
        ),
      ).toEqual([]);
    });
  });
});

test.describe('validate-generated-tests :visible pseudo-class rule (Playwright 2026)', () => {
  test('flags :visible in locator string with warning severity', () => {
    const src = "await page.locator('button:visible').click();";
    const violations = validateNoVisiblePseudoClass(
      src,
      'tests/sample.spec.ts',
      'tests/sample.spec.ts',
    );
    expect(violations.length).toBe(1);
    expect(violations[0].severity).toBe('warning');
    expect(violations[0].ruleName).toContain(':visible');
    expect(violations[0].ruleName).toContain('locator.visible()');
  });

  test('passes for native locator.visible()', () => {
    const src = "await page.locator('button').visible().click();";
    const violations = validateNoVisiblePseudoClass(
      src,
      'tests/sample.spec.ts',
      'tests/sample.spec.ts',
    );
    expect(violations.length).toBe(0);
  });
});
