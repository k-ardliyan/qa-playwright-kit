Load when writing, reviewing, or recording AI insights (record_ai_note, healer/reporter notes, run insights) or explaining the AI NOTES column and AI Run Insights panel.

---

# AI Insight Format & Guardrails

AI insights complement `Expected`, `Actual`, `Status`, and `failureSource` — they never replace structured test data. Two delivery surfaces:

- **Per-test insight** → `record_ai_note` (scope `test`, default) → AI NOTES column of that row.
- **Run-level insight** → `record_ai_note` with `scope: "run"` → AI Run Insights panel on the overview page. Use for cross-scenario patterns (hot modules/roles, repeated error patterns, flaky sets, weak-assertion clusters, flow comparisons).

## Canonical format

Prefer the structured fields (`kind`, `observation`, `evidence`, `impact`, `recommendation`, `priority`, `confidence`, `nextAction`, `status`); the tool renders them in this fixed layout. A plain `message` is acceptable for one-liners.

```text
[<source>] Jenis: <kind> | Status: <observed|inferred|recommendation> | Prioritas: <high|medium|low> | Confidence: <high|medium|low>
Observasi: what was actually observed from the test
Bukti: scenario, step, trace, screenshot, network, last URL
Dampak: impact on the user, the business, or the test suite
Rekomendasi: concrete action
Next Action: next step for QA
```

The labels (`Jenis:` / `Status:` / `Prioritas:` / `Observasi:` / `Bukti:` / `Dampak:` / `Rekomendasi:` / `Next Action:`) are rendered verbatim by the tool (`src/agents/reporter/run-insights.ts`, `tools/mcp/src/utils/test-notes.ts`) — never translate or rename them.

Content language: **Indonesian**. Keep each note 1–6 lines; QA/programmer must be able to act on it without re-reading the trace.

## Jenis taxonomy

| Jenis          | When to use                                                         |
| -------------- | ------------------------------------------------------------------- |
| `root-cause`   | Failure cause + technical fix suggestions                           |
| `stability`    | Flaky, retry, slow duration, timing/synchronization                 |
| `test-quality` | Weak assertions, false-green risk, assertion coverage, static data  |
| `ui-ux`        | Labels, feedback, empty/loading state, cross-module consistency     |
| `flow`         | Step order, input persistence, Back/Cancel, redirect, shortcut      |
| `data`         | Seed data, cross-role isolation, residual data, boundary data       |
| `security`     | Credential/token exposure, permission handling                      |
| `coverage`     | Untested negative paths / boundaries, mass skips                    |
| `trend`        | Cross-scenario patterns (run-level): hot modules/roles, regressions |

### Weak assertion & security triggers (must be recorded)

- **Weak assertion (pseudo-test risk, EMSE 2018):** a PASSED test whose assertions only check existence (`toBeVisible`, count) without verifying a value/state/business effect → record `kind: "test-quality"`, `status: observed`, plus a concrete assertion recommendation. The mental test: if the feature body were removed, would this test still be green? If yes, it is a pseudo-test.
- **Security surface (weakest area of AI practice, QASkills 2026):** when a flow touches login/permission/multi-tenant and you observe a token in the URL/storage, cross-tenant access, or role-gated elements leaking to a forbidden role → record `kind: "security"` with honest `confidence`; never claim a vulnerability without observational evidence (trace/screenshot/network).

## Insights for passed scenarios (not only failures)

A passed test ≠ an optimal application. Insights that carry value on passed scenarios:

- **UI/UX**: post-action feedback (toast/loading/redirect), element consistency, fields/steps that feel unnecessary, empty/success states.
- **Flow**: steps that could be shortened, input reusable across steps, Back/Cancel/Submit consistency, Flow A vs Flow B comparison (shorter, less error-prone, clearer feedback — recommend which one deserves to become the standard).
- **Business outcome**: side effects (notification, audit trail, table update), data consistent after refresh, repeated operations not creating duplicates.
- **Test quality**: weak assertions, missing verification, flakiness potential (animation/debounce/polling).
- **Data/environment**: realistic seeds, residual data between tests, cross-role access isolation.
- **Recommendation**: additional boundary/negative cases, exploratory follow-ups.

Deterministic signals already baked by the reporter (do not duplicate): flaky retry, run-relative slow duration, missing `expect` assertion (false-green), metadata gaps, hot module/role, repeated error fingerprints. Agent insight adds the *why* and the *what to do*.

## Insights for failed scenarios

Structure the failure story: failure summary (user action, expected vs actual, triggering steps, consistent vs intermittent) → classification (`failureSource` stays machine-readable; the narrative explains it) → root cause → technical fix suggestions AND product fix suggestions → priority + concrete next action (re-run, re-auth, fix test, fix requirement, file bug, add seed).

## Guardrails (mandatory — some enforced by the tool, not just documentation)

- Separate **observed facts** from **recommendations** — every insight carries `status`: `observed`, `inferred`, or `recommendation`.
- Do not call UX bad if the UI/UX was not actually inspected; do not claim accessibility if keyboard/screen-reader/viewport concerns were not tested.
- A passed test is not proof the application is entirely correct.
- Do not fabricate actual results; do not summarize errors until the evidence is lost.
- Do not classify an application bug without first checking the test, the requirement, and the environment.
- **Secret redaction (enforced):** `record_ai_note` and every note-writing path automatically redact Bearer tokens, JWTs, `password=/token=/api_key=`, cookies, and AWS keys before storing. Do not rely on this — never write credentials in notes.
- **Deduplication (enforced):** identical insights (same source + normalized text) are not stored twice; the tool returns `deduplicated: true` — do not retry repeatedly.
- **Provenance (enforced):** when the MCP server runs with a single profile (healer/reporter/generator), the payload `source` must match the profile — badges cannot be forged.
- **runId contract:** without `runId`, an insight attaches to the **pending pipeline run** while the pipeline is active (marker created at pipeline start / `pipeline_status` in `running` state; the id is exposed as `pipelineRunId` in `pipeline_status` & `get_test_summary`), then to the **latest run** (canonical `run-YYYYMMDD-HHmmss-SSS`, available as `archiveRunId`). Notes are per-run: a new run starts a clean sidecar; an archived run keeps its notes permanently.
- **Affected metadata (scope=run):** include `affectedTests` / `affectedModules` / `affectedRoles` so QA can trace an insight back to its source.
- **Analyze contract:** the Reporter must include the `analysis` block (`completed`, `runInsightsRecorded`, `passedScenariosReviewed`, `skippedForInsufficientEvidence`) in the `PipelineReport` JSON — proof the Analyze sub-phase ran. Archive metadata and consumers expose `analysisVerdict` + `analysisVerified`; `APPROVE` is only allowed when the verdict is `complete` and verified.
- Give `confidence: low` when QA needs to validate manually.
- Deterministic signals (badge `auto`) come from reporter rules — not LLM reasoning; agent insight adds the *why* and the *what to do*.
