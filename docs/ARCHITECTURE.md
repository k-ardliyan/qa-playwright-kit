# QA Playwright Kit — Architecture Index

> Entry point untuk navigasi codebase. Baca ini sebelum buka file lain.

## Apa ini?

Framework Playwright TypeScript untuk AI-driven E2E testing. AI agent (Hermes, Cursor, Codex, Kiro) menggerakkan metodologi QA kanonik: **01. Explore → 02. Model → 03. Challenge → 04. Generate → 05. Validate [↺ Learn → Refine → Re-explore]**. Workflow semantik ini kini di-enforce di runtime oleh `WorkflowController` (state machine + Explore policy + Challenge gate + feedback router — lihat `src/agents/integration/workflow-*.ts`), dengan mesin eksekusi fisik **Plan → Generate → Execute → Heal → Report(Analyze)** sebagai adapter internal. Report mencakup sub-phase Analyze yang wajib; identitas `pipelineRunId` dipakai sebelum run dan `archiveRunId` menjadi ID arsip kanonik, dengan catatan yang hidup di sidecar.

## Layer Diagram

```text
requirements/          ← QA User menulis requirement di sini
       ↓
specs/                 ← Planner output: test plan markdown
       ↓
tests/                 ← Playwright Test Workspace (spec, pages, adapter, test data)
       ↓
artifacts/             ← Consolidated Runtime Output (reports, test-results, selector-catalog)

[Core Engine & Tooling]
src/                   ← Framework Core Engine (protected internal boundary)
tools/                 ← Tooling, CLI, architecture validators & MCP server
config/                ← Environments & Playwright configuration presets
```

## Canonical References

> Tabel lengkap ada di [`AGENTS.md`](../AGENTS.md) § Architecture Quick Reference — di-load otomatis setiap sesi.

## Key Conventions (inline)

```ts
// ✅ Correct import — always from fixtures adapter or @/public
import { test, expect } from './fixtures';

// ✅ Auth — always use helper, never hardcode .auth/ path
import { authStatePath } from './fixtures';
test.use({ storageState: authStatePath('finance') });

// ✅ Contracts layer — typed schemas & diagnostics
import { REQUIREMENT_SCHEMA_V1, TEST_PLAN_SCHEMA_V1, TRACEABILITY_SCHEMA_V1 } from '@/public/contracts';

// ✅ Pipeline reporting types
import type { PipelineReport } from '@/agents/reporter';

// ✅ PW helpers barrel
import { mockJson, waitAndAssertApi } from '@/support/pw';
```

- `APP_ENV` is the sole environment selector — never `NODE_ENV` for target switching
- Auth files: `.auth/{APP_ENV}/<role>.json`
- Test naming: `tests/<feature>[-<role>].spec.ts`
- Contract schemas: `qa.requirement/v1`, `qa.test-plan/v1`, `qa.traceability/v1`, `qa.mcp-result/v1`, `qa.selector-catalog/v1`, `qa.workflow/v1`
- Ephemeral browser references (`tw-XXXX`, ephemeral ref IDs) must NEVER be persisted in test files or selector catalogs (ARCH-013)
- Never hardcode a developer-specific absolute path (`C:/laragon/...`, drive-letter or `/Users/<name>/` paths) in runtime code — the kit is open source and must run from any checkout. Resolve through `findRepoRoot()` / the workspace registry (ARCH-014)
- Specs with unknown selectors → call `browser_snapshot` first, NEVER guess
- `Report(Analyze)` is a mandatory Analyze sub-phase inside Report; APPROVE is gated by `analysisVerdict=complete` and `analysisVerified=true`
- Semantic workflow: `workflow_run` (MCP) / `npx tsx tools/scripts/workflow-run.ts <req>` drives Explore → Model → Challenge → Generate → Validate; the controller, not prompts, owns stage transitions (`canGenerate` blocks until Challenge passes)
- One workspace supports one active pipeline run; `pipelineRunId` binds pre-run notes and `archiveRunId` identifies the canonical archive
- Blocked scenario → `test.skip(true, '<reason>')`, NEVER delete

## Web Studio (non-coder entry point)

- UI tanpa terminal di `GET /studio` (`src/cli/routes/studio.ts`) — QA non-coder menulis requirement, ganti env, refresh auth, dan menjalankan spec dari browser.
- Route: `GET /studio`, `POST /api/studio/requirement`, `GET|POST /api/studio/env`, `GET|POST /api/studio/auth`, `GET /api/studio/specs`, `POST|DELETE /api/studio/run`, `GET /export/portable`, SSE `GET /events` (`run-log`, `run-done`).
- Ganti environment = tulis pin `config/environments/.active-env` via `writeActiveEnvPin` (`src/cli/studio-env-switch.ts`) — bukan baca file env; `production` wajib `confirmProduction`.
- Refresh auth spawn proses terpisah; stdout/stderr TIDAK di-pipe ke browser (log auth bisa memuat kredensial) — OTP/CAPTCHA selesai di jendela browser.
- Run spec disandbox ke `tests/**/*.spec.ts` (regex + path containment, `src/cli/studio-run.ts`) dan hanya SATU child process aktif — `DELETE /api/studio/run` untuk stop.
- Export portable (`src/support/reporter/portable-html.ts`) = satu file HTML mandiri; screenshot PNG/JPEG di-inline base64 selama < 400KB (`MAX_INLINE_BYTES`).
