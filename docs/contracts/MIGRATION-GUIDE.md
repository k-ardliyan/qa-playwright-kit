# Migration Guide: QA Playwright Kit Contract Layer v1

This document describes how to migrate workflows, tools, and agent interactions from legacy untyped parsers to the typed QA Playwright Kit Contract Layer (`qa.*/v1`).

---

## Overview of Changes

| Legacy Workflow / Tool           | Modern Contract Equivalent | Contract Schema Identifier | Key Advantage                                                                                  |
| -------------------------------- | -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `normalize_requirements`         | `compile_requirement`      | `qa.requirement/v1`        | Typed AST, stable IDs (`AC-01`, `SC-01`), access matrix, input provenance, source hashing      |
| `parse_requirement_scenarios`    | `compile_requirement`      | `qa.requirement/v1`        | Unified single pass; parses roles, actors, steps, expected results                             |
| Ad-hoc Markdown test plan        | `validate_plan`            | `qa.test-plan/v1`          | Bidirectional coverage checking, ephemeral locator detection, role drift checks                |
| Manual report status compilation | `trace_requirement`        | `qa.traceability/v1`       | Closed-loop graph (`Req -> AC -> SC -> Spec -> Execution Evidence`), automated gap calculation |

---

## 1. Requirement Compilation Migration

### Legacy Call

```json
{
  "tool": "normalize_requirements",
  "arguments": {
    "requirementPath": "requirements/auth/sample-login.md"
  }
}
```

### Modern Call

```json
{
  "tool": "compile_requirement",
  "arguments": {
    "requirementPath": "requirements/auth/sample-login.md"
  }
}
```

### Return Shape Difference

**Legacy:**
```json
{
  "status": "success",
  "contract": {
    "id": "sample-login",
    "title": "Sample Login",
    "acceptanceCriteria": ["User can login", "Empty fields show error"]
  }
}
```

**Modern (`qa.requirement/v1`):**
```json
{
  "schemaVersion": "qa.mcp-result/v1",
  "status": "success",
  "data": {
    "schemaVersion": "qa.requirement/v1",
    "requirementId": "REQ-AUTH-001",
    "title": "Sample Login",
    "sourceHash": "sha256:...",
    "module": "auth",
    "feature": "login",
    "acceptanceCriteria": [
      { "id": "AC-01", "description": "User can login with valid credentials" },
      { "id": "AC-02", "description": "Empty fields show validation error" }
    ],
    "accessMatrix": [
      { "role": "guest", "expectation": "can_login" }
    ],
    "scenarios": [ ... ]
  }
}
```

---

## 2. Test Plan Validation Migration

Always validate planned scenarios against the compiled requirement before generating test code:

```json
{
  "tool": "validate_plan",
  "arguments": {
    "testPlanPath": "specs/auth/sample-login-test-plan.md",
    "requirementPath": "requirements/auth/sample-login.md"
  }
}
```

Diagnostics will return specific codes:
- `PLAN_AC_UNCOVERED`: Warns if an AC is not mapped to any scenario.
- `PLAN_EPHEMERAL_REF_DETECTED`: Errors if ephemeral refs (e.g. `tw-1234`, `ref: 12`) leaked into the plan.
- `PLAN_ROLE_DRIFT`: Errors if a scenario runs as a role not permitted by requirement access matrix.

---

## 3. Traceability Matrix Migration

To construct the full traceability graph after running tests:

```json
{
  "tool": "trace_requirement",
  "arguments": {
    "requirementPath": "requirements/auth/sample-login.md"
  }
}
```

Returns `TraceabilityContractV1` detailing:
- `metrics.coveredAcs` / `metrics.totalAcs`
- `metrics.passingScenarios` / `metrics.failingScenarios`
- Exact mappings to spec files under `tests/` and test cases in `reports/test-summary.json`.

---

## Deprecation Schedule

- **v0.2.0-alpha.1:** Introduces `compile_requirement`, `validate_plan`, `trace_requirement`. Marks `normalize_requirements` and `parse_requirement_scenarios` in maintenance mode (non-breaking, 100% backward compatible).
- **v0.3.0:** Legacy parser deprecation warnings logged in CLI output.
- **v1.0.0:** Legacy parser tools deprecated in favor of Contract Layer v1.
