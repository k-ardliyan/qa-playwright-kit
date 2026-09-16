/**
 * Unit tests for the role credential schema — company/tenant keys.
 * Run: npx playwright test src/__tests__/unit/role-credentials.test.ts -c config/playwright/unit.ts
 */
import { test, expect } from '@playwright/test';
import {
  ROLE_KEY_RE,
  ROLE_SUFFIXES,
  roleCredentialKeys,
  roleFieldsToEnvUpserts,
} from '@/shared/utils/role-credentials';

test.describe('company / tenant keys', () => {
  test('roleCredentialKeys exposes company keys per role prefix', () => {
    expect(roleCredentialKeys('finance')).toMatchObject({
      companyKey: 'FINANCE_COMPANY',
      companySelectorKey: 'FINANCE_COMPANY_SELECTOR',
    });
    expect(roleCredentialKeys('user').companyKey).toBe('TEST_USER_COMPANY');
  });

  test('ROLE_KEY_RE parses company suffixes with the longest match first', () => {
    expect(ROLE_KEY_RE.exec('FINANCE_COMPANY')?.[1]).toBe('FINANCE');
    expect(ROLE_KEY_RE.exec('FINANCE_COMPANY_SELECTOR')?.[1]).toBe('FINANCE');
    expect(ROLE_KEY_RE.exec('ADMIN_ACME_COMPANY')?.[1]).toBe('ADMIN_ACME');
    expect(ROLE_KEY_RE.exec('FINANCE_COMPANY_EXTRA')).toBeNull();
    expect(ROLE_SUFFIXES).toContain('COMPANY_SELECTOR');
  });

  test('roleFieldsToEnvUpserts emits COMPANY only when set', () => {
    const withCompany = roleFieldsToEnvUpserts('finance', { password: 'x', company: 'acme' });
    expect(withCompany.FINANCE_COMPANY).toBe('acme');

    const without = roleFieldsToEnvUpserts('finance', { password: 'x', company: '  ' });
    expect(without.FINANCE_COMPANY).toBeUndefined();
  });
});
