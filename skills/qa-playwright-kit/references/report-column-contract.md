# Report column contract

Load when reading, explaining, or debugging dashboard Table View columns (Test Step, Input Data, Expected, Actual, NOTES, AI NOTES).

Table View (`artifacts/reports/custom-dashboard.html`) is what QA reads after the pipeline. Columns come from Playwright annotations and collected steps — not from free-form reporter prose.

Source: `src/support/custom-reporter.ts` (`onTestEnd`) and `src/support/custom-dashboard/export-helpers.ts` (`formatSteps`, `formatInputData`).

## Columns

| Column         | Source                                                                                                               | QA should see                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Test ID        | `setTestMetadata.testId`                                                                                             | `TC-AUTH-001`                                                                   |
| Description    | `test('…')` title                                                                                                    | Scenario name, not code                                                         |
| **Test Step**  | Top-level `test.step` titles via `formatSteps`                                                                       | Numbered requirement steps in business language                                 |
| **Input Data** | `setTestMetadata.inputData`                                                                                          | `key: value` per line, provenance prefix OK                                     |
| **Expected**   | `setTestMetadata.expectedResult`                                                                                     | Verbatim expected-result text from the requirement                              |
| **Actual**     | `captureActualResult` or reporter fallback                                                                           | Pass = same as Expected. Fail = error message text                              |
| Status         | Playwright result                                                                                                    | PASSED / FAILED / SKIPPED                                                       |
| SOURCE         | `failureSource` on fail only                                                                                         | Cause + decision hint. `-` on pass                                              |
| NOTES          | Duration, layer, trace/screenshot counts + QA note sidecar (`test-notes.json`)                                       | scenarioId, duration, evidence links, QA free-text note (editable via ✎ dialog) |
| AI NOTES       | AI-authored insight: deterministic analysis (fail AND pass — cause, flaky, slow) + agent narrative with source badge | Apa penyebabnya & saran tindak lanjut, juga untuk scenario passed               |

`formatSteps` drops titles starting with `Before`, `After`, `Worker Cleanup`, `worker`, `Fixture`. Nested Playwright auto-steps (`Expect "…" to be visible`) stay in Accordion, not Table View — **only when** they are nested inside a `test.step`. Unwrapped Playwright calls become top-level Test Step entries. That is the bug QA reports.

The column set is fixed (13 columns, including NOTES and AI NOTES). Never hide a column via media queries or responsive CSS — the table scrolls horizontally instead.

## Per-test notes (QA + AI)

Per-test notes live in a per-run sidecar, `artifacts/reports/test-notes.json` (schema `qa.test-notes/v1`, key `<scenarioId>::<role>` with testId fallback; fields `qaNotes`, `aiNotes`, timestamps, `runId`):

- **qaNotes** — QA free-text note, shown in the NOTES column. Editable via the ✎ button which opens the Catatan QA dialog (serve mode posts to the notes API and patches the row in place, static mode copies the CLI command). CLI: `npm run note:set -- --scenario=SC-03 [--role=finance] --note="text"`, list via `npm run note:list`; MCP: `set_test_note`.
- **aiNotes** — AI-authored insight shown in the AI NOTES column: deterministic analysis baked by the custom reporter into `testCases[].aiNotes` with a `Jenis:` tag (failure causes, flaky retries, missing `expect` assertions = false-green risk, run-relative slow passes, metadata gaps), plus agent narrative appended via MCP `record_ai_note` (lines carry a source badge `[healer]` / `[generator]` / `[reporter]` / `[analyzer]`). Agent notes are NOT limited to failures — passed scenarios can carry UI/UX suggestions, flow A-vs-B comparisons, and data/seed tips, structured per the canonical format in [ai-insight-format.md](ai-insight-format.md).
- **Run-level insights** — cross-scenario patterns surface in the overview **AI Run Insights** panel: deterministic entries from `test-summary.json → aiInsights` (hot module/role, flaky sets, repeated error fingerprints, slowest flow, weak-assertion clusters) plus agent entries written via `record_ai_note` with `scope: "run"` (stored in the sidecar `runInsights`).

Notes are per-run: they reset when a new run starts and become permanent when the run is archived — the sidecar is carried into `artifacts/reports/archive/<runId>/test-notes.json`.

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
