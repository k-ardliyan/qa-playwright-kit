# Post-pipeline: reading the dashboard and making QA decisions

Load when the pipeline has finished and QA needs to read the report and choose a decision.

---

## Expected artefacts

| Artefact | Required | How to open |
| --- | --- | --- |
| `artifacts/reports/custom-dashboard.html` | ✅ | Opens automatically via `qa:run`, or open manually in a browser |
| `specs/{feature}-test-plan.md` | ✅ | Text editor / VS Code |
| `tests/{feature}*.spec.ts` | ✅ | Text editor / VS Code |
| `artifacts/reports/pipeline-report-{runId}.md` | ✅ | Text editor / VS Code |

If the dashboard does not open automatically: locate `artifacts/reports/custom-dashboard.html` and open it in a browser.

---

## Reading Table View columns

| Column | Content | What to check |
| --- | --- | --- |
| Test ID | `TC-XXX` | Matches the SC in the requirement |
| Description | Scenario name | Same as the SC heading |
| **Test Step** | Numbered business-language steps | Must be plain language — never `toBeVisible()` |
| **Input Data** | `key: value` pairs | No literal password or email values here |
| **Expected** | Expected result text | Verbatim from the requirement |
| **Actual** | Actual result | Pass: equals Expected. Fail: Playwright error message |
| Status | PASSED / FAILED / SKIPPED | — |
| SOURCE | Failure classification (fail only) | `app / test / requirement / env / ai_generation` |

### Sign of a generator problem in Test Step

If Test Step shows `Expect "getByRole(...)..." to be visible` or any Playwright API name → the Generator did not wrap actions in `test.step()`. Classify as `failureSource: ai_generation` → FIX TEST (regenerate the spec).

---

## 6 QA decisions

After reading the report choose **one**:

| Decision | When | Action |
| --- | --- | --- |
| ✅ **APPROVE** | All pass, Test Step is business language, Actual = Expected | `npm run archive:save` or `qa-playwright-kit:archive_report` via Hermes |
| 🐛 **FILE BUG** | `failureSource: app` — the application is wrong | Create a defect ticket; keep the test as a regression guard |
| 📝 **REVISE REQUIREMENT** | `failureSource: requirement` — requirement is ambiguous | Edit `requirements/*.md`; restart from Plan |
| 🔧 **FIX TEST/GENERATOR** | `failureSource: test` or `ai_generation` | Heal or regenerate `tests/*.spec.ts`; do not edit `src/` |
| 🔧 **FIX ENVIRONMENT** | `failureSource: env` — auth / credentials / seed missing | `npm run env:edit` → `npm run auth:setup` → re-run Execute |
| 🚫 **MARK BLOCKED** | Cannot resolve now | Archive trace and screenshot; file a maintainer report |

---

## Failure investigation flow

```
1. Read the SOURCE column in the dashboard
2. Open the Accordion for the error detail and trace / screenshot links
3. Choose the decision that matches the failureSource
4. If FIX TEST: run Heal (Hermes) — max 3 cycles
5. Still failing after 3 cycles → MARK BLOCKED + maintainer report
```

---

## Archive (APPROVE)

```bash
npm run archive:save   # interactive: select run → enter decision and notes
```

Or via Hermes Agent: call `qa-playwright-kit:archive_report` after the APPROVE decision.

---

## Common symptoms and fixes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Test passes but URL shows `/login?redirect=…` | `toHaveURL` false positive | Heal spec: assert `pathname`, not full URL |
| Actual shows `-` on a passing test | `captureActualResult` not called | Heal spec: add `captureActualResult(expectedResult)` after the last assertion |
| Test Step column is empty | `test.step` not used | Heal spec: wrap each step body in `test.step('…', async () => { … })` |
| All tests SKIPPED | Auth file empty or `@demo` tag active | Re-run `npm run auth:setup`; run pipeline without demo tag filter |
| Dashboard shows stale data | Reporter did not finish | Wait for Reporter to complete or re-run the pipeline |
