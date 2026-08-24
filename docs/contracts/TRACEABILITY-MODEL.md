# Traceability & Coverage Model

> Konsep closed-loop traceability + model coverage 4-dimensi QA Playwright Kit.
> Spec schema mesin: [`TRACEABILITY-CONTRACT.md`](TRACEABILITY-CONTRACT.md).
> *(Merge dari `docs/TRACEABILITY.md` + `docs/contracts/COVERAGE-MODEL.md` — 2026-08-22.)*

This document defines the closed-loop traceability graph and the 4-dimensional coverage lifecycle in the QA Playwright Kit framework.

---

## 1. Traceability Model Overview

The framework guarantees **closed-loop traceability** from written business requirements to executable Playwright tests and final QA reporting.

```text
Requirement Markdown (requirements/*.md)
        ↓
compile_requirement  →  RequirementContractV1 (id, acceptanceCriteria, scenarios)
        ↓
Planner Agent
        ↓
Plan Markdown (specs/*.md)
        ↓
compile_test_plan   →  TestPlanContractV1 (id, sourceRequirementHash, scenarios)
        ↓
validate_plan (Markdown-native)
        ↓
Generator Agent
        ↓
Playwright Test Specs (tests/*.spec.ts with setTestMetadata())
        ↓
Execute (playwright-test)  →  Test Results (results.json, test-summary.json)
        ↓
trace_requirement   →  TraceabilityContractV1 (Graph & 4D Metrics)
        ↓
Reporter Agent      →  Pipeline Report & Custom Dashboard
```

---

## 2. Four-Dimensional Coverage State

Coverage is not a single binary boolean. It is tracked across **four distinct, orthogonal dimensions**:

```text
Requirement / Plan       Generator            Test Runner           Reporter / QA
┌─────────────────┐   ┌───────────────┐   ┌─────────────────┐   ┌──────────────────┐
│   1. Design     │ → │ 2. Automation │ → │  3. Execution   │ → │ 4. Verification  │
│ planned         │   │ automated     │   │ executed        │   │ passed           │
│ unplanned       │   │ manual        │   │ not-executed    │   │ failed           │
│                 │   │ mixed         │   │                 │   │ healed           │
│                 │   │ unautomated   │   │                 │   │ unverified       │
└─────────────────┘   └───────────────┘   └─────────────────┘   └──────────────────┘
```

### 2.1. Design State (`design`)

- `planned`: A corresponding test plan exists in `specs/`.
- `unplanned`: No test plan exists yet.

### 2.2. Automation State (`automation`)

- `automated`: Test specs exist under `tests/` with no manual scenarios.
- `manual`: Only `@manual` scenarios exist in requirement.
- `mixed`: Both automated tests and `@manual` scenarios exist.
- `unautomated`: No test spec generated yet.
- `generated` / `not-generated` / `blocked`: nilai tambahan yang juga valid di `CoverageStateBreakdown` (`tools/mcp/src/contracts/traceability-contract.ts`).

### 2.3. Execution State (`execution`)

- `executed`: Tests have been executed in the most recent test run.
- `not-executed`: Tests exist but have not been executed in the active run.
- `passed`: Test executed and all assertions passed.
- `failed`: Test executed and failed on an assertion or error.
- `skipped`: Test was skipped (`test.skip()`).
- `timed-out`: Test exceeded execution timeout.

### 2.4. Verification State (`verification`)

- `passed`: All executed tests passed.
- `failed`: One or more tests failed.
- `healed`: Failure was successfully self-healed by the Healer agent.
- `unverified`: No execution results recorded yet.
- `manual-verification-required`: Scenario requires human verification.

> [!IMPORTANT]
> A planned test that was never executed is classified as `unverified` and **never** counts toward verified passing coverage.

---

## 3. Exact Identity Hierarchy & Lookup

Traceability resolution follows a strict priority chain:

1. **`testId`** (e.g. `TEST-AUTH-001`): Explicit unique test case identifier.
2. **`scenarioId`** (e.g. `SC-AUTH-01`): Direct scenario mapping from requirement/plan.
3. **`requirementId`** (e.g. `REQ-AUTH-001`): Requirement grouping level.
4. **Heuristic Filename Match** *(Compatibility Fallback)*: When exact annotations are absent, filename stems are matched. When used, the MCP tool emits the diagnostic `TRACE_HEURISTIC_LINK_USED`.

### Test Metadata Injection

Every generated test spec embeds identity metadata using `setTestMetadata()`:

```typescript
import { test, expect } from '@/fixtures/base.fixture';
import { setTestMetadata } from '@/support/test-metadata';

test.describe('Login Validation', () => {
  test('Empty username and password show validation errors', async ({ page }) => {
    setTestMetadata({
      requirementId: 'REQ-AUTH-002',
      scenarioId: 'SC-01',
      testId: 'TEST-AUTH-002-01',
      covers: ['AC-01', 'AC-02'],
      actor: 'user',
      module: 'auth',
      feature: 'login',
      sourceRequirementHash: 'sha256-req-hash...',
      sourcePlanHash: 'sha256-plan-hash...',
    });

    // Test steps...
  });
});
```

---

## 4. Aggregated Traceability Metrics

`TraceabilityContractV1.metrics` memakai field-field berikut (source of truth: `tools/mcp/src/contracts/traceability-contract.ts`):

| Metric             | Definition                                                            |
| ------------------ | --------------------------------------------------------------------- |
| `totalAcs`         | Total acceptance criteria dalam requirement                           |
| `coveredAcs`       | AC yang tercakup oleh skenario yang dieksekusi dan lulus              |
| `uncoveredAcs`     | AC yang tidak tercakup                                                |
| `totalScenarios`   | Total skenario requirement                                            |
| `passingScenarios` | Skenario yang lulus di run terakhir                                   |
| `failingScenarios` | Skenario yang gagal di run terakhir                                   |
| `healedScenarios`  | Skenario yang awalnya gagal lalu berhasil di-heal dalam run yang sama |
| `skippedScenarios` | Skenario yang di-skip (`test.skip()`)                                 |
| `manualScenarios`  | Skenario berjenis `manual`                                            |
| `blockedScenarios` | Skenario yang diblokir (tidak bisa dijalankan sekarang)               |

> Aturan ketat: AC yang skenarionya tidak dieksekusi / hanya direncanakan **tidak pernah** dihitung sebagai `covered` — `coveredAcs` hanya naik bila ada skenario lulus yang menautkan AC tersebut (`TRACE_HEURISTIC_LINK_USED` dicatat saat fallback heuristic dipakai).

---

## 5. Tool Usage & Integration

### Calling `trace_requirement` (MCP Tool)

```json
{
  "requirementPath": "requirements/auth/sample-login-empty-fields.md",
  "summaryPath": "artifacts/reports/test-summary.json"
}
```

Atau:

```json
{
  "requirementsText": "# REQ-01: Feature\n## Metadata\n...",
  "resultsDir": "artifacts/test-results"
}
```

> Argumen tool: `requirementPath`, `requirementsText`, `resultsDir`, `summaryPath`. Tidak ada argumen `testPlanPath` — graf dibangun dari requirement + hasil test (summary/results), bukan dari test plan.

### Result Schema (`qa.traceability/v1`)

Struktur lengkap `TraceabilityContractV1` (AC nodes, scenario nodes, metrics) ada di
[`TRACEABILITY-CONTRACT.md`](TRACEABILITY-CONTRACT.md). Contoh ringkas:

```json
{
  "status": "success",
  "data": {
    "schemaVersion": "qa.traceability/v1",
    "requirementId": "REQ-AUTH-002",
    "requirementTitle": "Validasi Field Kosong",
    "requirementPath": "requirements/auth/sample-login-empty-fields.md",
    "requirementHash": "...",
    "metrics": {
      "totalAcs": 4,
      "coveredAcs": 4,
      "uncoveredAcs": 0,
      "totalScenarios": 4,
      "passingScenarios": 4,
      "failingScenarios": 0,
      "healedScenarios": 0,
      "skippedScenarios": 0,
      "manualScenarios": 0,
      "blockedScenarios": 0
    },
    "scenarios": [
      {
        "scenarioId": "SC-01",
        "testId": "TEST-AUTH-002-01",
        "title": "Submit empty fields",
        "coversAcIds": ["AC-01", "AC-02"],
        "role": "user",
        "specFile": "tests/auth/sample-login-empty-fields.spec.ts",
        "executionStatus": "passed",
        "coverageState": {
          "design": "planned",
          "automation": "automated",
          "execution": "passed",
          "verification": "verified-pass"
        },
        "linkageType": "exact-test-id"
      }
    ],
    "coverageState": {
      "design": "planned",
      "automation": "automated",
      "execution": "passed",
      "verification": "verified-pass"
    },
    "generatedAt": "2026-08-22T12:00:00.000Z",
    "diagnostics": []
  }
}
```
