---
name: qa-playwright-kit
description: "QA pipeline only; escalate framework bugs to maintainer."
version: 0.3.0
author: k.ardliyan (k-ardliyan), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [qa, playwright, pipeline, requirements, report, auth, setup]
    related_skills: []
---

# QA Playwright Kit Skill

Runbook for QA Users: write `requirements/*.md`, run Plan → Generate → Execute → Heal → Report, heal generated specs, read the dashboard. Not a maintainer license — do not touch the framework.

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
| Generated spec language and `test.step` rules               | [generator-step-titles.md](references/generator-step-titles.md)                                  |
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

Load `.github/agents/generator.agent.md`. Follow [generator-step-titles.md](references/generator-step-titles.md):

1. Wrap every requirement step in `test.step('<step text verbatim>')`.
2. Put Input Data only in `setTestMetadata({ inputData })`.
3. `expectedResult` = verbatim expected-result text from the requirement.
4. After the last successful assertion, call `captureActualResult(<same expectedResult string>)`.
5. Never use a Playwright API call as a top-level step title.

Run `qa-playwright-kit:validate_generated_tests`.

Completion: no ephemeral refs; every test has `setTestMetadata` plus `test.step` titles in business language.

### 6. Execute → Heal → Report

Execute via `playwright-test:run_tests`. Heal max 3 cycles per file (`.github/agents/healer.agent.md`). Reporter (`.github/agents/reporter.agent.md`) writes `artifacts/reports/pipeline-report-<runId>.md` then calls `qa-playwright-kit:archive_report`.

Completion: dashboard Table View matches [report-column-contract.md](references/report-column-contract.md).

### 7. QA Decision

Ask QA. Record `qaDecision`. See [post-pipeline-decisions.md](references/post-pipeline-decisions.md) for the 6 decisions (APPROVE / FILE BUG / REVISE REQUIREMENT / FIX TEST/GENERATOR / FIX ENVIRONMENT / MARK BLOCKED).

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
- [ ] `qaDecision` asked and recorded
- [ ] `git diff` has no files under `src/`, `tools/`, `.github/agents/`, `skills/`, or `config/` except `config/environments/*.env` touched via setup / `env:edit`
- [ ] If blocked by framework: maintainer report filed, no protected-path edits
