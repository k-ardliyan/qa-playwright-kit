# MAINTENANCE

Operational guide for maintaining the Playwright AI Agent Framework.

## 1) Add a New Environment File

1. Create a new file in `config/environments/` (for example `staging.env` or `uat.env`).
2. Keep the same key set used by existing environment templates.
3. Set `APP_ENV=<name>` when running tests.
4. Ensure `src/utils/env-loader.ts` recognizes the environment name (or gracefully falls back to `local`).
5. Document usage in `README.md` if this environment is intended for contributors.

Checklist:

- [ ] File exists under `config/environments/`
- [ ] Required keys are present
- [ ] `APP_ENV` run tested locally

---

## 2) Add a New `TAGS` Enum Value

1. Open `src/utils/configuration.ts`.
2. Add enum entry to `TAGS`.
3. Use the new tag in generated/manual tests where relevant.
4. Update docs that mention supported tags (README or agent guidance).

Example (salin dari enum aktual — `src/utils/configuration.ts`):

```ts
export enum TAGS {
  SMOKE = '@smoke',
  REGRESSION = '@regression',
  API = '@api',
  UI = '@ui',
  E2E = '@e2e',
  AUTH = '@auth',
  LOGIN = '@login',
  SEED = '@seed',
  DEMO = '@demo',
  HEALER = '@healer',
  FLAKY = '@flaky',
}
```

---

## 3) Register a New MCP Tool

1. Implement the tool in `tools/mcp/src/tools/`.
2. Register in **`tools/mcp/src/tools/registry.ts`** — add an entry to `TOOL_REGISTRY` array (name, description, inputSchema, handler). The HTTP route and MCP definition are derived automatically.
3. Add/adjust helper utilities in `tools/mcp/src/utils/` if needed.
4. Rebuild and verify:
   - `npm run mcp:typecheck`
   - `npm run mcp:build`
5. Update documentation **before** marking complete:
   - `CUSTOM-MCP.md` (tool name, input schema, output schema, example invocation)
   - `.github/agents/*.agent.md` if an agent uses the new tool
   - `AGENTS.md` MCP tools list if the Orchestrator should call the tool
   - `agent-manifest.json` if phase tools changed

Checklist:

- [ ] Tool implemented in `tools/mcp/src/tools/`
- [ ] Entry added to `TOOL_REGISTRY` in `registry.ts`
- [ ] `npm run mcp:typecheck` and `npm run mcp:build` pass
- [ ] `CUSTOM-MCP.md` updated (tool contract + description)
- [ ] If the new tool is a health check, update `health_check` description in `CUSTOM-MCP.md`
- [ ] Agent instructions updated if applicable
- [ ] `docs/GUIDE.md` / `docs/CHEATSHEET.md` if QA-facing

---

## 4) Update Reporter for a New Field

When a new reporting field is needed (for HTML or `artifacts/reports/test-summary.json`):

1. Update data model in `src/support/custom-reporter.ts`.
2. Populate field in collection phase (`onTestEnd` / `onEnd`).
3. Render field in local and/or CI HTML mode.
4. Include field in `artifacts/reports/test-summary.json` if required.
5. Update reporter property tests in `src/__tests__/property/custom-reporter.property.ts`.

Recommended verification:

```bash
npm run typecheck
npm run validate
npm run test:property
```

---

## 5) Add a Field to the Requirement Template

When extending the QA requirement template (`requirements/_TEMPLATE.md`):

1. Add the field to the template with a short comment explaining its purpose.
2. Update parser in `tools/mcp/src/tools/parse-requirement-scenarios.ts` — add a helper function to extract the new field, then populate it in `parseRequirementScenarios` output.
3. Update `tools/mcp/src/tools/validate-requirement.ts` if the field should trigger a validation rule (error or warn).
4. Update `CUSTOM-MCP.md` output schema for `parse_requirement_scenarios`.
5. Update `.github/agents/planner.agent.md` and `generator.agent.md` mapping rules if agents consume the field.
6. Update `requirements/README.md` and `docs/WRITING-REQUIREMENTS.md` for QA-facing docs.
7. Run `npm run mcp:typecheck` to verify types.

Checklist:

- [ ] Template updated
- [ ] Parser reads new field (`parse-requirement-scenarios.ts`)
- [ ] Validation rule added if required (`validate-requirement.ts`)
- [ ] `CUSTOM-MCP.md` output schema updated
- [ ] Agent docs updated (`planner.agent.md`, `generator.agent.md`)
- [ ] QA docs updated (`requirements/README.md`, `docs/WRITING-REQUIREMENTS.md`)
- [ ] `npm run mcp:typecheck` passes

---

## 6) Sync Agent Definitions with Playwright `init-agents`

Custom agents live in `.github/agents/` and extend the official [Playwright Test Agents](https://playwright.dev/docs/test-agents) with orchestrator + `qa-playwright-kit` requirement pipeline. Do **not** replace them wholesale with `init-agents` output.

When upgrading `@playwright/test`:

1. Note the current version: `npx playwright --version`.
2. Generate upstream reference into a temp folder (do not overwrite repo agents):

   **Codex (primary):**

   ```bash
   # Tidak ada script wrapper — lakukan manual:
   mkdir -p .tmp/init-agents-codex
   cd .tmp/init-agents-codex
   npx playwright init-agents --loop=codex
   ```

   Atau manual:

   ```bash
   mkdir -p .tmp/init-agents-codex
   cd .tmp/init-agents-codex
   npx playwright init-agents --loop=codex
   ```

   **Optional cross-check (VS Code loop):**

   ```bash
   mkdir -p .tmp/init-agents-vscode
   cd .tmp/init-agents-vscode
   npx playwright init-agents --loop=vscode
   ```

3. Diff upstream planner/generator/healer against:
   - `.github/agents/planner.agent.md`
   - `.github/agents/generator.agent.md`
   - `.github/agents/healer.agent.md`
   - root `AGENTS.md` (Orchestrator canonical — merge selectively, do not replace)
4. Merge useful upstream changes only:
   - new MCP tool names or browser interaction patterns,
   - seed-run / live-verify / run-until-pass workflow hints,
   - spec output structure improvements.
5. Preserve framework-specific content:
   - root [`AGENTS.md`](AGENTS.md) (Orchestrator canonical) and [`.github/AGENTS.md`](.github/AGENTS.md) governance,
   - `qa-playwright-kit` tools (`validate_requirement`, `parse_requirement_scenarios`, etc.),
   - `requirements/` → `specs/` → `tests/` paths and Indonesian QA template,
   - hybrid `playwright-cli` + MCP live verification in Generator.
6. Update golden sample if planner format changes: `specs/sample-login-empty-fields-test-plan.md`.
7. Rebuild MCP if validator rules changed: `npm run mcp:build`.
8. Verify:

   ```bash
   npm run test:quality
   ```

Checklist:

- [ ] Upstream `init-agents --loop=codex` diff reviewed
- [ ] Custom orchestrator + qa-playwright-kit sections unchanged
- [ ] Golden test plan still valid
- [ ] Property tests pass

---

## Suggested Release Gate

Before merging maintenance changes:

```bash
npm run test:quality
```

Optional E2E (requires live app + secrets):

```bash
npm run test:ci
```

---

## 7) Integration Layer Maintenance

When modifying the integration layer (`src/agents/integration/`):

1. Run `npm run validate:architecture` to verify boundary rules.
2. Run `npm run manifest:generate` if phase definitions or tool mappings changed.
3. Run `npm run mcp:config` to regenerate platform-specific MCP configs if `.mcp.json` changed.
4. Run `npm run test:property` — integration layer correctness properties that must pass.
5. Run `npm run test:unit` for unit/integration tests.

Checklist:

- [ ] `npm run validate:architecture` passes (exit code 0)
- [ ] Property tests pass
- [ ] Unit/integration tests pass
- [ ] `npm run test:quality` passes

---

## Traceability Exempt Policy

Generated tests (Generator output) **must** include:

```ts
// spec: specs/<feature>-test-plan.md
// seed: tests/seed.spec.ts
```

Legacy manual specs are exempt via `TRACEABILITY_EXEMPT_PREFIXES_STATIC` / `TRACEABILITY_EXEMPT_FILES` in `tools/mcp/src/tools/validate-generated-tests.ts`:

- `tests/seed.spec.ts`
- `tests/demo/healer-test.spec.ts`

Do not add new paths without maintainer review. Prefer `@legacy` tag automation in future.
