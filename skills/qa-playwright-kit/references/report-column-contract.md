# Report column contract

Load when reading, explaining, or debugging dashboard Table View columns (Test Step, Input Data, Expected, Actual).

Table View (`artifacts/reports/custom-dashboard.html`) is what QA reads after the pipeline. Columns come from Playwright annotations and collected steps — not from free-form reporter prose.

Source: `src/support/custom-reporter.ts` (`onTestEnd`) and `src/support/custom-dashboard/export-helpers.ts` (`formatSteps`, `formatInputData`).

## Columns

| Column | Source | QA should see |
| --- | --- | --- |
| Test ID | `setTestMetadata.testId` | `TC-AUTH-001` |
| Description | `test('…')` title | Scenario name, not code |
| **Test Step** | Top-level `test.step` titles via `formatSteps` | Numbered requirement steps in business language |
| **Input Data** | `setTestMetadata.inputData` | `key: value` per line, provenance prefix OK |
| **Expected** | `setTestMetadata.expectedResult` | Verbatim expected-result text from the requirement |
| **Actual** | `captureActualResult` or reporter fallback | Pass = same as Expected. Fail = error message text |
| Status | Playwright result | PASSED / FAILED / SKIPPED |
| SOURCE | `failureSource` on fail only | Cause + decision hint. `-` on pass |
| Notes | Duration, layer, trace/screenshot counts | Evidence links |

`formatSteps` drops titles starting with `Before`, `After`, `Worker Cleanup`, `worker`, `Fixture`. Nested Playwright auto-steps (`Expect "…" to be visible`) stay in Accordion, not Table View — **only when** they are nested inside a `test.step`. Unwrapped Playwright calls become top-level Test Step entries. That is the bug QA reports.

## Actual vs Expected

Reporter logic in `custom-reporter.ts`:

```
passed  → actualResult annotation || 'Sesuai dengan expected result'
failed  → actualResult annotation || error.message || '-'
```

The pass fallback is hardcoded Indonesian. Do not rely on it. Call `captureActualResult` with the exact `expectedResult` string so Actual equals Expected.

`captureActualResult` is an annotation push. On fail the assertion throws first, so the annotation is usually missing — using the error message as Actual is correct behaviour.

**Contract for Generator:**

- Pass: call `captureActualResult(<exact expectedResult string>)` after the last successful assertion. Table then shows Actual === Expected.
- Fail: do not catch and rewrite. Let the Playwright error become Actual.

Do not write a different "nice" actual on pass (`"confirmed"`, `"OK"`, `"page loaded"`) unless it is character-for-character the same as the Expected text.

## Input Data must not appear in Test Step

If a step title contains `user@…`, a password, or `INV-2026-001`, the Generator put values in `test.step` instead of `inputData`. Fix the spec (heal / regenerate), not the dashboard.

## Fail row

Actual = Playwright error (timeout, element not visible, wrong URL). SOURCE classifies the cause: `app | test | requirement | env | ai_generation`. Screenshot / video / trace appear in Notes.

## Pass row

Actual equals Expected. SOURCE is `-`. No error block.
