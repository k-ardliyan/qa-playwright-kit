# Changelog

All notable changes to QA Playwright Kit are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Setup Wizard — 2026-08-24
- **Setup wizard fixes:** `--env` honored in interactive mode; single `checkReachable`/`isReachableStatus` predicate (304 included on both sides); encrypted (dotenvx `encrypted:`) values no longer leak into prompts/validation — `setup:check` reports `Encrypted roles` instead of false "ready"/fake "unreachable"; password confirm + `isPlaceholderCredential` rejection at prompt; preview (masked `p***t`) + confirm before write; `HEADLESS` managed for all challenge modes (symmetric `true`/`false`); `resolveEnvPath` deduped into `wizard-writer.ts`. New: `src/__tests__/unit/wizard.test.ts` (reachability + `isEncryptedValue`).
- **Setup wizard UX (type-then-Enter):** numeric selectors (`APP_ENV`, challenge mode, login-id) switched from auto-submit-on-keypress `select` to type-then-Enter `text` via `parseNumberedChoice` (trim, leading zeros, bounds 1..N; empty/out-of-range/decimals rejected). Prompt text is now Bahasa Indonesia for a lay-user audience.
- **Setup wizard UX (simplified credentials):** per-role flow collapsed from 3 yes/no + 3 optional fields + optional pref to **1 method pick (Email/Username/Phone) → fill value → password + confirm**. Fewer prompts, no redundant confirm taps; pre-fills existing loginIdPref→email→username→phone.

### Documentation Parity Follow-up — 2026-08-22 (audit round 2)

- **CUSTOM-MCP.md contract truth:** corrected output schemas for `compile_requirement` (`requirementId`/`roles`/`title`/`expectations`/`automation`), `compile_test_plan` (`actions`/`assertions[{description,provenance}]`/`executionMode`, no `id`), `validate_plan` (nested `data` with `plannedScenarios`/`coverageGapsCount`), and `trace_requirement` (no `testPlanPath` arg; metrics `totalAcs`/`coveredAcs`/`healedScenarios`/…). Added missing `generate_page_object` section (was registered but undocumented). Marked `normalize_requirements`/`parse_requirement_scenarios`/`validate_requirement` as `compat` (replacement `compile_requirement`). Corrected `discover_pages` claims (no login-redirect auto-detection; checkpoint is status log, no resume logic) and `get_test_failures` default dir (`test-results/`).
- **Phantom paths removed:** `scripts/setup-wizard.ts` (TROUBLESHOOTING), `scripts/check-env-health.ts` (ENVIRONMENT-GUIDE → now points to `health:check`/`env:status`), `scripts/sync-init-agents.sh/.ps1` (MAINTENANCE → manual `npx playwright init-agents`), `qa-playwright-kit-CORE-FREEZE-RC-PROMPT-STUDIO-PREP.md` (PROMPT-STUDIO boundary → DECISIONS D-13).
- **Invalid commands fixed:** `npx playwright auth.setup` → `npm run auth:setup` (ENVIRONMENT-GUIDE); removed `npm run dev:backend`, `DEBUG_MODE`/`_option_browserClose` config snippet, `.env.local` naming, `RATE_LIMIT_ENABLED`; TROUBLESHOOTING "TypeScript 6.x" → `^5.9.3`.
- **Symbol drift fixed:** DECISIONS `networkMock` → `mockJson`/`unmockAll` and `validate_test_plan` → `validate_plan`; MIGRATION-GUIDE `EPHEMERAL_LOCATOR_LEAK`/`ROLE_MISMATCH` → `PLAN_EPHEMERAL_REF_DETECTED`/`PLAN_ROLE_DRIFT`; MAINTENANCE TAGS example now matches `src/utils/configuration.ts` (no `SECURITY`) and `TRACEABILITY_EXEMPT` → `TRACEABILITY_EXEMPT_PREFIXES_STATIC`/`_FILES`.
- **Wizard truth:** GETTING-STARTED/README/FORK-ONBOARDING/requirements-README now describe the actual `src/setup/index.ts` wizard (6 steps, env file only — no browser install, no auth setup, no auto-encrypt, no `requirements/login.md` generation).
- **Report paths:** pipeline-report is `reports/pipeline-report-<runId>.md` (no artifacts mirror) — POST-PIPELINE/REPORT-GUIDE corrected; archive path clarified as `artifacts/reports/archive/<runId>/`; testId fallback description corrected (TC- pattern only); serve-mode multi-page documented.
- **Contracts docs:** DIAGNOSTICS.md completed (13 missing codes incl. `TRACE_HEURISTIC_LINK_USED`, `PIPELINE_STATE_STALE`, `INVALID_INPUT`); TRACEABILITY-MODEL metrics/JSON/args aligned with `tools/mcp/src/contracts/traceability-contract.ts`; TRACEABILITY-CONTRACT.md rewritten to full contract; TEST-PLAN-CONTRACT.md added `CoverageGap`/`CatalogEvidence`.
- **Template & parser:** `_TEMPLATE.md`/WRITING-REQUIREMENTS `- **Actor:**` → `- **Role:**` (parser reads `Role:`); Feature severity "Wajib" → "Disarankan" (validator warn); default scenario type note (`general`, not `success`); `manual-check.ts` now also reads `**Hasil yang Diharapkan:**` label.
- **Misc:** DIRECTORY-MAP observability entry → `error-classifier.ts`/`metrics-collector.ts`; LESSONS-LEARNED path `src/tests/` → `tests/`; GUIDE link casing + `demo-visual.spec.ts` → `demo-pw-power-extended.spec.ts`; README `examples/` line removed; CREDENTIALS env path canonical; deck sharing HTML: dashboard paths → `artifacts/reports/`, wizard "enkripsi otomatis" → `env:edit` terpisah, Feature "wajib" → "disarankan" (angka 76 alat MCP dipertahankan — sesuai `mcp:check`/capability manifest).

### Core Freeze v1 — 2026-08-21

- **MCP Runtime Profile Enforcement (RC-1)**
  - Enforced active tool profiles (`planner`, `generator`, `healer`, `reporter`, `discovery`, `admin`, `all`) at runtime.
  - Dynamic `ListTools` filtering and strict profile authorization during tool dispatch (`MCP_TOOL_NOT_ALLOWED_FOR_PROFILE`).
  - Added unit test suite for profile filtering, unauthorized invocation blocking, and configuration resolution.
- **Traceability Convergence (RC-2)**
  - Prioritized exact identifier linkage (`testId` -> `scenarioId` -> `requirementId` -> heuristic fallback).
  - Emitted `TRACE_HEURISTIC_LINK_USED` diagnostic with reason and confidence score for fallback matching.
  - Integrated 4D coverage state model (`design`, `automation`, `execution`, `verification`) across scenario nodes and root contract.
  - Enforced strict AC coverage rules: non-executed / planned tests never marked as `covered`.
  - Reused shared failure classifier for structured root cause attribution (`app`, `test`, `env`, `ai_generation`, `unknown`).
- **Contract CI Closure (RC-3)**
  - Resolved npm script drift in `package.json` for `validate:test-plan` and `test:mcp-profiles`.
  - Enforced offline contract suite guarantee across all schema validators and golden contract fixtures.
  - Added golden fixtures for stale plans, invalid AC plans, unexecuted traces, and profile snapshots.
- **Documentation Parity (RC-4)**
  - Synchronized `README.md`, `CUSTOM-MCP.md`, and agent guidance documents with canonical tool names and 21 registered tools.
  - Eliminated legacy paths across documentation (`test-fixtures/`, `mcp-server/`, un-prefixed `selector-catalog/`).
  - **Doc sync follow-up (audit 2026-08-22):**
    - Restored missing npm scripts referenced by docs: `auth:setup:headed` (headed OTP/CAPTCHA session via `--headed`), `mcp:config` (new CLI `tools/scripts/mcp-config.ts` wrapping `mcp-config-generator`, supports `--platform=` and `--check` with exit 2 drift convention), `manifest:generate` (wraps `writeManifest`).
    - Fixed `.vscode/mcp.json` launcher path (`scripts/playwright-mcp-launch.ts` → `tools/scripts/playwright-mcp-launch.ts`) and added `.kiro/` to `.gitignore` (generated by `mcp:config`).
    - Removed ghost commands from README/CHEATSHEET (`snapshot:page`, `discover:pages`, `test:headed`, `validate:agents`, `preview-dashboard.ts`); README script table now matches the 46 real npm scripts.
    - Replaced `npx tsx scripts/preview-dashboard.ts` guidance with `npm run dashboard:serve` in REPORT-GUIDE/TROUBLESHOOTING.
    - Fixed broken link `docs/AUTH-CONT-CONVENTION.md` → `docs/AUTH-CONTEXT-CONVENTION.md` and dead `REQUIREMENT-CONTRACT.md` reference (now points to `src/contracts/requirement-contract.ts`).
    - Updated `MCP-CURRENT-STATE.md` / `MCP-MIGRATION-GUIDE.md` from stale `0.0.78` to `0.0.79` and corrected bootstrap path (`tools/mcp/src/utils/mcp-env-bootstrap.ts`).
  - **Example adapter removal & de-ERPku-ing (audit 2026-08-22):**
    - Removed `examples/erpku/` entirely (docs, POMs, adapter env overlay). Adapter seam tetap ada via `PLAYWRIGHT_ADAPTER_*` env dengan default sentinel `adapter-tests/` (tidak match spec apa pun) — `isAdapterSpecPath`/`getAdapterTestRoot`/`getAdapterConfigPath`/`getAdapterFixtureImport`/`getAdapterJsonResultsPath` default tidak lagi menunjuk ke path ERPKU.
    - Removed ERPKU adapter overlay dari `mcp-env-bootstrap.ts` (path `example/erpku/` singular ternyata salah selama ini — ghost path).
    - Removed `@erpku/*` alias dari `tsconfig.json`; updated property tests (`playwright-paths`, `get-test-failures`, `custom-reporter`) ke adapter-neutral fixtures.
    - Removed unused `image-size` dependency (+ lockfile).
    - Cleaned docs (`CUSTOM-MCP.md` env table, `CONTEXT.md`, `DIRECTORY-MAP.md`, `FORK-ONBOARDING.md`, `GUIDE.md`, `MAINTENANCE.md`, `.github/agents/planner.agent.md`, `AUTH-CONTEXT-CONVENTION.md`) from `examples/erpku` / `test:erpku-example` / `generate-mcp-config.ts` claims.
  - **Documentation consolidation & cleanup (audit 2026-08-22):**
    - Fixed CI bug: `nightly-e2e.yml` memanggil `playwright.cross-browser.config.ts` (tidak ada) → `config/playwright/cross-browser.ts` (config asli).
    - Removed orphaned/stale planning & task docs: `docs/architecture/HYBRID-MIGRATION-PLAN.md` (4.4k baris execution-plan selesai), `MCP-UPGRADE-CHECKLIST.md`, `INTENT-PROFILES.md` (duplikat CUSTOM-MCP), `HEALER-TAXONOMY.md` (terwakili reporter.agent + POST-PIPELINE), `docs/engineering/*` (MCP-CURRENT-STATE + MCP-MIGRATION-GUIDE — snapshot tugas selesai), `docs/HARNESS.md` (0 referensi, konten duplikat GUIDE/README qa:run), `docs/WRITING-TEST-PLANS.md` (0 referensi, konten di GUIDE), `.github/agents/orchestrator.agent.md` (stub → root AGENTS.md).
    - Merged `docs/TRACEABILITY.md` + `docs/contracts/COVERAGE-MODEL.md` → `docs/contracts/TRACEABILITY-MODEL.md` (konsep traceability + coverage 4D satu file).
    - Removed last ERPKU reference in `config/environments/local.env.example`.
    - Fixed `docs/recipes/README.md` broken link ke `FORK-ONBOARDING.md` (salah depth + anchor).
    - Full-repo markdown link scan: **0 broken links** dari 63 file `.md` (artifacts/ di-exclude).
- **Core Framework Freeze**
  - Formally established `Core Freeze v1` in `docs/architecture/DECISIONS.md` (D-13).
  - Defined Prompt Studio v1 integration boundary and contracts in `docs/architecture/PROMPT-STUDIO-INTEGRATION-BOUNDARY.md`.

## [0.2.0-alpha.1] - 2026-08-21

### Added

- **Hybrid Architecture**
  - Clean separation of concerns: `tests/` (workspace for test specs, POMs, test data, and fixtures), `src/` (protected framework core), `tools/` (maintainer tooling & MCP servers), `config/` (environments and Playwright configurations), and `artifacts/` (test results, reports, and selector catalogs).
  - Explicit Public Testing API boundary at `src/public/` (`fixtures`, `auth`, `metadata`, `workspace`).
  - Architecture and boundary validator (`tools/validators/architecture.ts`) with zero-tolerance enforcement for cross-boundary imports.
- **3-Server MCP Architecture & 19 Custom Tools**
  - Dedicated custom MCP server `qa-playwright-kit` under `tools/mcp/` exposing 19 tools across Preflight, Requirements, Selectors, Test Generation, Fixtures, Execution, and Reporting.
  - Profile-based launcher for Playwright MCP (`tools/scripts/playwright-mcp-launch.ts`) and Playwright Test MCP (`tools/scripts/playwright-test-mcp-launch.ts`).
  - 19 custom tools: `health_check`, `validate_requirement`, `normalize_requirements`, `parse_requirement_scenarios`, `list_requirement_status`, `snapshot_page`, `discover_pages`, `validate_generated_tests`, `generate_page_object`, `list_test_fixtures`, `inspect_file`, `extract_pdf_text`, `read_excel_summary`, `get_test_failures`, `list_artifacts`, `get_test_summary`, and `archive_report`.
- **Capability Helpers & Assertions**
  - Network live assertion (`@network-assert`): `src/support/pw/network-assert-core.ts` and `network-assert.ts`.
  - Document & file content validation (`@file-content`, `@upload`, `@download`): `src/support/pw/file-content-core.ts` and `files.ts` (PDF text & Excel header assertions).
  - Assisted human challenge solver for session bootstrap (OTP / CAPTCHA): `src/support/human-challenge.ts`.
- **Interactive Triage Dashboard v3**
  - Full-width modern layout with Table View and Accordion View.
  - Multi-line Test Step / Input Data, SOURCE root-cause explanation tooltips, dynamic column filtering, Confluence/TSV/CSV exports, and deep evidence inspection.
- **Documentation & Agent Governance**
  - Standardized all documentation files to UPPERCASE naming in `docs/` and `docs/recipes/`.
  - Standardized all markdown table delimiters to 3 hyphens (`| --- | --- |`).
  - Updated agent governance files (`AGENTS.md`, `.github/AGENTS.md`, `.github/agents/*.agent.md`) for canonical paths and tool contracts.

### Changed

- **Dependency Upgrades**
  - `@dotenvx/dotenvx` ^2.17.4 → **^2.21.0**
  - `@playwright/test` ^1.62.0 → **^1.62.1**
  - `playwright` ^1.62.0 → **^1.62.1** & `playwright-core` ^1.62.0 → **^1.62.1**
  - `@modelcontextprotocol/sdk` ^1.29.0 → **^1.30.0**
  - `tsx` ^4.23.1 → **^4.23.12**
  - `eslint` ^10.8.0 → **^10.8.1**
  - `eslint-plugin-playwright` ^2.10.5 → **^2.11.0**
  - `typescript-eslint` ^8.65.0 → **^8.67.0**
  - `lint-staged` ^16.4.0 → **^17.3.0**
  - Pinned `@types/node` at `^20.19.43` and `typescript` at `^5.9.3` / `^6.0.3` to ensure compiler and plugin stability.
- Relocated historical migration plan from root to `docs/architecture/HYBRID-MIGRATION-PLAN.md`.

### Removed

- Removed legacy root and deprecated directory structures (`src/tests/`, `test-fixtures/`, `src/pages/`).
- Removed redundant Jira integration in favor of universal CSV/TSV/Confluence exports.

## [0.1.0-alpha.2] - 2026-06-17

### Added

- Custom dashboard modules under `src/support/custom-dashboard/` with native-like errors, collapsible test steps, screenshots, video, and attachments
- Property tests for custom reporter attachments and Playwright env load order (`playwright-config-env.property.ts`)
- `.nvmrc` for Node 20 LTS workshop setup
- Dedicated Playwright `demo` project and `npm run test:demo` script

### Changed

- Node.js engine requirement lowered to **>= 20.19.0**; downgrade `lint-staged` to 16.x for Node 20 compatibility
- CI workflows and health check aligned to Node 20 LTS; workshop docs updated for Node 20.19+ prerequisite
- `SLOW_MO`, `HEADLESS`, and `BASE_URL` read after `loadEnvironment()`; `slowMo` wired via `launchOptions`
- `npm test` excludes `@demo` via `--grep-invert`; default chromium project ignores `demo/` folder
- Custom dashboard shows all tests in local mode with responsive layout and report-relative attachment paths

### Removed

- Unused placeholder folders `src/tests/e2e/` and `src/tests/api/`

## [0.1.0-alpha.1] - 2026-06-16

### Added

- Generic template core with `project.fixture.ts` seam and `frameworkFixtureExtend`
- Reference Adapter under `example/erpku/` (POMs, auth setup, adapter env overlay)
- MCP adapter path seam (`PLAYWRIGHT_ADAPTER_*`) and Playwright profile bootstrap (#16/#19)
- `createFrameworkReporters()` for Healer JSON gate (#15)
- Alpha workshop docs: `docs/WORKSHOP.md`, `docs/GETTING-STARTED.md`
- ADRs 0001–0003, `docs/FORK-ONBOARDING.md`, `CONTEXT.md`

### Changed

- ERPKU-specific code moved from template core to `example/erpku/`
- `playwright-test` MCP uses profile launcher (`scripts/playwright-test-mcp-launch.ts`)
- CI E2E artifact paths aligned with ERPKU adapter outputs
- `get_test_failures` prefers config-mapped JSON over stale `results.json`
- README Node requirement aligned to >= 22.22.1
- Workshop Path B documented as adapter reference only (no AI generate to adapter root)
- Generator verification sections renamed (CLI vs MCP) to avoid workshop Path A/B confusion

### Known limitations (alpha)

See [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

[Unreleased]: https://github.com/k-ardliyan/qa-playwright-kit/compare/v0.2.0-alpha.1...HEAD
[0.2.0-alpha.1]: https://github.com/k-ardliyan/qa-playwright-kit/releases/tag/v0.2.0-alpha.1
[0.1.0-alpha.2]: https://github.com/k-ardliyan/qa-playwright-kit/releases/tag/v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/k-ardliyan/qa-playwright-kit/releases/tag/v0.1.0-alpha.1
