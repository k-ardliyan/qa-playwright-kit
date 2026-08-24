# CUSTOM-MCP

Authoritative documentation for MCP servers and custom QA tools in this repository.

**Tim QA:** mulai dari [docs/GUIDE.md](docs/GUIDE.md). Dokumen ini untuk maintainer framework dan referensi kontrak tool — jangan duplikasi schema di dokumen QA.

**Agent pipeline:** entry point Codex di root [`AGENTS.md`](AGENTS.md); governance ringkas di [`.github/AGENTS.md`](.github/AGENTS.md); sub-agent per fase di [`.github/agents/`](.github/agents/).

## MCP Server Installation

Register and use these **three** servers. **Project source of truth:** [`.mcp.json`](.mcp.json). Keep [`.vscode/mcp.json`](.vscode/mcp.json) only for editor compatibility when needed.

1. **Playwright MCP** (`playwright`) — browser intelligence layer for Planner/Generator/Healer
   - Launcher: `npx tsx tools/scripts/playwright-mcp-launch.ts` (resolves profiles, isolated sessions, and allowed origins)
   - Baseline: `@playwright/mcp@0.0.79`

2. **Playwright Test MCP** (`playwright-test`) — run and debug tests
   - Launcher: `npx tsx tools/scripts/playwright-test-mcp-launch.ts` (loads `config/environments/local.env`, honors `PLAYWRIGHT_CONFIG`)
   - Requires `@playwright/test` >= 1.56

3. **Custom QA MCP (`qa-playwright-kit`)**:
   - Build: `npm run mcp:build`
   - Run: `node tools/mcp/dist/index-mcp.js` (bootstraps env at startup via `tools/mcp/src/utils/mcp-env-bootstrap.ts`)

### Intent Profiles & Capability Router

The framework automatically manages MCP capabilities based on scenario intent. QA does not need to manually configure flags:

| Profile    | Capabilities Enabled                                | Default State       | Purpose                                                              |
| ---------- | --------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| `author`   | `core, testing, storage, config`                    | Headless, Isolated  | Requirement exploration and live semantic locator generation         |
| `debug`    | `core, testing, storage, network, devtools, config` | Headless, Isolated  | Reproducing failures with network logs, console, and on-demand trace |
| `auth`     | `core, storage, config`                             | Headed, Interactive | Interactive SSO / 2FA credential setup                               |
| `visual`   | `core, vision, config`                              | Headless, Isolated  | Canvas / WebGL fallback when no semantic ARIA node exists            |
| `artifact` | `core, pdf, config`                                 | Headless, Isolated  | Browser-rendered PDF document export                                 |
| `minimal`  | `core`                                              | Headless, Isolated  | Fast public page crawling and discovery                              |

### Architectural Invariants & Safety Rules

- **Ephemeral Refs:** Runtime element `ref`s (e.g. `ref:tw-123`) are ephemeral and must **never** be saved into spec files or selector catalogs.
- **Isolation by Default:** All automation profiles run in isolated browser contexts to guarantee test determinism.
- **Application Bug Guard:** Healer does not attempt locator modifications when failures stem from 5xx server errors or unhandled frontend exceptions.

## Running the Custom QA MCP Server

- **Stdio (IDE)**: `node tools/mcp/dist/index-mcp.js`
- **HTTP (testing/dev)**: `cd tools/mcp && npm run build && node dist/index.js` on port `3100`

---

## Tool: `health_check`

Verifies Node, Playwright packages, MCP build, environment files, active `PLAYWRIGHT_CONFIG`, `.auth/{APP_ENV}/` storage state, and optional config-aware JSON reporter output.

### Input

```json
{}
```

### Output

```json
{
  "status": "success",
  "checks": [{ "name": "node", "status": "ok", "message": "..." }],
  "message": "All required health checks passed."
}
```

Common check names: `node`, `mcp_build`, `playwright_mcp`, `playwright_test`, `environment`, `playwright_config`, `base_url`, `auth_challenge`, **`auth_storage`**, `json_results`, `file_content`, `network_assert`.

---

## Tool: `normalize_requirements`

Parses requirement markdown into a structured contract (acceptance criteria, metadata, optional scenarios, tags).

> **Stability: `compat`** — dipertahankan untuk kompatibilitas; tool canonical adalah `compile_requirement` (replacement).

Template reference: [`requirements/_TEMPLATE.md`](requirements/_TEMPLATE.md).

### Input

```json
{
  "requirementPath": "requirements/auth/sample-login-empty-fields.md"
}
```

Or:

```json
{
  "requirementsText": "# REQ-01: Feature\n## Metadata\n- **Tags:** #auth\n- **Auth state:** unauthenticated\n## Kriteria Penerimaan\n- ..."
}
```

### Output

```json
{
  "status": "success",
  "contract": {
    "id": "REQ-01",
    "title": "...",
    "acceptanceCriteria": [{ "id": "AC-1", "description": "..." }],
    "scenarios": [
      {
        "id": "SC-1",
        "name": "...",
        "steps": ["..."],
        "expectedResult": "...",
        "precondition": "optional",
        "automatable": true
      }
    ],
    "tags": ["auth"],
    "metadata": {
      "tags": ["auth", "ui"],
      "priority": "medium",
      "authState": "unauthenticated",
      "startPage": "/login",
      "pomFixtures": ["loginPage"]
    }
  }
}
```

---

## Tool: `parse_requirement_scenarios`

Extracts `###` scenarios with step/result sections from markdown.

**Indonesian labels:** `**Langkah:**`, `**Hasil:**`, `**Prekondisi:**`

> **Stability: `compat`** — dipertahankan untuk kompatibilitas; tool canonical adalah `compile_requirement` (replacement).

**English aliases:** `**Steps:**`, `**Expected Result:**`, `**Precondition:**`, `**Given:**`

Scenarios with `(@manual)` in the heading return `automatable: false`.

### Input

```json
{
  "requirementPath": "requirements/auth/sample-login-empty-fields.md"
}
```

Or:

```json
{
  "requirementsText": "### 1. Happy path\n**Langkah:**\n1. ..."
}
```

### Output

```json
{
  "status": "success",
  "scenarios": [
    {
      "id": "SC-1",
      "name": "Sukses Reset Password",
      "steps": ["..."],
      "expectedResult": "...",
      "precondition": "optional",
      "automatable": true,
      "scenarioType": "success | failure | access-restriction | manual | general",
      "roleScope": "finance",
      "authContext": ".auth/local/finance.json"
    }
  ],
  "rolesInScope": ["super-admin", "finance"],
  "accessExpectations": {
    "super-admin": "bisa approve dan reject",
    "finance": "bisa approve",
    "hrd": "tidak bisa mengakses"
  },
  "message": "Parsed N scenario(s), roles in scope: finance, super-admin."
}
```

- `scenarioType` — derived from `(@success/@failure/@access-restriction/@manual)` tag in scenario heading; defaults to `general` if untagged.
- `roleScope` — per-scenario role from `- **Role:** …`, heading prefix `role: …` (if in Role scope), or the sole Role scope entry; `general`/`default` → `user`. Multi-role scope without per-scenario Role leaves `roleScope` unset (mode general → auth user).
- `authContext` — `unauthenticated`, or `.auth/{APP_ENV}/{role}.json` (APP_ENV from process env, default `local`).
- `rolesInScope` — only present when `Role scope` is defined in requirement metadata.
- `accessExpectations` — only present when `Access expectation` is defined in requirement metadata.

---

## Tool: `validate_requirement`

Validates requirement markdown structure before the Planner runs. Returns a score and violation list.

> **Stability: `compat`** — dipertahankan untuk kompatibilitas; tool canonical adalah `compile_requirement` (replacement).

### Input

```json
{
  "requirementPath": "requirements/auth/sample-login-empty-fields.md"
}
```

Or:

```json
{
  "requirementsText": "# REQ-01: Feature\n..."
}
```

### Output

```json
{
  "status": "success",
  "score": 95,
  "violations": [
    {
      "ruleName": "observable_result",
      "severity": "warn",
      "message": "...",
      "scenarioName": "optional"
    }
  ],
  "message": "Passed with 1 warning(s). Score: 95/100."
}
```

Notable warn rules: `observable_result`, `precondition_recommended`, `manual_reason`, `role_scope_recommended`, `access_expectation_missing`, `failure_scenario_recommended`, **`layer_recommended`** (missing `**Layer terdampak:**` / `**Affected Layer:**` per scenario).

---

## MCP pipeline environment overrides

Optional variables in `config/environments/{APP_ENV}.env` (read by the qa-playwright-kit MCP server process):

| Variable                            | Default                               | Purpose                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLAYWRIGHT_TEST_ROOT`              | `tests`                               | Root untuk bulk `validate_generated_tests` scan (single-file validation juga menerima path di bawah root ini). `list_artifacts` memakai `mcpWorkspace.testsDir` dari `config/qa-kit.workspace.json`, bukan env ini. |
| `PLAYWRIGHT_CONFIG`                 | `playwright.config.ts`                | Active Playwright config; validated by `health_check`; set by launcher/env and overridable from local env                                                                                                           |
| `PLAYWRIGHT_RESULTS_JSON`           | _(derived from config)_               | Override JSON reporter path for Healer / `get_test_failures` fallback                                                                                                                                               |
| `PLAYWRIGHT_ADAPTER_TEST_ROOT`      | `adapter-tests`                       | Adapter spec allowlist + traceability exempt prefix for `validate_generated_tests`                                                                                                                                  |
| `PLAYWRIGHT_ADAPTER_CONFIG`         | `playwright.config.ts`                | Adapter config key for JSON results mapping when `PLAYWRIGHT_CONFIG` points at adapter                                                                                                                              |
| `PLAYWRIGHT_ADAPTER_FIXTURE_IMPORT` | `tests/fixtures`                      | Required import path for specs under adapter test root                                                                                                                                                              |
| `PLAYWRIGHT_ADAPTER_RESULTS_JSON`   | `artifacts/test-results/results.json` | JSON reporter output when adapter config is active (unless `PLAYWRIGHT_RESULTS_JSON` set)                                                                                                                           |

**Config → JSON mapping** (when `PLAYWRIGHT_RESULTS_JSON` is unset): uses `PLAYWRIGHT_ADAPTER_CONFIG` and `PLAYWRIGHT_ADAPTER_RESULTS_JSON` defaults (core workspace values above).

`health_check` validates that `PLAYWRIGHT_CONFIG` points to an existing file and warns when the matching JSON results file is missing.

**Adapter profile example** (set envs only when your fork defines an adapter):

```bash
PLAYWRIGHT_CONFIG=packages/my-adapter/playwright.config.ts
PLAYWRIGHT_TEST_ROOT=packages/my-adapter/tests
```

Single-file `validate_generated_tests` accepts paths under `PLAYWRIGHT_TEST_ROOT` or `PLAYWRIGHT_ADAPTER_TEST_ROOT`.

**No adapter is bundled.** The default adapter root is the sentinel `adapter-tests/`, so without `PLAYWRIGHT_ADAPTER_*` envs nothing matches it and core specs are validated with core rules.


---

## Tool: `list_artifacts`

Lists files under allowed paths: `requirements/*.md`, `specs/*.md`, generated tests under `PLAYWRIGHT_TEST_ROOT` (default `tests/`), and fixture files under `tests/data/` (excluding README).

### Input

```json
{}
```

### Output (shape)

```json
{
  "status": "success",
  "requirements": ["requirements/auth/sample-login-empty-fields.md"],
  "specs": ["specs/..."],
  "tests": ["tests/..."],
  "fixtures": ["tests/data/pdf/sample-text.pdf"],
  "message": "Found N requirement(s), …, M fixture file(s)."
}
```

---

## Tool: `list_requirement_status`

Coverage map for QA: each pipeline requirement (nested OK) with plan/test presence, `@manual` count, and last status from `artifacts/reports/test-summary.json` when available.

### Input

```json
{}
```

### Output (shape)

```json
{
  "status": "success",
  "requirements": [
    {
      "requirementPath": "requirements/auth/sample-login-empty-fields.md",
      "planPath": "specs/auth/sample-login-empty-fields-test-plan.md",
      "hasPlan": true,
      "testPaths": ["tests/auth/sample-login-empty-fields.spec.ts"],
      "hasTests": true,
      "manualCount": 1,
      "lastStatus": "passed"
    }
  ],
  "message": "N requirement(s): P with plan, T with tests."
}
```

Use after preflight or when asking “mana yang sudah diplan / punya test?”.

---

## Tool: `validate_generated_tests`

Validates `.spec.ts` files for fixture import (`@/fixtures/base.fixture` for generator output; `PLAYWRIGHT_ADAPTER_FIXTURE_IMPORT` for adapter specs), `test.describe`, `test.step`, traceability headers (exempt: seed, demo), and capability tags (`@network` / `@network-assert` / `@hybrid` / `@aria` / `@visual` / `@download` / `@upload` / `@file-content` must use matching APIs).

Bulk scan root: `PLAYWRIGHT_TEST_ROOT` env (default `tests`).

### Input

```json
{}
```

Or single file:

```json
{
  "filePath": "tests/ui/auth/login.spec.ts"
}
```

---

## Tool: `get_test_failures`

Resolves Playwright JSON results in this order:

1. **`getJsonResultsPath()`** — config-aware path dari `PLAYWRIGHT_CONFIG` / `PLAYWRIGHT_RESULTS_JSON`
2. Latest `.json` by mtime under `resultsDir` (default `test-results/` di repo root — bukan `artifacts/test-results/`)
3. Legacy `artifacts/test-results/results.json` fallback (config-mapped)

### Input

```json
{
  "resultsDir": "artifacts/test-results"
}
```

### Output

```json
{
  "status": "success",
  "failures": [
    {
      "testTitle": "...",
      "filePath": "tests/...",
      "errorMessage": "...",
      "duration": 0,
      "lineNumber": 42,
      "tracePath": "optional",
      "screenshotPath": "optional"
    }
  ],
  "sourceFile": "artifacts/test-results/results.json or config-mapped JSON path",
  "message": "..."
}
```

---

## Tool: `get_test_summary`

Reads `artifacts/reports/test-summary.json` from the custom reporter. Builds per-role and per-module breakdowns (Opsi B nested: module → features) from `testCases` in the summary file when available.

### Input

```json
{}
```

### Output

```json
{
  "status": "success",
  "summary": {
    "total": 10,
    "passed": 9,
    "failed": 1,
    "skipped": 0,
    "passRate": 90,
    "timestamp": "2026-07-20T..."
  },
  "byRole": {
    "finance": { "passing": 3, "failing": 0, "skipped": 0 },
    "super-admin": { "passing": 2, "failing": 1, "skipped": 0 }
  },
  "byModule": {
    "invoice": {
      "passing": 4,
      "failing": 1,
      "features": {
        "buat-invoice": { "passing": 2, "failing": 1 },
        "approve-invoice": { "passing": 2, "failing": 0 }
      }
    },
    "auth": {
      "passing": 1,
      "failing": 0,
      "features": {
        "login": { "passing": 1, "failing": 0 }
      }
    }
  },
  "message": "Summary: 9/10 passed (90% pass rate, ...)"
}
```

- `byRole` — di-derive dari field `role` per test case di `test-summary.json` (fallback legacy: pola nama file `*-<role>.spec.ts`).
- `byModule` — nested structure (Opsi B): each module contains `passing`, `failing`, and `features` (per-feature breakdown). Only present when `testCases` with `module`/`feature` fields are found in `test-summary.json`.
- Both fields are best-effort; absent if no role/module data can be derived.

---

## Tool: `snapshot_page`

Navigate to a URL with a headless Chromium, capture the ARIA snapshot, and persist a structured selector catalog under `artifacts/selector-catalog/<featureName>/<pageName>.{aria.yml,json}`. The MCP response is a compact summary (path, element count, hash) so AI agents do not need to parse the full ARIA tree in-band.

### Why this tool exists

QA non-coders and AI agents both need resilient, semantically-meaningful locators that survive CSS refactors. The selector extraction follows the Playwright 2026 priority order (`getByRole(name, exact)` → `getByLabel` → `getByText` → `getByTestId` → CSS fallback), and `fragile: true` flags any element that only has a CSS chain. The catalog is the single source of truth that Planner and Generator reuse — eliminating redundant `browser_snapshot` calls (saving ~80% of AI agent tokens per pipeline).

### Input

```json
{
  "url": "https://staging.app/login",
  "featureName": "login",
  "pageName": "login-form",
  "waitForSelector": "form#login",
  "include": ["main"],
  "maxElements": 500,
  "force": false,
  "waitUntil": "networkidle",
  "navigationTimeoutMs": 30000
}
```

- `url` — required, absolute http/https URL.
- `featureName` — required, lowercase slug. Becomes the catalog subfolder.
- `pageName` — required, lowercase slug. Becomes the catalog filename.
- `waitForSelector` — optional CSS selector to wait for before snapshotting.
- `include` — optional CSS scope; restricts snapshot to the first matching subtree.
- `maxElements` — hard cap on captured interactive elements (default 500).
- `force` — re-capture and overwrite existing catalog (default `false`).
- `waitUntil` — `networkidle` (default), `domcontentloaded`, or `load`.
- `navigationTimeoutMs` — per-page timeout (default 30000).

### Output

```json
{
  "status": "success",
  "featureName": "login",
  "pageName": "login-form",
  "url": "https://staging.app/login",
  "hash": "sha256-hex...",
  "elementCount": 12,
  "truncated": false,
  "ariaYmlPath": "artifacts/selector-catalog/login/login-form.aria.yml",
  "selectorsJsonPath": "artifacts/selector-catalog/login/login-form.json",
  "message": "Captured 12 element(s) → artifacts/selector-catalog/login/login-form.json"
}
```

The JSON file at `selectorsJsonPath` contains the full structured index:

```json
{
  "featureName": "login",
  "pageName": "login-form",
  "url": "https://staging.app/login",
  "hash": "sha256-hex...",
  "capturedAt": "2026-06-19T...",
  "truncated": false,
  "elementCount": 12,
  "elements": [
    {
      "role": "button",
      "name": "Login",
      "primary": "page.getByRole('button', { name: 'Login', exact: true })",
      "candidates": [
        {
          "source": "role",
          "expression": "page.getByRole('button', { name: 'Login', exact: true })"
        },
        { "source": "text", "expression": "page.getByText('Login', { exact: true })" },
        { "source": "css", "expression": "[role=\"button\"]:has-text(\"Login\")" }
      ],
      "fragile": false
    }
  ]
}
```

If a fresh catalog already exists for the same URL, the tool returns `skipped: true` and `skipReason: "catalog_fresh"`. Pass `force: true` to overwrite.

### Safety

- Files are written only under `artifacts/selector-catalog/<featureName>/`.
- Path traversal in `featureName` is rejected by `safety.resolveAllowedPath`.
- Hard cap of 100 files per feature (env `SELECTOR_CATALOG_MAX_FILES` to override). Returns `CAP_EXCEEDED` when exceeded.

---

## Tool: `discover_pages`

BFS auto-crawl a public site from a single entry point. For each unique same-origin URL the tool persists an ARIA + selector catalog (via the shared `_internal/snapshot-core.ts`) and appends the page metadata to `artifacts/selector-catalog/<featureName>/page-map.json`. Respects `robots.txt`, applies a politeness delay, and writes a `.discover-state.json` checkpoint every 5 pages (checkpoint dihapus saat crawl selesai; berfungsi sebagai *status log*, belum ada logic resume otomatis dari checkpoint).

### Input

```json
{
  "rootUrl": "https://staging.app",
  "featureName": "public-pages",
  "maxDepth": 2,
  "maxPages": 25,
  "excludePatterns": ["/admin", "/api/", "\\?logout", "/login$"],
  "respectRobots": true,
  "requestDelayMs": 200,
  "waitUntil": "networkidle",
  "force": false
}
```

- `rootUrl` — required, absolute http/https starting URL.
- `featureName` — required, lowercase slug.
- `maxDepth` — BFS depth limit (default 2).
- `maxPages` — total page cap (default 25).
- `excludePatterns` — array of regex strings; matching URL paths are skipped.
- `respectRobots` — honor `robots.txt` `Disallow` + `Crawl-delay` (default `true`).
- `requestDelayMs` — politeness delay between requests (default 200ms).
- `waitUntil` — same enum as `snapshot_page`.
- `force` — re-capture even if catalog is fresh.

### Output

```json
{
  "status": "success",
  "rootUrl": "https://staging.app",
  "featureName": "public-pages",
  "pagesDiscovered": 8,
  "skippedCount": 3,
  "errorCount": 0,
  "pageMapPath": "artifacts/selector-catalog/public-pages/page-map.json",
  "durationMs": 12450,
  "message": "Discovered 8 page(s) under public-pages/ (skipped 3, errors 0)."
}
```

The aggregate `page-map.json` looks like:

```json
{
  "rootUrl": "https://staging.app",
  "featureName": "public-pages",
  "crawledAt": "2026-06-19T...",
  "pages": [
    {
      "url": "https://staging.app/",
      "pageName": "home",
      "title": "Staging App — Home",
      "hash": "sha256-hex...",
      "elementCount": 42,
      "depth": 0,
      "truncated": false
    }
  ],
  "skipped": [{ "url": "https://staging.app/admin", "reason": "exclude_pattern" }],
  "errors": []
}
```

### Filter chain

A URL is rejected (and recorded in `skipped[]`) when any of the following holds:

- non-HTTP(S) scheme (`javascript:`, `mailto:`, `data:`, …)
- origin differs from `rootUrl`
- extension in the blocklist (`.jpg`, `.pdf`, `.zip`, `.css`, `.js`, …)
- `excludePatterns` regex matches path or href
- `respectRobots` enabled and `robots.txt` Disallow matches

### Safety

- No authentication, no login wall traversal. Login-style URLs should be excluded via `excludePatterns` (mis. `/login$`, `/auth/`) — tidak ada deteksi otomatis redirect login.
- Checkpoint file `.discover-state.json` ditulis setiap 5 halaman dan dihapus pada keberhasilan. Catatan: belum ada resume logic — checkpoint saat ini bersifat status/log, bukan recovery point.

---

## Tool: `list_test_fixtures`

List committed files under `tests/data/` for fixture-first upload paths (no headed OS file picker).

### Input

```json
{ "subdir": "pdf" }
```

`subdir` optional relative path under `tests/data/`.

### Output

```json
{
  "status": "success",
  "fixtures": ["tests/data/pdf/sample-text.pdf"],
  "count": 1
}
```

---

## Tool: `inspect_file`

Envelope metadata for a file under `tests/data/` or `artifacts/test-results/` (kind, size, magic). **No domain field schema.**

### Input

```json
{ "filePath": "tests/data/pdf/sample-text.pdf" }
```

### Output

```json
{
  "status": "success",
  "filePath": "tests/data/pdf/sample-text.pdf",
  "filename": "sample-text.pdf",
  "size": 600,
  "kind": "pdf",
  "magic": "pdf",
  "suggestedKind": "pdf"
}
```

---

## Tool: `extract_pdf_text`

Extract **plain text** from a PDF under `tests/data/` or `artifacts/test-results/`.

Returns raw text only. Agents and tests must match **scenario expected tokens** from the requirement — this tool does **not** define business fields (no title/code/name schema).

### Input

```json
{ "filePath": "artifacts/test-results/downloads/export.pdf", "maxChars": 50000 }
```

### Output

```json
{
  "status": "success",
  "filePath": "artifacts/test-results/downloads/export.pdf",
  "kind": "pdf",
  "size": 14200,
  "text": "...",
  "truncated": false,
  "message": "Plain text dump only. Match against scenario expected tokens..."
}
```

---

## Tool: `read_excel_summary`

Structure dump for xlsx under `tests/data/` or `artifacts/test-results/`: sheet names, header row, sample rows. Expected headers come from the **scenario**, not a fixed domain schema.

### Input

```json
{ "filePath": "tests/data/excel/sample-headers.xlsx", "maxRows": 20 }
```

### Output

```json
{
  "status": "success",
  "filePath": "tests/data/excel/sample-headers.xlsx",
  "sheetNames": ["Sheet1"],
  "headers": ["ColA", "ColB", "ColC"],
  "sampleRows": [["a1", "b1", "c1"]],
  "message": "Structure dump only..."
}
```

---

## Tool: `compile_requirement`

Canonical compiler converting requirement markdown into typed `RequirementContractV1` (`qa.requirement/v1`). Includes metadata extraction, access matrix parsing, scenario parsing with provenance, and deterministic source hashing.

### Input

```json
{
  "requirementPath": "requirements/auth/sample-login-empty-fields.md"
}
```

Or:

```json
{
  "requirementsText": "# REQ-01: Feature\n## Metadata\n..."
}
```

### Output

```json
{
  "status": "success",
  "data": {
    "schemaVersion": "qa.requirement/v1",
    "requirementId": "REQ-AUTH-002",
    "title": "Validasi Field Kosong",
    "sourcePath": "requirements/auth/sample-login-empty-fields.md",
    "sourceHash": "sha256-hex...",
    "module": "auth",
    "feature": "login",
    "priority": "high",
    "tags": ["auth", "ui"],
    "auth": { "state": "unauthenticated" },
    "roles": ["super-admin", "finance"],
    "accessMatrix": [
      { "role": "super-admin", "access": "allow", "expectation": "Bisa login" }
    ],
    "acceptanceCriteria": [
      { "id": "AC-01", "description": "Pesan error saat username kosong" }
    ],
    "scenarios": [
      {
        "id": "SC-01",
        "title": "Submit kosong",
        "type": "general",
        "actor": "user",
        "authContext": "unauthenticated",
        "capabilities": [],
        "affectedLayers": [],
        "covers": ["AC-01"],
        "preconditions": [],
        "inputData": [],
        "steps": ["..."],
        "expectations": ["..."],
        "automation": { "automatable": true }
      }
    ]
  },
  "diagnostics": []
}
```

> Field contract mengikuti `RequirementContractV1` (source of truth: `tools/mcp/src/contracts/requirement-contract.ts`). Perhatikan: identitas di `requirementId` (bukan `id`), daftar role di `roles` (bukan `rolesInScope`), judul skenario di `title` (bukan `name`), dan hasil yang diharapkan di `expectations` dengan objek `automation` bersarang (bukan `expectedResult`/`automatable` top-level).

---

## Tool: `compile_test_plan`

Compiles Markdown test plan documents into canonical `TestPlanContractV1` (`qa.test-plan/v1`).

### Input

```json
{
  "testPlanPath": "specs/auth/sample-login-empty-fields-test-plan.md",
  "requirementPath": "requirements/auth/sample-login-empty-fields.md"
}
```

### Output

```json
{
  "status": "success",
  "data": {
    "schemaVersion": "qa.test-plan/v1",
    "sourceRequirementPath": "requirements/auth/sample-login-empty-fields.md",
    "sourceRequirementHash": "sha256-req-hash...",
    "planPath": "specs/auth/sample-login-empty-fields-test-plan.md",
    "planHash": "sha256-plan-hash...",
    "module": "auth",
    "feature": "login",
    "catalogEvidence": [],
    "scenarios": [
      {
        "scenarioId": "SC-01",
        "testId": "TEST-AUTH-002-01",
        "covers": ["AC-01"],
        "actor": "user",
        "authContext": "unauthenticated",
        "executionMode": "automated",
        "dataSetup": [],
        "actions": ["..."],
        "assertions": [
          { "description": "...", "provenance": "requirement" }
        ],
        "locatorIntent": [],
        "networkExpectations": [],
        "artifactExpectations": [],
        "cleanup": [],
        "unknowns": []
      }
    ],
    "coverageGaps": [],
    "diagnostics": []
  }
}
```

> Field contract mengikuti `TestPlanContractV1` (source of truth: `tools/mcp/src/contracts/test-plan-contract.ts`). Tidak ada field `id`; identitas plan dilacak lewat `planPath`/`planHash`. Skenario memakai `actions` (bukan `steps`), `assertions[{description, provenance}]` (bukan `assertionProvenance` flat), dan `executionMode` (bukan `type`).

---

## Tool: `validate_plan`

Validates test plan contracts against requirement contracts. Supports Markdown paths directly or structured in-memory contract objects.

### Input

```json
{
  "testPlanPath": "specs/auth/sample-login-empty-fields-test-plan.md",
  "requirementPath": "requirements/auth/sample-login-empty-fields.md"
}
```

### Output

```json
{
  "schemaVersion": "qa.mcp-result/v1",
  "status": "success",
  "data": {
    "valid": true,
    "plannedScenarios": 4,
    "coveredAcs": 3,
    "uncoveredAcs": 0,
    "assumptionsCount": 0,
    "coverageGapsCount": 0
  },
  "diagnostics": [],
  "message": "Test plan passed all contract validation gates (4 scenarios, 3 ACs covered)."
}
```

`status` bisa `success` (valid), `warning` (0 error, ada warning), atau `error` (ada error). Semua field hasil berada di dalam `data` — tidak ada `planId`/`scenariosPlanned`/`coverageGaps` flat.

Diagnostic codes emitted on drift: `PLAN_STALE_REQUIREMENT`, `PLAN_AC_UNCOVERED`, `PLAN_UNKNOWN_AC`, `PLAN_SCENARIO_MISSING`, `PLAN_EPHEMERAL_REF_DETECTED`, `PLAN_UNKNOWN_PROVENANCE`, `PLAN_UNREVIEWED_ASSUMPTION`, `PLAN_ROLE_DRIFT`, `PLAN_AUTH_DRIFT`, `PLAN_MANUAL_CONVERTED_WITHOUT_REASON`.

---

## Tool: `trace_requirement`

Builds an end-to-end closed-loop `TraceabilityContractV1` (`qa.traceability/v1`) graph and 4-dimensional coverage metrics.

### Input

```json
{
  "requirementPath": "requirements/auth/sample-login-empty-fields.md",
  "summaryPath": "artifacts/reports/test-summary.json"
}
```

Atau tanpa file requirement:

```json
{
  "requirementsText": "# REQ-01: Feature\n## Metadata\n...",
  "resultsDir": "artifacts/test-results"
}
```

> Argumen yang didukung: `requirementPath`, `requirementsText`, `resultsDir`, `summaryPath` (trace-requirement.ts `TraceRequirementArgs`). Tidak ada argumen `testPlanPath` — graf traceability dibangun dari requirement + summary test, bukan dari test plan markdown.

### Output

```json
{
  "status": "success",
  "data": {
    "schemaVersion": "qa.traceability/v1",
    "requirementId": "REQ-AUTH-002",
    "requirementTitle": "Validasi Field Kosong",
    "requirementPath": "requirements/auth/sample-login-empty-fields.md",
    "requirementHash": "sha256-hex...",
    "module": "auth",
    "feature": "login",
    "acceptanceCriteria": [
      { "acId": "AC-01", "description": "...", "coveredByScenarioIds": ["SC-01"], "status": "covered" }
    ],
    "scenarios": [
      {
        "scenarioId": "SC-01",
        "testId": "TEST-AUTH-002-01",
        "title": "Submit kosong",
        "coversAcIds": ["AC-01"],
        "role": "user",
        "specFile": "tests/login.spec.ts",
        "executionStatus": "passed",
        "coverageState": {
          "design": "planned",
          "automation": "automated",
          "execution": "passed",
          "verification": "verified-pass"
        },
        "linkageType": "exact-test-id",
        "evidence": { "tracePath": "artifacts/test-results/.../trace.zip" }
      }
    ],
    "metrics": {
      "totalAcs": 4,
      "coveredAcs": 4,
      "uncoveredAcs": 0,
      "totalScenarios": 4,
      "passingScenarios": 4,
      "failingScenarios": 0,
      "healedScenarios": 0,
      "skippedScenarios": 0,
      "manualScenarios": 0,
      "blockedScenarios": 0
    },
    "coverageState": {
      "design": "planned",
      "automation": "automated",
      "execution": "passed",
      "verification": "verified-pass"
    },
    "generatedAt": "2026-08-22T12:00:00.000Z"
  },
  "message": "Traceability graph generated for REQ-AUTH-002: 4/4 ACs covered, 4 scenarios mapped."
}
```

> Field metrics mengikuti `TraceabilityContractV1.metrics` (source of truth: `tools/mcp/src/contracts/traceability-contract.ts`): `totalAcs`, `coveredAcs`, `uncoveredAcs`, `totalScenarios`, `passingScenarios`, `failingScenarios`, `healedScenarios`, `skippedScenarios`, `manualScenarios`, `blockedScenarios`. Tidak ada field `plannedScenarioCoverage`/`automationCoverage`/`verifiedAcceptanceCoverage` dll. Skenario memakai `coversAcIds`, `specFile`, dan `coverageState` (4 dimensi: design/automation/execution/verification).

---

## Tool: `generate_page_object`

Generates a TypeScript POM scaffold from a selector catalog JSON entry. Never overwrites existing files unless `force: true`. Returns the scaffold with grouped locators, `TODO` markers for business methods, and warnings for fragile selectors.

> Stability: `experimental` — profile `generator` / `author` / `all`.

### Input

```json
{
  "featureName": "login",
  "pageName": "login-form",
  "className": "LoginForm",
  "outputPath": "tests/pages/LoginForm.ts",
  "force": false
}
```

`featureName` dan `pageName` **required**. `className` default: PascalCase dari `pageName`. `outputPath` default: `tests/pages/<ClassName>.ts`.

### Output

```json
{
  "status": "created",
  "path": "tests/pages/LoginForm.ts",
  "elementCount": 12,
  "fragileCount": 0,
  "warnings": ["High element count (60). Consider splitting into multiple POMs."],
  "message": "✅ POM scaffold created at tests/pages/LoginForm.ts. Review TODOs and register in tests/fixtures.ts."
}
```

Jika file sudah ada dan `force` tidak di-set, `status` menjadi `skipped`. Error codes: `INVALID_INPUT` (param wajib), `CATALOG_NOT_FOUND` (jalankan `snapshot_page` dulu), `CATALOG_READ_ERROR`, `INVALID_PATH`.

---

## Tool: `archive_report`

Archives pipeline run artifacts (summary, dashboard, state, traces) to `artifacts/reports/archive/<runId>/`.

### Input

```json
{
  "runId": "run-2026-08-21-001",
  "reportPath": "reports/pipeline-report-run-2026-08-21-001.md",
  "jsonReportPath": "reports/pipeline-report-run-2026-08-21-001.json"
}
```

`runId` dan `reportPath` **required**; `jsonReportPath` opsional. `runId` disanitasi (hanya alfanumerik, hyphen, underscore).

---

## Agent pipeline checklist

1. `health_check` (qa-playwright-kit)
2. `compile_requirement` — compile and validate requirement contract before planning
3. `compile_test_plan` + `validate_plan` (Planner) — validate plan against requirement source hash
4. Generate specs under `tests/` with `setTestMetadata()` + `validate_generated_tests`
5. `run_tests` (playwright-test) — writes JSON reporter output to config-mapped path (default `artifacts/test-results/results.json`)
6. `get_test_failures` → Healer (consumes failure source + traceability + catalog evidence) → `validate_generated_tests` → `run_tests` (scoped)
7. `trace_requirement` + `get_test_summary` + `archive_report` (Reporter)

## CI tool matrix

| Tool / script                                   | `quality.yml` (PR)   | `e2e.yml` (main/manual) | Agent pre-flight |
| ----------------------------------------------- | -------------------- | ----------------------- | ---------------- |
| `npm run health:check` / `health_check`         | yes                  | optional                | yes              |
| `compile_requirement` / `validate_requirement`  | example file via CLI | no                      | yes              |
| `validate_plan` / `validate:test-plan`          | yes                  | no                      | yes              |
| `validate_generated_tests` / `npm run validate` | yes                  | no                      | yes              |
| `npm run test:property`                         | yes                  | no                      | no               |
| `npm run test:contract`                         | yes                  | no                      | no               |
| `get_test_failures`                             | no                   | post-fail               | yes              |
| `trace_requirement`                             | yes                  | yes                     | reporter         |
| `run_tests`                                     | no                   | yes                     | yes              |

CLI wrappers: `npm run validate`, `npm run validate:requirement`, `npm run health:check`, `npm run test:contract`.

## Governance Rule

When any MCP tool is added or changed:

1. Update `tools/mcp/src/` implementation.
2. Update this `CUSTOM-MCP.md`.
3. Update `.github/agents/*.agent.md` and `.github/AGENTS.md` if agents consume the tool.

`CUSTOM-MCP.md` is the authoritative reference for **qa-playwright-kit** tool contracts.

