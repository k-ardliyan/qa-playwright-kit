---
name: qa-playwright-kit
description: "QA pipeline only; escalate framework bugs to maintainer."
version: 0.4.0
author: k.ardliyan (k-ardliyan), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [qa, playwright, pipeline, requirements, report, auth, setup]
    related_skills: []
---

# QA Playwright Kit Skill

Runbook for QA Users: write `requirements/*.md`, run Plan → Generate → Execute → Heal → Report(Analyze), heal generated specs, read the dashboard, and make a gated QA decision. `Report(Analyze)` is a mandatory Analyze sub-phase inside Report, not a sixth pipeline phase. Not a maintainer license — do not touch the framework.

Hard stop: any edit under `src/`, `tools/`, `config/` (except `*.env` via setup/`env:edit`), `.github/agents/`, `skills/`, `AGENTS.md`, `package.json`, or CI → load [qa-vs-maintainer.md](references/qa-vs-maintainer.md) and file a maintainer report. Zero protected-path diffs.

## When to Use

- QA provides a live web URL and wants to auto-generate `requirements/*.md` from UI snapshots
- First-time setup, or error during `npm run setup` / `npm run auth:setup`
- Writing, reviewing, or validating `requirements/*.md`
- Unsure which scenario tag to use (`@manual`? `@upload`? `@access-restriction`?)
- Requirement has `Auth state: authenticated` or a `Role scope` multi-role field
- Running the pipeline — `qa:run`, Plan / Generate / Execute / Heal / Report
- Generator writing `tests/*.spec.ts` that the dashboard will display
- Test Step column shows `toBeVisible()`, `fill()`, `getByRole()`, or locator strings
- Pipeline finished — reading dashboard and deciding APPROVE / FILE BUG / etc.

Don't use for: protected zones (`src/**`, `tools/**`, `config/**`, `.github/agents/**`). Includes MCP schemas, `formatSteps`, dashboard TSX, validators, CI, and this skill pack. Load Planner / Generator / Healer / Reporter sub-agent files only when executing that specific phase, not at session start.

## Prerequisites

- Repo root with `package.json` scripts `setup` and `qa:run`
- Env file `config/environments/{APP_ENV}.env` — run `npm run setup` or `npm run setup:local`
- MCP server `qa-playwright-kit` healthy — call `qa-playwright-kit:health_check` before Plan
- Auth sessions at `.auth/{APP_ENV}/{role}.json` — run `npm run auth:setup` when `Auth state: authenticated`
- Resuming an interrupted run? Call `qa-playwright-kit:pipeline_status` first — one call reports current phase, resume safety (requirement staleness, missing artifacts), last run pass/fail, ready auth roles, and (when active) `pipelineRunId` for pre-run note attribution.

## How to Run

Canonical entry: `terminal` tool from repo root. Pass requirement path as a positional arg — no npm `--`.

```
terminal(command="npx tsx tools/validators/validate-requirement.ts requirements/<feature>.md")
terminal(command="npx tsx tools/scripts/qa-run.ts requirements/<feature>.md")
```

Hermes prompt (automatic): `Run full pipeline for requirements/<feature>.md`

Hermes prompt (manual, one phase): `Run only the Plan stage for requirements/<feature>.md`

## Quick Reference

| Need                                                        | Reference                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Generate requirement from live URL / UI snapshot            | [ui-discovery-requirement.md](references/ui-discovery-requirement.md)                            |
| First-time setup or setup error                             | [first-run-checklist.md](references/first-run-checklist.md)                                      |
| Requirement format                                          | `requirements/_TEMPLATE.md` + [requirement-language.md](references/requirement-language.md)      |
| Validate format                                             | `terminal(command="npx tsx tools/validators/validate-requirement.ts requirements/<feature>.md")` |
| Scenario types and capability tags                          | [scenario-tags.md](references/scenario-tags.md)                                                  |
| Auth / multi-role testing                                   | [auth-and-roles.md](references/auth-and-roles.md)                                                |
| Dashboard columns (Test Step, Input Data, Expected, Actual) | [report-column-contract.md](references/report-column-contract.md)                                |
| Per-test notes (QA + AI)                                    | [report-column-contract.md](references/report-column-contract.md)                                |
| AI insight format, taxonomy & guardrails (record_ai_note)   | [ai-insight-format.md](references/ai-insight-format.md)                                          |
| Generated spec language and `test.step` rules               | [generator-step-titles.md](references/generator-step-titles.md)                                  |
| Anti-flaky async waiting & polling patterns                 | [async-waiting.md](references/patterns/async-waiting.md)                                         |
| Resolusi `ERR_BLOCKED_BY_CLIENT` & Browser MCP Checklist    | [blocked-by-client.md](references/patterns/blocked-by-client.md)                                 |
| Complex UI widgets (Upload, iframe, clock mocking)          | [complex-widgets.md](references/patterns/complex-widgets.md)                                     |
| SSR hydration & modal popover patterns                      | [ssr-hydration.md](references/patterns/ssr-hydration.md)                                         |
| Post-pipeline: reading dashboard and QA decisions           | [post-pipeline-decisions.md](references/post-pipeline-decisions.md)                              |
| QA vs maintainer boundary                                   | [qa-vs-maintainer.md](references/qa-vs-maintainer.md)                                            |

## Procedure

### 1. Draft or revise requirement

Write `requirements/<feature>.md` from `requirements/_TEMPLATE.md`. Business language only — no Playwright APIs. Required fields: `# REQ-` title, `Module` in Metadata, `AC-XX` IDs, and each `SC-XX` with Test ID, Covers, `**Langkah:**`, `**Hasil yang Diharapkan:**`, `**Input Data:**`. See [requirement-language.md](references/requirement-language.md).

Completion: file saved with all required fields.

### 2. Validate

`terminal(command="npx tsx tools/validators/validate-requirement.ts requirements/<feature>.md")` exits 0. Fix errors; retry once. Warnings may continue.

Completion: validator exits 0.

### 3. QA review (manual mode)

Show the requirement to QA. Do not Plan until they accept.

Completion: QA explicitly says proceed.

### 4. Plan

Load `.github/agents/planner.agent.md`. Compile via `qa-playwright-kit:compile_requirement`. Write `specs/<feature>-test-plan.md`. Steps column copies requirement steps in business language, not Playwright. Verify with `qa-playwright-kit:validate_plan`.

Completion: `validate_plan` passes with no blocking errors.

### 5. Generate

Generated spec naming is flat and canonical: `tests/<feature>[-<role>].spec.ts`. Nested `tests/<domain>/<feature>.spec.ts` files are compatibility-only for existing workspaces and are traceable only when `trace_requirement` can match the basename/role; explicit `testId`/`scenarioId` metadata is preferred.

Load `.github/agents/generator.agent.md`. Follow [generator-step-titles.md](references/generator-step-titles.md):

1. Wrap every requirement step in `test.step('<step text verbatim>')`. Step titles are **UI actions only** (e.g. `Buka halaman login`, `Isi field login dan password`).
2. **STRICT DATA ISOLATION:** Put all input data/credentials strictly in `setTestMetadata({ inputData })`. Never write email, username, phone, passwords, OTP, tokens, or record IDs into `test.step` titles.
3. `expectedResult` = verbatim expected-result text from the requirement.
4. After the last successful assertion, call `captureActualResult(<same expectedResult string>)`.
5. Never use a Playwright API call (`fill`, `click`, `getByRole`) as a top-level step title.

Run `qa-playwright-kit:validate_generated_tests`.

Completion: no ephemeral refs; no credential leakage in step titles; every test has `setTestMetadata` plus `test.step` titles in business language.

### 6. Execute → Heal → Report(Analyze)

Execute via `playwright-test:run_tests`. Heal max 3 cycles per file (`.github/agents/healer.agent.md`). Reporter (`.github/agents/reporter.agent.md`) runs the mandatory Analyze sub-phase inside Report, writes `analysis: { completed, runInsightsRecorded, passedScenariosReviewed, skippedForInsufficientEvidence }`, and produces `analysisVerdict` / `analysisVerified` after evidence checks. State file disimpan di `artifacts/reports/pipeline-state.json` (dan marker `.latest-run` menunjuk ke path laporan yang sama). One workspace supports one active pipeline; run sequentially. Pre-run Generator/Plan notes use `pipelineRunId`; archive uses canonical `archiveRunId`.

**Auth failure mid-run (401 / redirected to login / session expired):** stop healing that file, re-run `npm run auth:setup` (real UI login — the ONLY session producer), re-run the affected spec files. Max 1 re-auth cycle per role per run. NEVER inject storage state (`browser_set_storage_state`, `addCookies`, `localStorage.setItem`, hand-editing `.auth/*.json`) and NEVER log in inside a spec — see [auth-and-roles.md](references/auth-and-roles.md).

**NEVER duplicate/rename `.auth/*.json` to fake a role** (e.g. `user-2.json`): roles exist ONLY when registered in `config/environments/{APP_ENV}.env`; sessions are produced ONLY by `npm run auth:setup`. Need another account → `npm run env:edit` → `npm run auth:setup`. `validate_generated_tests` fails specs referencing unregistered roles.

Completion: dashboard Table View matches [report-column-contract.md](references/report-column-contract.md) — NOTES column holds the QA note (editable via the ✎ button) alongside evidence links, and the AI NOTES column shows the AI-authored insight.

### 7. QA Decision

Ask QA. For a pipeline run, **APPROVE is gated**: it is allowed only when `analysisVerdict=complete`, `analysisVerified=true`, `analysis.completed=true`, exact sidecar evidence counts match, a Reporter Analyze insight exists, and there are no unresolved failures. Missing/mismatched analysis returns `ANALYSIS_INCOMPLETE`, `ANALYSIS_UNVERIFIABLE`, or `ANALYSIS_EVIDENCE_MISMATCH` before archive write. Other decisions archive with the verdict and warning. See [post-pipeline-decisions.md](references/post-pipeline-decisions.md) for the 6 decisions.

To persist a QA remark on a specific test, use `qa-playwright-kit:set_test_note` (or CLI `npm run note:set -- --scenario=SC-03 [--role=finance] --note="text"`); agent-side analysis notes are appended via `qa-playwright-kit:record_ai_note`. Notes are per-run: cleared when a new run starts, permanent once archived.

FIX TEST = rewrite `tests/*.spec.ts` (review zone) or regenerate. It does **not** mean editing `src/` or `.github/agents/` files.

Completion: `qaDecision` recorded; pipeline report updated.

### 8. Escalate framework defects

If Heal fails the same root error for 3 cycles and the cause is in the framework (reporter columns, validator, MCP, agent prompt, dashboard), stop. Fill the maintainer-report block in [qa-vs-maintainer.md](references/qa-vs-maintainer.md). MARK BLOCKED until maintainer lands a fix.

Completion: report handed to QA; zero diffs under protected paths.

## Pitfalls

- Playwright auto-records `Expect "getByRole(...)..." to be visible` as steps. Without `test.step()`, those strings become the Table View Test Step column — that is the bug QA reports.
- Dashboard `formatSteps` shows **top-level** steps only. Nested auto-steps stay in Accordion. Top-level titles must stay business language.
- `captureActualResult` never runs on fail (assertion throws first). Reporter uses the error message — do not invent a fake actual on failure.
- Pass fallback in `custom-reporter.ts` is `Sesuai dengan expected result` (hardcoded). Still call `captureActualResult` with the exact `expectedResult` string so Actual equals Expected.
- Email / password / IDs belong in Input Data, never in `test.step` titles.
- Auth session expired mid-run (401 / redirected to login) → do NOT heal locators and do NOT inject storage state. Re-run `npm run auth:setup`, then re-run the affected specs (max 1 re-auth cycle per role per run). See [auth-and-roles.md](references/auth-and-roles.md).
- Never log in inside a spec (`tests/*.spec.ts` filling login forms). Auth = `test.use({ storageState: authStatePath('<role>') })` from the setup project only. Exception: the requirement itself tests login (`authState: unauthenticated`).
- Do not write `toBeVisible` / `fill` / `getByRole` into the requirement or test-plan Steps column.
- Humans type `npm run qa:run` / `validate:requirement` / `setup:local` / `env:use:staging` — no npm `--`. Agents use `npx tsx …` with a positional path. `--` inside a script value is Playwright, not something QA types.
- "Fix the dashboard / reporter / MCP so QA is happier" is a maintainer task. Patching `src/support/custom-reporter.ts` from this skill is out of bounds.

## Verification

- [ ] `validate-requirement` exits 0
- [ ] Every scenario step is user-observable (click, type, open) — zero Playwright APIs in requirement text
- [ ] Generated spec: one `test.step` per requirement step; title matches that step text verbatim
- [ ] `setTestMetadata.inputData` populated from requirement Input Data; step titles have no raw credential values
- [ ] Pass row: Actual text equals Expected text
- [ ] Fail row: Actual is the error message, not a copy of Expected
- [ ] Table View: QA note editable via ✎ in NOTES column; AI NOTES column present
- [ ] `qaDecision` asked and recorded; pipeline `analysisVerdict` and `analysisVerified` reviewed
- [ ] APPROVE only when Analyze is complete and evidence-verified; otherwise use a non-APPROVE decision or rerun Report(Analyze)
- [ ] `git diff` has no files under `src/`, `tools/`, `.github/agents/`, `skills/`, or `config/` except `config/environments/*.env` touched via setup / `env:edit`
- [ ] If blocked by framework: maintainer report filed, no protected-path edits
