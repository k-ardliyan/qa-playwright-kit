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

Runbook for QA Users: orchestrate the **Explore → Model → Challenge → Generate → Validate** lifecycle (physical engine: Plan → Generate → Execute → Heal → Report(Analyze)), heal generated specs, read the dashboard, and make a gated QA decision. `Report(Analyze)` is a mandatory Analyze sub-phase inside Validate/Report, not a separate pipeline phase. Not a maintainer license — do not touch the framework.

Hard stop: any edit under `src/`, `tools/`, `config/` (except `*.env` via setup/`env:edit`), `.github/agents/`, `skills/`, `AGENTS.md`, `package.json`, or CI → load [qa-vs-maintainer.md](references/qa-vs-maintainer.md) and file a maintainer report. Zero protected-path diffs.

## When to Use

- QA provides a live web URL and wants to auto-generate `requirements/*.md` from UI snapshots
- First-time setup, or error during `npm run setup` / `npm run auth:setup`
- Writing, reviewing, or validating `requirements/*.md`
- Unsure which scenario tag to use (`@manual`? `@upload`? `@access-restriction`?)
- Requirement has `Auth state: authenticated` or a `Role scope` multi-role field
- Running the pipeline — `qa:run`, Plan / Generate / Execute / Heal / Report
- "Requirement mana yang belum punya plan/test?" → `qa-playwright-kit:list_requirement_status` (coverage map: `hasPlan`, `hasTests`, manual count, last status per requirement)
- Pipeline paused/blocked and you need to know what to do next → `qa-playwright-kit:pipeline_status` (phase, resume safety, missing artifacts, next stage)
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
- Running the full semantic workflow in one call? `qa-playwright-kit:workflow_run` drives Explore → Model → Challenge → Generate → Validate through the production driver and returns a structured `workflowStage`/`workflowStatus`/`nextRequiredAction` — prefer it over manual phase-by-phase invoke for the semantic flow.

## How to Run

Canonical entry: `terminal` tool from repo root. Pass requirement path as a positional arg — no npm `--`.

```
terminal(command="npx tsx tools/validators/validate-requirement.ts requirements/<feature>.md")
terminal(command="npx tsx tools/scripts/qa-run.ts requirements/<feature>.md")
```

Hermes prompt (automatic): `Run full pipeline for requirements/<feature>.md`

Hermes prompt (manual, one phase): `Run only the Plan stage for requirements/<feature>.md`

## Natural Language Chat Intent Routing (How to Handle QA Prompts)

When QA chats naturally, immediately map the intent to the corresponding phase:
1. **New Feature from Live URL** (e.g. *"Hermes, tolong buatkan test untuk halaman http://.../invoices (role: finance)"*):
   - Route to **Phase -0.5 (UI Discovery & Requirement Synthesis)**.
   - Call `snapshot_page` (or `discover_pages`) with the URL, feature name, and role session (`.auth/{APP_ENV}/{role}.json`).
   - Call `synthesize_requirement` to automatically produce `requirements/<feature>.md`.
   - Validate with `validate_requirement`, then proceed directly to `workflow_run`.
2. **New Feature from User Story / Jira Ticket** (e.g. *"Hermes, buatkan test dari tiket/PRD ini: [cerita]"*):
   - Route to **Phase -1 (PRD Decompose)**.
   - Decompose into acceptance criteria and scenarios in `requirements/<feature>.md` per `_TEMPLATE.md`.
   - Validate with `validate_requirement`, then proceed directly to `workflow_run`.
3. **Run Pipeline for Existing Requirement** (e.g. *"Hermes, jalankan pipeline untuk requirements/login.md"*):
   - Call `workflow_run({ requirementPath, orchestrationMode: "automatic" })`.
   - Follow the **Autonomous Agent Protocol** below for any Model / Generate handoff pauses.

## Autonomous Agent Protocol for `workflow_run`

When invoked to run a pipeline (e.g. prompt from `npm run setup` / `qa:run`):
1. **Launch:** Call `qa-playwright-kit:workflow_run({ requirementPath, orchestrationMode: "automatic" })`.
2. **Model Handoff (Plan Missing):** If `workflow_run` returns `workflowStage: "model"` and pauses (`planner-required` / plan file missing):
   - Act as the **Planner**: read requirement, inspect selector catalog, write `specs/<feature>-test-plan.md`, and verify with `validate_plan`.
   - Resume immediately: `qa-playwright-kit:workflow_run({ requirementPath, resume: true, runId })`.
3. **Generate Handoff (Spec Missing):** If `workflow_run` returns `workflowStage: "generate"` with `handoffType: "awaiting-generator"`:
   - Act as the **Generator**: write `tests/<feature>[-<role>].spec.ts` per Generator guidelines and verify with `validate_generated_tests`.
   - Resume immediately: `qa-playwright-kit:workflow_run({ requirementPath, resume: true, runId })`.
   - Dual path: the AI-agent (Hermes) path is default & recommended; without an AI agent the manual path is first-class — follow the pause's `nextRequiredAction` (target paths + conventions + resume command).
4. **Validate & QA Review:** When `workflow_run` completes Validate (`workflowStatus: "qa-decision-required"`):
   - Present the execution summary to QA.
   - Remind QA to open `npm run dashboard`.
   - After QA review, record decision via `archive_report({ runId, reportPath, qaDecision })`.

## Quick Reference

| Need                                                        | Reference                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| "What still needs work?" — coverage map across requirements | `qa-playwright-kit:list_requirement_status`                                                      |
| Orient / resume after an interrupted run                    | `qa-playwright-kit:pipeline_status`                                                              |
| Which MCP tool for which task (full map)                    | [mcp-tools-for-qa.md](references/mcp-tools-for-qa.md)                                            |
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

## Procedure (01. Explore → 02. Model → 03. Challenge → 04. Generate → 05. Validate)

### 1. Explore (01. Explore — THE APP ANSWERS)

For new, unknown, or changed interactive flows, gather evidence first via `qa-playwright-kit:snapshot_page` (or `discover_pages`). Persistent ARIA and selector catalogs land under `artifacts/selector-catalog/<feature>/<page>.json`. For existing stable regression pages with fresh catalogs, live exploration may be safely skipped — the Explore policy (`workflow_run`) auto-discovers `artifacts/selector-catalog/<feature>/` and only requires live capture when evidence is missing or stale.

### 2. Model (02. Model — SHARED MODEL)

Draft or revise `requirements/<feature>.md` from `requirements/_TEMPLATE.md`. Business language only — no Playwright APIs. Required fields: `# REQ-` title, `Module` in Metadata, `AC-XX` IDs, and each `SC-XX` with Test ID, Covers, `**Langkah:**`, `**Hasil yang Diharapkan:**`, `**Input Data:**`. Validate with `terminal(command="npx tsx tools/validators/validate-requirement.ts requirements/<feature>.md")`.
Load `.github/agents/planner.agent.md`. Compile via `qa-playwright-kit:compile_requirement` and write `specs/<feature>-test-plan.md`.

### 3. Challenge (03. Challenge — THE GATE)

Attack assumptions before generating automation:
- What can fail? (verify negative/error and access-restriction paths exist)
- What's assumed? (mark ungrounded assumptions with `[planner-assumption]`)
- What deserves an assertion? (verifiable, observable outcomes)
- Which edge cases matter? (empty state, boundary conditions, loading spinners)
Verify plan with `qa-playwright-kit:validate_plan`. Must pass with zero blocking errors before generation.

### 4. Generate (04. Generate — FOURTH, NOT FIRST)

Generated spec naming is flat and canonical: `tests/<feature>[-<role>].spec.ts`. Nested `tests/<domain>/<feature>.spec.ts` files are compatibility-only for existing workspaces and are traceable only when `trace_requirement` can match the basename/role; explicit `testId`/`scenarioId` metadata is preferred.

Load `.github/agents/generator.agent.md`. Follow [generator-step-titles.md](references/generator-step-titles.md):

1. Wrap every requirement step in `test.step('<step text verbatim>')`. Step titles are **UI actions only** (e.g. `Buka halaman login`, `Isi field login dan password`).
2. **STRICT DATA ISOLATION:** Put all input data/credentials strictly in `setTestMetadata({ inputData })`. Never write email, username, phone, passwords, OTP, tokens, or record IDs into `test.step` titles.
3. `expectedResult` = verbatim expected-result text from the requirement.
4. After the last successful assertion, call `captureActualResult(<same expectedResult string>)`.
5. Never use a Playwright API call (`fill`, `click`, `getByRole`) as a top-level step title.

Run `qa-playwright-kit:validate_generated_tests`.

Completion: no ephemeral refs; no credential leakage in step titles; every test has `setTestMetadata` plus `test.step` titles in business language.

### 5. Validate (05. Validate — EARNED TRUST)

Validate runs the execution, diagnosis, reporting, and review loop:

- **Execute:** Run tests via `playwright-test:run_tests`.
- **Heal:** Diagnose and repair up to 3 cycles per file via Healer (`.github/agents/healer.agent.md`).
- **Analyze (WAJIB):** Reporter (`.github/agents/reporter.agent.md`) runs the mandatory Analyze sub-phase, writes `analysis: { completed, runInsightsRecorded, passedScenariosReviewed, skippedForInsufficientEvidence }`, and produces `analysisVerdict` / `analysisVerified`.
- **Feedback Loop (LEARN → REFINE → RE-EXPLORE):** Failures route intelligently to the smallest useful stage (UI unknown → Explore; requirement conflict → Model; weak assertion → Challenge; test bug → Generate; app defect → FILE BUG; auth/env issue → FIX ENVIRONMENT).
- **QA Review & Gated Archive:** Ask QA. For a pipeline run, **APPROVE is gated**: allowed only when `analysisVerdict=complete`, `analysisVerified=true`, `analysis.completed=true`, exact sidecar evidence counts match, a Reporter Analyze insight exists, and there are no unresolved failures. Archive via `archive_report`.

**Auth failure mid-run (401 / redirected to login / session expired):** stop healing that file, re-run `npm run auth:setup` (real UI login — the ONLY session producer), re-run the affected spec files. Max 1 re-auth cycle per role per run. NEVER inject storage state (`browser_set_storage_state`, `addCookies`, `localStorage.setItem`, hand-editing `.auth/*.json`) and NEVER log in inside a spec — see [auth-and-roles.md](references/auth-and-roles.md).

**NEVER duplicate/rename `.auth/*.json` to fake a role** (e.g. `user-2.json`): roles exist ONLY when registered in `config/environments/{APP_ENV}.env`; sessions are produced ONLY by `npm run auth:setup`. Need another account → `npm run env:edit` → `npm run auth:setup`. `validate_generated_tests` fails specs referencing unregistered roles.

### 6. Escalate framework defects

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
