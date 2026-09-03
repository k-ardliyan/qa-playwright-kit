/**
 * Standalone Node assert harness (not a Playwright test).
 * MCP parse_requirement_scenarios — authContext + roleScope resolution.
 * Run: npx tsx tools/scripts/__tests__/parse-auth-context.test.ts
 */
import assert from 'node:assert/strict';
import { parseRequirementScenarios } from '../../mcp/src/tools/parse-requirement-scenarios';

function test(name: string, fn: () => void): void {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    process.stdout.write(`  ✗ ${name}\n`);
    throw err;
  }
}

function scenariosOf(out: ReturnType<typeof parseRequirementScenarios>) {
  assert.ok(out.status === 'success', `status=${out.status}`);
  const scenarios = (out as { scenarios?: Array<Record<string, unknown>> }).scenarios;
  assert.ok(scenarios && scenarios.length > 0, 'scenarios present');
  return scenarios!;
}

process.stdout.write('\nparse-auth-context tests\n');

const prev = process.env.APP_ENV;
process.env.APP_ENV = 'local';

const baseMeta = `
# Invoice

## Metadata
- **Auth state:** authenticated
- **Role scope:** finance, hrd

## Skenario Uji
`;

test('authenticated without per-scenario Role → user path (mode general scenario)', () => {
  const text =
    baseMeta +
    `
### SC-01: List visible (@success)

**Langkah:**

1. Buka list

**Hasil yang Diharapkan:**

- List tampil
`;
  const sc = scenariosOf(parseRequirementScenarios({ requirementsText: text }))[0];
  assert.equal(sc.authContext, '.auth/local/user.json');
  assert.equal(sc.roleScope, undefined);
});

test('**Role:** finance in scenario → scoped finance path + roleScope', () => {
  const text =
    baseMeta +
    `
### SC-01: Approve (@success)

- **Role:** finance

**Langkah:**

1. Approve invoice

**Hasil yang Diharapkan:**

- Status approved
`;
  const sc = scenariosOf(parseRequirementScenarios({ requirementsText: text }))[0];
  assert.equal(sc.roleScope, 'finance');
  assert.equal(sc.authContext, '.auth/local/finance.json');
});

test('heading prefix finance: when in Role scope → finance', () => {
  const text =
    baseMeta +
    `
### finance: Reject invoice (@failure)

**Langkah:**

1. Reject

**Hasil yang Diharapkan:**

- Rejected
`;
  const sc = scenariosOf(parseRequirementScenarios({ requirementsText: text }))[0];
  assert.equal(sc.roleScope, 'finance');
  assert.equal(sc.authContext, '.auth/local/finance.json');
});

test('Role: general maps to user credential role', () => {
  const text = `
# Login

## Metadata
- **Auth state:** authenticated

## Skenario Uji

### SC-01: Dashboard (@success)

- **Role:** general

**Langkah:**

1. Buka dashboard

**Hasil yang Diharapkan:**

- Dashboard tampil
`;
  const sc = scenariosOf(parseRequirementScenarios({ requirementsText: text }))[0];
  assert.equal(sc.roleScope, 'user');
  assert.equal(sc.authContext, '.auth/local/user.json');
});

test('single role in Role scope applies when scenario has no Role field', () => {
  const text = `
# Feature

## Metadata
- **Auth state:** authenticated
- **Role scope:** finance

## Skenario Uji

### SC-01: Only finance (@success)

**Langkah:**

1. Open

**Hasil yang Diharapkan:**

- OK
`;
  const sc = scenariosOf(parseRequirementScenarios({ requirementsText: text }))[0];
  assert.equal(sc.roleScope, 'finance');
  assert.equal(sc.authContext, '.auth/local/finance.json');
});

test('unauthenticated stays unauthenticated', () => {
  const text = `
# Public

## Metadata
- **Auth state:** unauthenticated

## Skenario Uji

### SC-01: Landing (@success)

**Langkah:**

1. Open home

**Hasil yang Diharapkan:**

- Page loads
`;
  const sc = scenariosOf(parseRequirementScenarios({ requirementsText: text }))[0];
  assert.equal(sc.authContext, 'unauthenticated');
});

test('APP_ENV=dev scopes path', () => {
  process.env.APP_ENV = 'dev';
  const text =
    baseMeta +
    `
### SC-01: Approve (@success)

- **Role:** hrd

**Langkah:**

1. View

**Hasil yang Diharapkan:**

- Visible
`;
  const sc = scenariosOf(parseRequirementScenarios({ requirementsText: text }))[0];
  assert.equal(sc.authContext, '.auth/dev/hrd.json');
  assert.equal(sc.roleScope, 'hrd');
});

if (prev === undefined) delete process.env.APP_ENV;
else process.env.APP_ENV = prev;

process.stdout.write('\nAll parse-auth-context tests passed.\n');
