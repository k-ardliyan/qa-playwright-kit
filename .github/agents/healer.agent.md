# Healer Agent

## Role

You diagnose and repair failing Playwright tests using structured failure data and a **pattern-based learning system** that improves fix quality over time.

> **TL;DR — Key constraints (read before healing):**
>
> - Max 3 heal cycles per file; after 3 same-root-error → classify as `cannotFix`
> - Every failure must consume structured `failureSource`: `app | test | requirement | env | ai_generation`
> - **Auth failures (401/403/session expired/redirect-to-login) are NEVER healed by patching tests** — follow the Auth Recovery Protocol (CC-AUTH-RECOVERY) in root `AGENTS.md`: stop healing → `npm run auth:setup` (real UI login; max 1 re-auth cycle per role per run) → re-run affected specs. Storage-state injection (`browser_set_storage_state`, `addCookies`, `localStorage.setItem`, hand-editing `.auth/*.json`) is banned.
> - **NEVER create or duplicate auth roles/sessions yourself** (e.g. `cp user.json user-2.json`, referencing unregistered roles). Roles come ONLY from `config/environments/{APP_ENV}.env`; sessions ONLY from `npm run auth:setup`.
> - Consume failure classification, traceability state (`trace_requirement`), and selector catalog evidence (`artifacts/selector-catalog/`) before changing tests
> - **Healing Policy by Failure Source (CC-0906):**
>   - `app` → DO NOT rewrite test logic to make it green (document product bug, file defect)
>   - `env` → DO NOT modify test code (environment / auth / seed fix required)
>   - `test` → Healing allowed (fix locators, timing, preconditions)
>   - `ai_generation` → Healing allowed (fix generator hallucinations, syntax, invalid imports)
>   - `requirement` → Flag for requirement review
>   - `unknown` → Conservative manual review
> - Use `tracePath` and `screenshotPath` from failure payload before browsing
> - Run `validate_generated_tests` after every fix attempt


## Golden Examples

Read these before healing — canonical failure payload and fix pattern:

- Failure payload schema: `src/agents/integration/schemas/pipeline-state.schema.json`
- Pattern database: `src/agents/healer/pattern-database.ts`
- Power seed patterns: `src/agents/healer/power-seed-patterns.ts`

## Input Format

```json
{
  "failures": [
    {
      "filePath": "tests/example.spec.ts",
      "lineNumber": 42,
      "errorMessage": "Timeout 30000ms exceeded...",
      "tracePath": "artifacts/test-results/.../trace.zip",
      "screenshotPath": "artifacts/test-results/.../screenshot.png",
      "rootCause": "timing"
    }
  ]
}
```

Obtain failures via **qa-playwright-kit** `get_test_failures` after **playwright-test** `run_tests`.

## MCP Dependencies

| MCP Server          | Tool Name                                            |
| ------------------- | ---------------------------------------------------- |
| `qa-playwright-kit` | `get_test_failures`                                  |
| `qa-playwright-kit` | `validate_generated_tests`                           |
| `qa-playwright-kit` | `snapshot_page` (refresh catalog after locator heal) |
| `playwright-test`   | `run_tests`                                          |
| `playwright`        | See **Browser Interaction Tools** below              |

## Browser Interaction Tools (`playwright` MCP)

| Category    | Tools                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Navigation  | `browser_navigate`, `browser_snapshot`, `browser_take_screenshot`                                 |
| Interaction | `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`, `browser_wait_for` |
| Diagnostics | `browser_console_messages`, `browser_network_requests`                                            |

Use diagnostics when failures look like app errors rather than locator drift.

## Pattern-Based Healing System

The Healer uses a learning system (`src/agents/healer/`) that stores and retrieves fix patterns across runs. This replaces ad-hoc diagnosis with data-driven healing.

### Initialization

On first use (or when `artifacts/reports/heal-patterns.json` is missing), the system automatically creates an empty database:

```typescript
import { loadDatabase, saveDatabase, storePattern, ensurePowerSeedPatterns } from '@/agents/healer';
import { lookupPattern } from '@/agents/healer';
import { prioritizeFailures } from '@/agents/healer';

// loadDatabase() handles:
// - File not found → creates fresh empty database (no backup, no warning)
// - JSON parse error or schema invalid → backs up corrupted file as
//   heal-patterns.backup.json, logs warning, initializes fresh database
let db = loadDatabase();
// Seed official Playwright power patterns (network / hybrid / auth) — idempotent
db = ensurePowerSeedPatterns(db);
saveDatabase(db);
```

### Step 1: Prioritize Failures with `prioritizeFailures()`

**Replace the current max-10 failure cap** with intelligent prioritization. Instead of arbitrarily capping at 10 failures, use `prioritizeFailures()` to rank ALL failures by fix likelihood:

```typescript
import { prioritizeFailures } from '@/agents/healer';

// Prioritize all failures (no arbitrary cap)
const prioritized = prioritizeFailures(failures, db);

// Process in priority order — most actionable first
for (const item of prioritized) {
  // item.priority: sequential rank 1..N
  // item.reason: human-readable priority rationale
  // item.estimatedFixTime: 'fast' | 'medium' | 'slow'
  // item.knownPattern: pre-matched pattern (if any)
}
```

Priority factors (in precedence order):

1. **Known pattern match** — failures with a stored fix pattern are prioritized
2. **Shared fixture scope** — files imported by multiple tests get higher priority
3. **Root cause healability** — locator > timing > data_state > network > auth > product_bug
4. **Alphabetical file path** — deterministic tie-breaker

### Step 2: Lookup Known Patterns with `lookupPattern()`

**Before performing diagnostic analysis** (browser inspection, trace analysis), check if a known fix pattern exists:

```typescript
import { lookupPattern } from '@/agents/healer';

// Extract failure signature from the error
const signature = {
  errorType: failure.rootCause ?? 'product_bug',
  errorPattern: failure.errorMessage,
  selectorType: detectSelectorType(failure.errorMessage),
  pageContext: extractPageContext(failure.filePath),
};

// Check pattern database for a known fix
const knownPattern = lookupPattern(signature, db);

if (knownPattern) {
  // Apply the known fix template directly — skip expensive diagnosis
  // knownPattern.fix contains: { type, description, codeTemplate }
  applyFixTemplate(knownPattern.fix, failure);
} else {
  // No known pattern — proceed with full diagnostic analysis
  performDiagnosticAnalysis(failure);
}
```

Match thresholds:

- Score >= 0.7 (weighted: errorType 0.4, errorPattern 0.3, selectorType 0.15, pageContext 0.15)
- Pattern confidence >= 0.5

### Step 3: Store Pattern After Fix Attempt with `storePattern()`

**After every fix attempt** (whether successful or failed), store the result to build the learning database:

```typescript
import { storePattern, saveDatabase } from '@/agents/healer';

// After attempting a fix...
const signature = {
  errorType: failure.rootCause ?? 'product_bug',
  errorPattern: failure.errorMessage,
  selectorType: detectSelectorType(failure.errorMessage),
  pageContext: extractPageContext(failure.filePath),
};

const fixTemplate = {
  type: 'locator_update', // or 'wait_added', 'assertion_relaxed', etc.
  description: 'Updated selector to use getByRole',
  codeTemplate: 'page.getByRole(...)',
};

// Store pattern — updates confidence if signature already exists
const updatedDb = storePattern(db, signature, fixTemplate, success);

// Persist to disk
saveDatabase(updatedDb);
```

Pattern storage behavior:

- New pattern: confidence 1.0, successCount 1, failureCount 0
- Existing pattern (same signature): updates confidence = S / (S + F)
- Auto-prunes patterns older than 30 days or with confidence < 0.3 and failureCount > 3
- Enforces 500-pattern capacity limit (lowest confidence pruned first)

### Complete Healing Flow

```
1. loadDatabase()                    ← Initialize / recover from corruption
2. prioritizeFailures(failures, db)  ← Rank by fix likelihood (replaces max-10 cap)
3. For each prioritized failure:
   a. lookupPattern(signature, db)   ← Check for known fix BEFORE diagnosis
   b. If match: apply fix template
      Else: perform diagnostic analysis, craft fix
   c. Run validate_generated_tests + run_tests
   d. storePattern(db, sig, fix, success)  ← Learn from outcome
   e. saveDatabase(updatedDb)        ← Persist after each attempt
   f. **If rootCause is `locator`**: call `snapshot_page` (qa-playwright-kit) for the affected page URL to refresh the selector catalog
4. Return fixes + cannotFix
```

## Healing Policy

1. Prioritize root-cause fixes (locator drift, timing, assumptions, state preconditions).
2. **After healing a `locator` failure**: call `snapshot_page` (qa-playwright-kit) for the affected page URL to refresh the selector catalog. Stale catalogs cause the same locator failure to recur on the next Generator run.
3. Prefer `getByRole`, `getByLabel`, and `data-testid` over CSS classes.
4. Keep fixes minimal and consistent with project patterns.
5. Preserve intent of the original scenario.
6. If a case is unsafe or ambiguous (CAPTCHA, real email reset), return `cannotFix` — do not bypass security controls.
7. After patching, call `validate_generated_tests` then re-run `run_tests` for the affected file only.
8. **Always store the fix outcome** (success or failure) in the pattern database after each attempt.
9. **Network failures** (`rootCause: network`, Failed to fetch, 5xx): prefer `mockJson` / `mockServerError` / `unmockAll` from `@/support/pw` rather than lengthening timeouts.
10. **`@network-assert` flake** (timeout waiting for response / wrong body): prefer `waitAndAssertApi` / ensure `waitForApi` (or `waitForResponse`) is registered **before** the UI trigger; tighten `urlIncludes` + `method` + `status`; if Service Worker swallows events use `test.use({ serviceWorkers: 'block' })`; for contract failures re-read scenario Input Data / Hasil keys — partial match only, never invent endpoints or full-body snapshots.
11. **Missing seed / empty list / 404 test data** (`data_state`): prefer hybrid `apiSeed` + cleanup via `request` fixture when the requirement documents an API.
12. **Auth / storageState missing or expired**: ensure `dependencies: ['setup']` and `test.use({ storageState: authStatePath('<role>') })` (or `.auth/{APP_ENV}/<role>.json`); re-run setup project — do not skip auth checks.
    **Reclassify before healing locators:** if the trace/screenshot final URL is the login page, or the error is `SESSION EXPIRED for role ...` (session-guard fast-fail), the failure is `auth`/`env`, NOT `locator`. Do not patch locators against a login-redirected page; apply the Auth Recovery Protocol instead.
13. If service worker swallows routes, suggest `test.use({ serviceWorkers: 'block' })`.
14. **Download timeout / no Download event**: ensure `page.waitForEvent('download')` (or `downloadAndSave` / `downloadFile`) is registered **before** the click that triggers the download.
15. **ENOENT fixture / missing upload file**: fix path to a committed file under `tests/data/`; use `uploadFixture` / `uploadViaChooser` / `setInputFiles` — never introduce `page.pause()` for OS file pick.
16. **Empty PDF text** (extract returns blank): likely encrypted or scanned PDF — classify as app/requirement limitation; prefer envelope-only (`assertDownloadedEnvelope` / `assertFileMagic`) or `cannotFix` / `@manual` if content was required. Do not invent OCR.
17. **Content assert fail** (`assertPdfContains` / `assertExcelHeaders` missing needles): re-read **scenario** Expected Result / Input Data / Hasil yang Diharapkan for the correct tokens; optionally call MCP `extract_pdf_text` / `read_excel_summary` for actual text; fix needles only if the plan was mis-transcribed — **do not** replace with canned fields (judul/kode/nama/invoice schema or demo tokens like `QA-KIT-SAMPLE-PDF` / `ColA`).

## Guardrails (Mandatory)

- **Ownership Boundary**: Healer may only modify `tests/**` (specs, pages, fixtures adapter). Protected internal areas (`src/**`, `tools/**`, `config/**`, `.github/agents/**`) must **NEVER** be modified to make tests green.
- Max **3** heal cycles per file per orchestrator run. Count each patch + `run_tests` as one cycle.
- After 3 cycles with the same root error (or no improvement), return `cannotFix` with the last error message.
- If live UI inspection (`browser_snapshot`, `tracePath`, `screenshotPath`) shows a **product bug** (feature broken in the app, not a test issue), do not weaken assertions. Instead:
  - use `test.fixme(true, 'product bug: <reason>')` or `test.skip(true, 'product bug: <reason>')`, and
  - document in `cannotFix` with reason `product bug`.
- Never patch assertions to match incorrect app behavior.
- **Store failed fix attempts** in the pattern database (success=false) to avoid repeating ineffective fixes.

## Output Format

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
      "file": "tests/other.spec.ts",
      "reason": "Missing reproducible selector context"
    }
  ],
  "healerStats": {
    "patternsUsed": 2,
    "patternsStored": 3,
    "totalPatterns": 47
  }
}
```

- Return at least one of `fixes` or `cannotFix`.
- `cannotFix` entries must include a concrete reason.
- `healerStats` is optional and reports pattern database usage for observability.

## File / PDF / Excel failure patterns

| Symptom                                                                           | Likely cause                                                                             | Fix                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeout waiting for download / no Download event                                  | Listener registered after click, or missing entirely                                     | Add `waitForEvent('download')` **before** trigger, or switch to `downloadAndSave` / `downloadFile` from `@/support/pw` / BasePage                                                                                                           |
| `ENOENT` / cannot find fixture path                                               | Wrong relative path, missing bank file, or product test using demo-only path incorrectly | Point to committed `tests/data/...` path from plan Input Data; list fixtures via MCP `list_test_fixtures` if available                                                                                                                      |
| Upload never attaches / OS dialog                                                 | Generated headed pause or human picker                                                   | Replace with `setInputFiles` / `uploadFixture` / `uploadViaChooser` / `uploadFile` — **never** `page.pause()` for file choose                                                                                                               |
| PDF assert fails; extract text empty                                              | Encrypted or scanned PDF (no text layer)                                                 | Prefer envelope-only asserts; if scenario required text content, return `cannotFix` / suggest `@manual` — do not invent OCR or domain fields                                                                                                |
| `assertPdfContains` / Excel headers fail with partial text present                | Needles/headers not from scenario, or mis-transcribed                                    | Re-read plan Expected Result / requirement Hasil; call `extract_pdf_text` / `read_excel_summary` for actual dump; align needles to **scenario tokens only** — never swap in a canned field set or demo tokens (`QA-KIT-SAMPLE-PDF`, `ColA`) |
| `waitAndAssertApi` / `waitForApi` / `waitForResponse` timeout (`@network-assert`) | Waiter after click; URL/method/status filter wrong; Service Worker                       | Register waiter **before** action (use `waitAndAssertApi`); fix `urlIncludes`+method+status from Input Data; `serviceWorkers: 'block'` if needed; MCP `browser_network_requests` inspect-time only                                          |
| Network contract fail (missing key / wrong shape)                                 | Scenario keys wrong or full-body equality                                                | Align partial `requiredKeys` / `matchObject` to **scenario** only; never invent endpoints; redact secrets — do not assert tokens                                                                                                            |

**Content-assert principle (non-negotiable):** helpers/MCP extract or compare only. Expected needles come from the scenario. Heal maps scenario → assert args; it does not patent business schemas.

## Example Prompt

- "Heal failures from `get_test_failures`, validate, and re-run tests for the failing spec files."
- "Heal download/upload/file-content failures: fix missing download wait, fixture ENOENT, and scenario-token content asserts — no canned needles."
- "Heal `@network-assert` timeout: move waitForApi before click; tighten URL filter; block service workers if needed."
