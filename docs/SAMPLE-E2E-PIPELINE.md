# End-to-End AI Agent Pipeline Walkthrough

> **Purpose:** Complete working example of QA Playwright Kit pipeline from requirement to report  
> **When to use:** New team members learning the workflow, debugging pipeline issues  
> **Related:** [AGENTS.md](../AGENTS.md), [GUIDE.md](GUIDE.md)

---

## 📋 Overview: The 6-Phase Pipeline

```
Requirement → Validate → Plan → Generate → Execute → Heal → Report
     ↓            ↓         ↓         ↓          ↓        ↓       ↓
  Markdown    Format     Scenarios   Tests      Run     Fixes   Decision
```

This document walks through a **complete end-to-end execution** with actual outputs.

---

## 🎯 Scenario: Login Flow Testing

We'll test a login feature with multiple roles: `general`, `super-admin`, `finance`.

### Step 0: Prerequisites

#### Requirement File Already Written

```bash
requirements/auth/login-flow.md exists
```

Content preview (simplified):

```markdown
# Requirement: Login Flow

## SC-01: Valid credentials login (@success @aria)

**Role scope:** general
**Input Data:** email=test@example.com, password=valid123
**Expected Result:** Redirect to dashboard

## SC-02: Invalid password (@failure)

**Role scope:** general
**Input Data:** email=test@example.com, password=wrong
**Expected Result:** Show "Invalid credentials" error

## SC-03: Super-admin access to admin panel (@access-restriction)

**Role scope:** super-admin
**Input Data:** email=admin@example.com, password=admin123
**Expected Result:** Redirect to admin dashboard
```

#### Auth State Files Ready

```bash
.auth/local/user.json          # For general scenarios
.auth/local/super-admin.json   # For super-admin scenarios
```

Run setup if missing:

```bash
npm run auth:setup
# atau scoped per role: npx playwright test tests/auth.setup.ts --project=setup --workers=1
```

---

## Phase 1: Validation

**Command:**

```bash
npm run validate:requirement requirements/auth/login-flow.md
```

**Output:**

```json
{
  "valid": true,
  "scenarios": [
    {
      "testId": "TC-AUTH-001",
      "priority": "high",
      "inputData": { "email": "test@example.com", "password": "valid123" },
      "expectedResult": "Redirect to dashboard",
      "affectedLayer": ["FE"]
    },
    {
      "testId": "TC-AUTH-002",
      "priority": "medium",
      "inputData": { "email": "test@example.com", "password": "wrong" },
      "expectedResult": "Show 'Invalid credentials' error",
      "affectedLayer": ["FE"]
    },
    {
      "testId": "TC-AUTH-003",
      "priority": "high",
      "inputData": { "email": "admin@example.com", "password": "admin123" },
      "expectedResult": "Redirect to admin dashboard",
      "affectedLayer": ["FE", "DB"]
    }
  ],
  "roleScope": ["general", "super-admin"],
  "capabilities": ["aria"]
}
```

**Validation Rules Checked:**

1. ✅ Each scenario has unique Test ID (`TC-XXX-NNN`)
2. ✅ Priority levels defined (`high`/`medium`/`low`)
3. ✅ Input Data matches Expected Result
4. ✅ Affected Layer declared
5. ✅ Tags match scenario intent (`@success`, `@failure`, `@access-restriction`)
6. ✅ Role scope valid against `.auth/` files

**Next Step:** If validation fails → edit requirement file and re-run

---

## Phase 2: Planning

**MCP Tool (via agent):**

```bash
qa-playwright-kit → compile_test_plan  # compile validated requirement into TestPlanContractV1
```

**Agent Actions:**

1. Reads validated requirement
2. Uses MCP tools for context:
   - `parse_requirement_scenarios` → extracts structured data
   - `list_requirement_status` → checks existing coverage
   - `snapshot_page` (optional) → captures ARIA snapshots for `@aria` scenarios
3. Applies planning rules from `planner.agent.md`:
   - Split into role-specific scenario groups
   - Assign Auth Context per group
   - Flag access-restriction scenarios
   - Identify coverage gaps

**Output File:** `specs/login-flow-test-plan.md`

Preview:

```markdown
<!-- req: requirements/auth/login-flow.md -->
<!-- generated-at: 2026-07-28T10:30:00Z -->

# Test Plan: Login Flow

## Application Overview

Web application authentication system supporting multiple user roles.

---

## Scenario Group: General Users

| Scenario                       | Steps                                                                 | Expected Result                  | Test ID     | Priority | Auth Context                |
| --- | --- | --- | --- | --- | --- |
| SC-01: Valid credentials login | 1. Navigate to /login<br>2. Enter email & password<br>3. Click Submit | Redirect to dashboard            | TC-AUTH-001 | high     | `.auth/{APP_ENV}/user.json` |
| SC-02: Invalid password        | 1. Navigate to /login<br>2. Enter wrong password<br>3. Click Submit   | Show "Invalid credentials" error | TC-AUTH-002 | medium   | `.auth/{APP_ENV}/user.json` |

---

## Scenario Group: Super Admin

| Scenario                  | Steps                                                                  | Expected Result              | Test ID     | Priority | Auth Context                       |
| --- | --- | --- | --- | --- | --- |
| SC-03: Admin panel access | 1. Navigate to /login<br>2. Enter admin credentials<br>3. Click Submit | Redirect to /admin/dashboard | TC-AUTH-003 | high     | `.auth/{APP_ENV}/super-admin.json` |

---

## Coverage Gap

No coverage gaps identified.

## Manual Notes

No manual scenarios.
```

**Next Step:** Review plan for accuracy → approve or request revision

---

## Phase 3: Generation

**MCP Tool (via agent):**

```bash
qa-playwright-kit → validate_generated_tests  # structural gate for the generated .spec.ts files
```

**Agent Actions:**

1. Reads test plan table rows
2. Applies generation rules from `generator.agent.md`:
   - Import from `./fixtures` (adapter re-exporting framework fixtures)
   - Create one spec file **per role**: `*-user.spec.ts`, `*-super-admin.spec.ts`
   - Call `setTestMetadata(test, ...)` as first statement
   - Apply auth state via `authStatePath('<role>')` helper
   - Match capability tags to helper usage (ARIA, network, etc.)
3. Validates generated code using `validate_generated_tests`

**Generated Files:**

### File 1: `tests/login-flow-user.spec.ts`

```typescript
import { test, expect } from './fixtures';
import { authStatePath, setTestMetadata } from '@/public';
import type { TestMetadata } from '@/shared/types';

test.describe('Login Flow - User', () => {
  test.use({
    storageState: authStatePath('user'),
  });

  // Metadata set FIRST before any action
  test('TC-AUTH-001: Valid credentials login', async ({ page }) => {
    setTestMetadata<TestMetadata>(test, {
      testId: 'TC-AUTH-001',
      priority: 'high',
      inputData: { email: 'test@example.com', password: 'valid123' },
      expectedResultFormatted: 'Redirect to dashboard',
      affectedLayer: ['FE'],
    });

    await test.step('Navigate to login', async () => {
      await page.goto('/login');
    });

    await test.step('Enter credentials', async () => {
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password').fill('valid123');
    });

    await test.step('Submit form', async () => {
      await page.getByRole('button', { name: 'Login' }).click();
    });

    await test.step('Assert redirect', async () => {
      await expect(page).toHaveURL(/.*\/dashboard$/);
    });
  });

  test('TC-AUTH-002: Invalid password', async ({ page }) => {
    setTestMetadata<TestMetadata>(test, {
      testId: 'TC-AUTH-002',
      priority: 'medium',
      inputData: { email: 'test@example.com', password: 'wrong' },
      expectedResultFormatted: "Show 'Invalid credentials' error",
      affectedLayer: ['FE'],
    });

    await test.step('Navigate to login', async () => {
      await page.goto('/login');
    });

    await test.step('Enter invalid credentials', async () => {
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password').fill('wrong');
    });

    await test.step('Submit form', async () => {
      await page.getByRole('button', { name: 'Login' }).click();
    });

    await test.step('Assert error message', async () => {
      await expect(page.getByText('Invalid credentials')).toBeVisible();
    });
  });
});
```

### File 2: `tests/login-flow-super-admin.spec.ts`

```typescript
import { test, expect } from './fixtures';
import { authStatePath, setTestMetadata } from '@/public';
import type { TestMetadata } from '@/shared/types';

test.describe('Login Flow - Super Admin', () => {
  test.use({
    storageState: authStatePath('super-admin'),
  });

  test('TC-AUTH-003: Admin panel access', async ({ page }) => {
    setTestMetadata<TestMetadata>(test, {
      testId: 'TC-AUTH-003',
      priority: 'high',
      inputData: { email: 'admin@example.com', password: 'admin123' },
      expectedResultFormatted: 'Redirect to /admin/dashboard',
      affectedLayer: ['FE', 'DB'],
    });

    await test.step('Navigate to login', async () => {
      await page.goto('/login');
    });

    await test.step('Enter admin credentials', async () => {
      await page.getByLabel('Email').fill('admin@example.com');
      await page.getByLabel('Password').fill('admin123');
    });

    await test.step('Submit form', async () => {
      await page.getByRole('button', { name: 'Login' }).click();
    });

    await test.step('Assert redirect', async () => {
      await expect(page).toHaveURL(/.*\/admin\/dashboard$/);
    });
  });
});
```

**Validation Output:**

```bash
✅ tests/login-flow-user.spec.ts - PASSED (all tags matched)
✅ tests/login-flow-super-admin.spec.ts - PASSED (all tags matched)
✅ Type safety: TypeScript compilation successful
✅ Import paths: All imports resolve correctly
```

**Next Step:** Generate tests are valid → proceed to execution

---

## Phase 4: Execution

**Command:**

```bash
npx playwright test --project=chromium
```

**Or Specific Test Files:**

```bash
npx playwright test tests/login-flow-user.spec.ts
npx playwright test tests/login-flow-super-admin.spec.ts
```

**Output Structure:**

### Standard Output

```
Running 3 tests using 3 workers

[1/3] login-flow-general.spec.ts: TC-AUTH-001: Valid credentials login
[2/3] login-flow-general.spec.ts: TC-AUTH-002: Invalid password
[3/3] login-flow-super-admin.spec.ts: TC-AUTH-003: Admin panel access

  1 ✓  login-flow-general.spec.ts: TC-AUTH-001: Valid credentials login (2.3s)
  2 ✓  login-flow-general.spec.ts: TC-AUTH-002: Invalid password (1.8s)
  3 ✓  login-flow-super-admin.spec.ts: TC-AUTH-003: Admin panel access (2.1s)

  3 passed (8.5s)
```

### Generated Artifacts

#### `reports/test-summary.json`

```json
{
  "totalTests": 3,
  "passed": 3,
  "failed": 0,
  "skipped": 0,
  "duration": 8500,
  "byFile": [
    {
      "file": "tests/login-flow-general.spec.ts",
      "total": 2,
      "passed": 2,
      "failed": 0
    },
    {
      "file": "tests/login-flow-super-admin.spec.ts",
      "total": 1,
      "passed": 1,
      "failed": 0
    }
  ]
}
```

#### `artifacts/test-results/` Directory

```
artifacts/test-results/
├── login-flow-general-TCAUTH001-Valid-credentials-login/
│   ├── screenshot-1.png
│   ├── trace.zip
│   └── video.webm
├── login-flow-general-TCAUTH002-Invalid-password/
│   ├── screenshot-1.png
│   └── trace.zip
└── login-flow-super-admin-TCAUTH003-Admin-panel-access/
    ├── screenshot-1.png
    └── trace.zip
```

---

## Phase 5: Healing (If Failures Occur)

Assume **TC-AUTH-002 failed** with timeout error.

### Get Failure Details

**Command:**

```bash
MCP: qa-playwright-kit → get_test_failures
```

**Failure Payload:**

```json
{
  "failures": [
    {
      "filePath": "tests/login-flow-general.spec.ts",
      "lineNumber": 38,
      "errorMessage": "Timeout 30000ms exceeded while waiting for \"Invalid credentials\" to be visible",
      "tracePath": "artifacts/test-results/.../trace.zip",
      "screenshotPath": "artifacts/test-results/.../screenshot-1.png",
      "rootCause": "locator",
      "failureSource": "app"
    }
  ]
}
```

### Healer Analysis

**Pattern Lookup:** Check `pattern-database.ts` for similar errors

**Match Found:**

```typescript
{
  signature: { errorType: 'locator', pageContext: 'login-page' },
  fixTemplate: {
    type: 'locator_update',
    description: 'Error message uses different class structure',
    codeTemplate: "page.getByText('Invalid credentials').first()"
  }
}
```

### Apply Fix

**Updated Code:**

```typescript
await test.step('Assert error message', async () => {
  // Changed from: await expect(page.getByText('Invalid credentials')).toBeVisible();
  await expect(page.getByText('Invalid credentials').first()).toBeVisible();
});
```

### Re-validate & Re-run

**Commands:**

```bash
npm run validate
npx playwright test tests/login-flow-general.spec.ts --grep "TC-AUTH-002"
```

**Output After Healing:**

```
  1 ✓  login-flow-general.spec.ts: TC-AUTH-002: Invalid password (1.9s)
  1 passed (2.1s)
```

**Pattern Database Updated:**

```json
{
  "patterns": [
    {
      "signature": { "errorType": "locator", "pageContext": "login-page" },
      "confidence": 0.95,
      "lastUpdated": "2026-07-28T11:45:00Z"
    }
  ]
}
```

---

## Phase 6: Reporting

**Command:**

```bash
# Reporter Agent builds the pipeline report, then persist via MCP:
MCP: qa-playwright-kit → get_test_summary
MCP: qa-playwright-kit → archive_report --runId=<pipeline-run-uuid> --reportPath=artifacts/reports/pipeline-report-<runId>.md
```

**Inputs Received:**

- `get_test_summary` → pass/fail counts
- `get_test_failures` → detailed failure data (empty if all pass)
- Pipeline context (requirement path, rolesInScope, healingResults)

**Outputs Generated:**

### 1. JSON Pipeline Report

`artifacts/reports/pipeline-report-<runId>.json`

```json
{
  "runId": "abc123-def456-ghi789",
  "requirementPath": "requirements/auth/login-flow.md",
  "mode": "role-aware",
  "rolesInScope": ["user", "super-admin"],
  "summaryByRole": {
    "user": { "passed": 2, "failed": 0, "skipped": 0 },
    "super-admin": { "passed": 1, "failed": 0, "skipped": 0 }
  },
  "testCases": [
    {
      "testId": "TC-AUTH-001",
      "scenarioId": "SC-01",
      "status": "passed",
      "duration": 2300,
      "annotations": { "priority": "high", "layer": ["FE"] }
    },
    {
      "testId": "TC-AUTH-002",
      "scenarioId": "SC-02",
      "status": "passed",
      "healed": true,
      "duration": 1900
    },
    {
      "testId": "TC-AUTH-003",
      "scenarioId": "SC-03",
      "status": "passed",
      "duration": 2100
    }
  ],
  "unresolvedFailures": [],
  "healingResults": {
    "fixesApplied": 1,
    "cannotFix": [],
    "patternsLearned": 1
  },
  "coverage": {
    "scenariosPlanned": 3,
    "scenariosTested": 3,
    "coveragePercentage": 100
  },
  "qaDecision": null
}
```

### 2. Markdown Pipeline Report

`artifacts/reports/pipeline-report-<runId>.md`

Preview:

```markdown
# Pipeline Report: Login Flow

**Run ID:** abc123-def456-ghi789  
**Started At:** 2026-07-28T10:30:00Z  
**Requirement:** requirements/auth/login-flow.md

## Summary

| Metric            | Value |
| --- | --- |
| Scenarios planned | 3     |
| Tests generated   | 3     |
| Tests passing     | 3     |
| Tests failing     | 0     |
| Tests healed      | 1     |
| Tests skipped     | 0     |

### By Role

| Role        | Passing | Failing | Skipped |
| --- | --- | --- | --- |
| user        | 2       | 0       | 0       |
| super-admin | 1       | 0       | 0       |

## Coverage

| Scenario                       | Type               | Role        | Status    |
| --- | --- | --- | --- |
| SC-01: Valid credentials login | success            | user        | ✅ passed |
| SC-02: Invalid password        | failure            | user        | 🔧 healed |
| SC-03: Admin panel access      | access-restriction | super-admin | ✅ passed |

## Unresolved Failures

No unresolved failures.

## QA Decision

Review the results above and pick one decision.

**[X] ✅ APPROVE** — All scenarios pass. Requirement validated. Mark tests as regression baseline.

[ ] 🐛 FILE BUG — Failure source: `app`. Create defect ticket. Keep test as regression guard.

[ ] 📝 REVISE REQUIREMENT — Failure source: `requirement`. Update requirement → regenerate → rerun.

[ ] 🔧 FIX TEST / GENERATOR — Failure source: `test` or `ai_generation`. Fix test code.

[ ] 🔧 FIX ENVIRONMENT — Failure source: `env`. Fix auth setup or env config.

[ ] 🚫 MARK BLOCKED — Cannot resolve now. Keep trace/screenshot. Continue triage later.

---

_Generated by Reporter Agent — QA Playwright Kit Framework_
```

### 3. Archive Report

**Command:**

```bash
MCP: qa-playwright-kit → archive_report --runId=abc123-def456-ghi789 --reportPath=artifacts/reports/pipeline-report-<runId>.md
```

**Archive Created:** `artifacts/reports/archive/abc123-def456-ghi789/`
Contains:

- `pipeline-report.md`
- `pipeline-report.json`
- `test-summary.json`
- `selector-catalog/` (if captured during run)
- `traces/` (compressed traces for failed tests)

---

## 🎉 Final QA Decision Workflow

After reviewing the pipeline report:

### Option A: Approve ✅

All tests pass → tests become regression baseline

**Action:**

```bash
git add tests/login-flow*.spec.ts
git commit -m "feat(tests): add login flow tests for user & super-admin roles"
```

### Option B: File Bug 🐛

Failure source: `app` → bug in application logic

**Action:**

- Link test case ID to issue tracker
- Include trace/screenshot evidence
- Update requirement status to "blocked"

### Option C: Revise Requirement 📝

Scenario unclear or missing edge cases

**Action:**

- Edit `requirements/auth/login-flow.md`
- Add missing scenarios
- Re-run: plan → generate → execute

### Option D: Fix Test Code 🔧

Test implementation doesn't match scenario intent

**Action:**

- Manually edit failing `.spec.ts`
- Re-run: validate → execute
- Update pattern database if recurring issue

---

## 🔄 Continuous Improvement Loop

After each pipeline run, update documentation:

### Lessons Learned (`docs/architecture/LESSONS-LEARNED.md`)

Append new patterns:

```markdown
## 2026-07-28 | tests/login-flow-general.spec.ts | Timeout waiting for error text | Locator mismatch | Changed to getByText().first()
```

### Pattern Database (`src/agents/healer/pattern-database.ts`)

If a new failure pattern emerges that's worth remembering for next time

### Selector Catalog (`artifacts/selector-catalog/`)

If new selectors discovered that should be preserved:

```bash
MCP: qa-playwright-kit → snapshot_page --url=/login --output=artifacts/selector-catalog/login/
```

---

## 📌 Quick Reference: Commands Used

```bash
# Validation
npm run validate:requirement requirements/auth/login-flow.md

# Planning
MCP: qa-playwright-kit → compile_test_plan (Planning)

# Generation
MCP: qa-playwright-kit → validate_generated_tests (Generation)

# Test Execution
npx playwright test --project=chromium
npx playwright test tests/login-flow-general.spec.ts

# Failure Diagnosis
MCP: qa-playwright-kit → get_test_failures

# Healing (automatic via agent)
MCP: qa-playwright-kit → run_generated_tests  # healer re-runs after fix

# Reporting
Reporter Agent → dashboard/report; then MCP: qa-playwright-kit → archive_report

# Archiving
MCP: qa-playwright-kit → archive_report --runId=<uuid> --reportPath=artifacts/reports/pipeline-report-<runId>.md
```

---

## 🚀 Next Steps After Successful Pipeline

1. **Commit tests** to repository (do not include `.auth/` files)
2. **Update directory map** in `docs/architecture/DIRECTORY-MAP.md`
3. **Add CI workflow** to run tests on PR (see `.github/workflows/playwright.yml`)
4. **Set up dashboard** to monitor test health over time
5. **Schedule nightly runs** for critical paths in staging environment

---

_Walkthrough created: 2026-07-28_  
_Based on real pipeline execution from requirements/auth/login-flow.md_  
_Related: [AGENTS.md](../AGENTS.md), [CHEATSHEET.md](CHEATSHEET.md)_
