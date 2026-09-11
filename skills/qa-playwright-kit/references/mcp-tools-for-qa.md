# MCP Tools for QA — Which Tool, When

The `qa-playwright-kit` MCP server exposes 25 tools. You do not need to remember
them: this map answers "which one do I need?" for the tasks QA actually does.
All tools are called as `qa-playwright-kit:<tool_name>`.

## The five you will use most

| Task                               | Tool                      | What it gives you                                                                                                    |
| ---------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Where am I / is it safe to resume? | `pipeline_status`         | Current stage, resume safety (requirement changed? artifacts missing?), last run result, ready auth roles            |
| What still needs work?             | `list_requirement_status` | Every requirement with `hasPlan`, `hasTests`, manual-scenario count, last run status                                 |
| Is my requirement valid?           | `validate_requirement`    | Structural check + score (0-100) before running the pipeline                                                         |
| Run the full pipeline              | `workflow_run`            | Explore → Model → Challenge → Generate → Validate, returns `workflowStage` / `workflowStatus` / `nextRequiredAction` |
| What failed and why?               | `get_test_failures`       | Structured failures with `failureSource`, trace, screenshot, error context                                           |

## Two safety rules

1. **`pipeline_status` before resuming.** Never resume a paused run without it —
   it tells you whether the requirement changed (unsafe to resume) or artifacts
   went missing (phases must re-run).
2. **`health_check` before an authenticated run.** It validates env, MCP build,
   and session readiness. The MCP tool is strict: an expired session is a
   failure. (`npm run health:check` is the code-quality gate where it is only a
   warning; `npm run health:check:strict` is the pre-run contract.)

## When the pipeline pauses

`workflow_run` never fakes progress. A pause is a real state, and
`nextRequiredAction` tells you exactly what to do:

| Pause                           | Meaning                                       | Your move                                                           |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `planner-required` (Model)      | Test plan missing                             | Write `specs/<feature>-test-plan.md`, then resume with `runId`      |
| `awaiting-generator` (Generate) | No generator is wired into the runtime        | Write `tests/<feature>.spec.ts`, then resume with `runId`           |
| `needs-review` (Validate)       | Unresolved failures or incomplete Analyze     | Read the report; the feedback target tells you where to fix         |
| `qa-decision-required`          | Everything passed; a human decision is needed | Review the dashboard, then record the decision via `archive_report` |

## Reading a failure

`get_test_failures` returns per-failure `failureSource` — this decides the QA
action, so never guess it:

| `failureSource` | Meaning                            | QA action                              |
| --------------- | ---------------------------------- | -------------------------------------- |
| `app`           | Product defect                     | FILE BUG, keep the test                |
| `test`          | Test implementation wrong          | FIX TEST (or let the healer run)       |
| `requirement`   | Requirement no longer matches app  | REVISE REQUIREMENT                     |
| `env`           | Auth/session/seed/environment      | FIX ENVIRONMENT (`npm run auth:setup`) |
| `ai_generation` | Generated locator/import was wrong | FIX TEST                               |
| `unknown`       | Not enough evidence                | MARK BLOCKED, gather evidence          |

## Notes and insights

- `record_ai_note` — AI-authored insight on one test or the whole run (failure
  causes AND observations on passed scenarios). Write in Indonesian.
- `set_test_note` — your own free-text note on a test; shows up in the NOTES
  column of the dashboard.
- `archive_report` — saves a run as a milestone with your QA decision. APPROVE
  requires a complete, verified Analyze sub-phase; other decisions always archive.

## Not for daily QA

`compile_requirement`, `compile_test_plan`, `validate_plan`, `trace_requirement`,
`generate_page_object`, `inspect_file`, `extract_pdf_text`, `list_test_fixtures`,
and the `compat` tools (`normalize_requirements`, `parse_requirement_scenarios`,
`validate_requirement` aliases) are used by the agents and the pipeline itself.
You can call them, but the ones above are the QA-facing surface.
