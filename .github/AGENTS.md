# AGENTS Governance

This document defines governance for framework agents:

- `orchestrator`
- `planner`
- `generator`
- `healer`
- `reporter`

## Requirement Template

All requirement files must follow [`requirements/_TEMPLATE.md`](../requirements/_TEMPLATE.md).
QA documentation: [`docs/GUIDE.md`](../docs/GUIDE.md), [`docs/WRITING-REQUIREMENTS.md`](../docs/WRITING-REQUIREMENTS.md).

## MCP Servers (three-server hybrid)

| Server              | Command                                                       | Role                                            |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `playwright`        | `npx tsx tools/scripts/playwright-mcp-launch.ts`              | Browser exploration (`browser_*` tools)         |
| `playwright-test`   | `npx tsx tools/scripts/playwright-test-mcp-launch.ts`         | Execute tests (`run_tests`, etc.)               |
| `qa-playwright-kit` | `node tools/mcp/dist/index-mcp.js` (env bootstrap at startup) | Requirements, validation, failure/summary reads |

Configure all three in [`.mcp.json`](../.mcp.json) as the project MCP config. Keep [`.vscode/mcp.json`](../.vscode/mcp.json) only if your editor still expects workspace MCP config. Build custom QA server: `npm run mcp:build`.

**Branch protection:** require CI workflow `Quality Gate` on PRs. E2E workflow runs on push to main / manual dispatch (needs GitHub Secrets).

**Generated tests:** must include `@ui`, `@regression`, and traceability headers (`// spec:`, `// seed:`). Demo/healer specs use `@demo` and are excluded from default `npm test`.

## 1) Orchestrator Agent

### Role Description

Coordinates the full pipeline:
**Pre-flight → Validate → Plan → Generate → Execute → Heal → Report**.

### Input Format

```json
{
  "requirementPath": "requirements/<feature-name>.md"
}
```

### Output Format

```json
{
  "summary": {
    "scenariosPlanned": 0,
    "testsGenerated": 0,
    "testsPassing": 0,
    "testsFailing": 0,
    "testsHealed": 0,
    "testsSkipped": 0
  },
  "unresolvedFailures": [
    {
      "stage": "planner | generator | healer",
      "errorMessage": "...",
      "tracePath": "optional",
      "screenshotPath": "optional"
    }
  ]
}
```

### MCP Tools Consumed

- `qa-playwright-kit`: `health_check`, `compile_requirement`, `compile_test_plan`, `validate_plan`, `trace_requirement`, `validate_requirement`, `normalize_requirements`, `parse_requirement_scenarios`, `validate_generated_tests`, `get_test_failures`, `get_test_summary`, `list_artifacts`, `list_requirement_status`, `snapshot_page`, `discover_pages`, `list_test_fixtures`, `inspect_file`, `extract_pdf_text`, `read_excel_summary`, `archive_report`, `generate_page_object`
- `playwright-test`: `run_tests`
- `playwright`: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_wait_for`, `browser_take_screenshot`, `browser_file_upload`; see root [`AGENTS.md`](../AGENTS.md)

### Example Prompt

- "Run pipeline for `requirements/auth/login-none.md` and include unresolved failures."

---

## 2) Planner Agent

### Role Description

Transforms requirement files into structured scenario plans.

### Input Format

```json
{
  "requirementPath": "requirements/<feature-name>.md"
}
```

### Output Format

Hybrid Markdown test plan written to:
`specs/<feature-name>-test-plan.md`

Includes Application Overview, per-scenario `### SC-XX` sections, **Seed:** `tests/seed.spec.ts`, and a table per scenario with columns:

- `Scenario Name`
- `Steps`
- `Expected Result`
- `Role`
- `Auth Context`
- `Type`

Golden sample: [`specs/_GOOD_EXAMPLE.md`](../specs/_GOOD_EXAMPLE.md).

### MCP Tools Consumed

- `qa-playwright-kit`: `compile_requirement`, `compile_test_plan`, `validate_plan`, `validate_requirement`, `normalize_requirements`, `parse_requirement_scenarios`, `list_artifacts`, `list_test_fixtures`, `discover_pages`, `snapshot_page`
- `playwright-test`: `run_tests` (seed bootstrap: `tests/seed.spec.ts`)
- `playwright`: `browser_navigate`, `browser_snapshot`

### Example Prompt

- "Plan tests from `requirements/auth/login-none.md` and write `specs/login-none-test-plan.md`."

---

## 3) Generator Agent

### Role Description

Converts planner scenario tables into Playwright TypeScript test files.

### Input Format

Planner table with columns:

- `Scenario Name`
- `Steps`
- `Expected Result`
- `Role`
- `Auth Context`
- `Type`

### Output Format

- Generated files under `tests/` using the flat canonical paths `tests/<feature>-<role>.spec.ts` or `tests/<feature>.spec.ts`
- Nested `tests/<domain>/<feature>.spec.ts` paths are compatibility-only for existing workspaces and require traceability matching by basename/role; explicit `testId`/`scenarioId` metadata is preferred
- Mapping of scenario → file
- Skipped scenarios with reason

### MCP Tools Consumed

- `qa-playwright-kit`: `compile_test_plan`, `validate_generated_tests`, `snapshot_page` (catalog reuse), `list_test_fixtures`, `inspect_file`, `generate_page_object`
- `playwright-test`: `run_tests` (live verification loop, iterate until pass)
- `playwright`: `browser_navigate`, `browser_snapshot`, `browser_file_upload`

Generated files must include `// spec:` and `// seed:` traceability headers (see generator agent).

### Metadata Mapping

See [`.github/agents/generator.agent.md`](agents/generator.agent.md) for `metadata` → `test.describe` / `test.use` / `test.skip` mapping rules.

### Example Prompt

- "Generate tests from `specs/login-test-plan.md` into `tests/login.spec.ts`."

---

## 4) Healer Agent

### Role Description

Diagnoses and repairs failing tests using structured failure payloads.

### Input Format

```json
{
  "failures": [
    {
      "filePath": "tests/example.spec.ts",
      "lineNumber": 42,
      "errorMessage": "Timeout 30000ms exceeded...",
      "tracePath": "artifacts/test-results/.../trace.zip",
      "screenshotPath": "artifacts/test-results/.../screenshot.png"
    }
  ]
}
```

### Output Format

```json
{
  "fixes": [
    {
      "filePath": "tests/example.spec.ts",
      "updatedContent": "..."
    }
  ],
  "cannotFix": [
    {
      "filePath": "tests/other.spec.ts",
      "reason": "Missing reproducible selector context"
    }
  ]
}
```

### MCP Tools Consumed

- `qa-playwright-kit`: `get_test_failures`, `validate_generated_tests`, `inspect_file`, `extract_pdf_text`, `read_excel_summary`, `list_test_fixtures`, `trace_requirement`
- `playwright-test`: `run_tests`
- `playwright`: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_wait_for`, `browser_take_screenshot`; see root [`AGENTS.md`](../AGENTS.md)

### Example Prompt

- "Heal failures from `get_test_failures`, validate, and re-run affected specs."

---

## 5) Reporter Agent

### Role Description

Aggregates test execution results, healing outcomes, and coverage metrics into structured reports.

### Input Format

Pipeline context from Orchestrator plus `get_test_summary`, `trace_requirement`, and `get_test_failures` tool outputs.

### Output Format

- Structured JSON `PipelineReport` with summary, coverage, `summaryByRole`, and unresolved failures
- Markdown report at `artifacts/reports/pipeline-report-<runId>.md`

### MCP Tools Consumed

- `qa-playwright-kit`: `trace_requirement`, `get_test_summary`, `get_test_failures`, `list_requirement_status`, `archive_report`, `list_artifacts`

### Orchestration Mode Behavior

- **Automatic:** Runs immediately after Heal phase without prompting
- **Manual:** Waits for explicit invocation

### Example Prompt

- "Generate the pipeline report for the current run and write it to `artifacts/reports/pipeline-report-<runId>.md`."

