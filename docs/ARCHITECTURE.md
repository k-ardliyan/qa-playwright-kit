# QA Playwright Kit — Architecture Index

> Entry point untuk navigasi codebase. Baca ini sebelum buka file lain.

## Apa ini?

Framework Playwright TypeScript untuk AI-driven E2E testing. AI agent (Hermes, Cursor, Codex, Kiro) menggerakkan metodologi QA kanonik: **01. Explore → 02. Model → 03. Challenge → 04. Generate → 05. Validate**. Workflow semantik ini di-enforce di runtime oleh `WorkflowController` (state machine + Explore policy + Challenge gate + feedback router — lihat `src/agents/integration/workflow-*.ts`). Saat ada kegagalan, Validate merutekan balik ke tahap terkecil yang bertanggung jawab (`explore` | `model` | `challenge` | `generate`) atau ke keputusan terminal (`file-bug` | `fix-environment` | `blocked`) — inilah kosakata "learn → refine → re-explore": **target routing, bukan stage**. Mesin eksekusi fisik **Plan → Generate → Execute → Heal → Report(Analyze)** adalah jalur kompatibilitas internal; **`Heal` di situ adalah label substage, bukan stage handler** — tidak ada stage heal di engine. Report mencakup sub-phase Analyze yang wajib; identitas `pipelineRunId` dipakai sebelum run dan `archiveRunId` menjadi ID arsip kanonik, dengan catatan yang hidup di sidecar.

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
- Per-scenario `Evidence Mode`: `ui-e2e` (default) — a UI claim must be evidenced by a browser action + UI assertion. `hybrid-ui` is opt-in and only legal with tag `@hybrid`, a registered seed producer, a browser action + UI assertion on the same test, and test-owned cleanup; enforced by the AST gate in `validate_generated_tests`
- Executable seed data: `config/qa-kit.seeds.json` declares producers (`create: { endpoint, cleanupEndpoint, dependsOn[], payload, idField }`); `src/support/pw/seed-graph.ts` resolves order (topological), substitutes `{parent.<seed>.id}`, and tears down in reverse with test-owned IDs only. Runtime surface = the `seeded` fixture (`src/fixtures/base.fixture.ts`) + `withSeededData`; MCP surface = `list_seeds` / `get_seed_graph`. Metadata-only entries are legal but non-executable
- CRUD/relation intent is structured in requirement/plan (`## Data Targets`, `## Relationships` with `confidence: confirmed | assumption`). Relations are domain truths — never inferred from UI labels; an `assumption` relation cannot drive a runnable assertion
- `DOCTRINE_VERSION` (`src/contracts/versions.ts`, currently `doctrine/v2`) is stamped into every generated spec as `// doctrine: <version>`; a missing stamp is a warning, not a hard fail
- Ephemeral browser references (`tw-XXXX`, ephemeral ref IDs) must NEVER be persisted in test files or selector catalogs (ARCH-013)
- Never hardcode a developer-specific absolute path (`C:/laragon/...`, drive-letter or `/Users/<name>/` paths) in runtime code — the kit is open source and must run from any checkout. Resolve through `findRepoRoot()` / the workspace registry (ARCH-014)
- Specs with unknown selectors → call `browser_snapshot` first, NEVER guess
- `Report(Analyze)` is a mandatory Analyze sub-phase inside Report; APPROVE is gated by `analysisVerdict=complete` and `analysisVerified=true`
- Semantic workflow: `workflow_run` (MCP) / `npx tsx tools/scripts/workflow-run.ts <req>` drives Explore → Model → Challenge → Generate → Validate; the controller, not prompts, owns stage transitions (`canGenerate` blocks until Challenge passes)
- One workspace supports one active pipeline run; `pipelineRunId` binds pre-run notes and `archiveRunId` identifies the canonical archive
- Scenario status is three-way, and the distinction is load-bearing:
  - **`(@manual)`** — not applicable to automation (CAPTCHA, physical OTP, biometric…). Generator emits `test.skip(true, '<reason>')`. This is the ONLY legitimate `test.skip`.
  - **`@blocked` / `@not-implemented`** — real blocker or not-built-yet. Generator emits `test.fixme(...)`; the scenario is recorded in Coverage Gaps. Never `test.skip`.
  - **Known live product bug** — `test.fail(...)`: the test runs and must fail, keeping the defect visible.
  - A scenario whose page has no selector-catalog evidence may NOT be planned as `automated`; it belongs in Coverage Gaps (`validate_plan` → `PLAN_EVIDENCE_MISSING`).

## Web Studio (non-coder entry point)

- UI tanpa terminal di `GET /studio` — QA non-coder menulis requirement, ganti env, refresh auth, atur opsi run, dan menjalankan spec dari browser.
- **Tampilan = dashboard.** Halaman dirender lewat `DashboardDocument` (`src/support/custom-dashboard/pages/web-studio/StudioPage.tsx`) + `studio.css`, jadi memakai token/tema yang sama (IBM Plex, light default, panel/btn/badge). Layout = **tabs shadcn** (Requirement · Jalankan · Environment) + panel per fitur; panel Requirement menampilkan form & pratinjau **berdampingan** dengan tombol collapse. Markup di `StudioPage`; hanya SATU script inline (`renderStudioScript()` di `src/cli/routes/studio.ts`) yang mengikat kontrolnya.
- **Toast & konfirmasi shared.** `components/shared/Toast.tsx` (+ `client/toast.ts`, `window.studioToast`) dan `components/shared/ConfirmDialog.tsx` (+ `client/confirm.ts`, `window.studioConfirm`) di-mount sekali di `DashboardDocument` — dipakai semua halaman, bukan studio-only. Aksi penting (simpan requirement, simpan setelan, ganti environment) minta konfirmasi; hasil sukses/gagal muncul sebagai toast. Ikon = Lucide SVG inline (bukan emoji).
- Route: `GET /studio`, `POST /api/studio/requirement`, `POST /api/studio/run-settings`, `GET|POST /api/studio/env`, `GET|POST /api/studio/auth`, `GET /api/studio/specs`, `POST|DELETE /api/studio/run`, `GET /export/portable`, SSE `GET /events` (`run-log`, `run-done`).
- Tab **Studio** ada di nav dashboard (`AppNav`, `NavTab='studio'`).
- Ganti environment = tulis pin `config/environments/.active-env` via `writeActiveEnvPin` (`src/cli/studio-env-switch.ts`) — bukan baca file env; `production` wajib `confirmProduction`.
- Refresh auth spawn proses terpisah; stdout/stderr TIDAK di-pipe ke browser (log auth bisa memuat kredensial) — OTP/CAPTCHA selesai di jendela browser.
- **Opsi run (slow-mo / headless / viewport / urutan)** divalidasi di `src/cli/studio-run-settings.ts` (pure). **Per-run** (env + argv hanya untuk child yang di-spawn — `--workers=1` untuk mode serial; tidak ditulis ke disk) atau **simpan permanen** (`POST /api/studio/run-settings` → `upsertEnvContent` menulis `SLOW_MO`/`HEADLESS`/`QA_VIEWPORT` ke `config/environments/<APP_ENV>.env`). Viewport diisi dua field angka (lebar × tinggi). Slow-mo hanya berlaku saat headed.
- Run spec disandbox ke `tests/**/*.spec.ts` (regex + path containment, `src/cli/studio-run.ts`), **bisa banyak spec sekaligus**, dan hanya SATU child process aktif — `DELETE /api/studio/run` untuk stop (tombol Stop hanya tampil saat run berjalan).
- Export portable (`src/support/reporter/portable-html.ts`) = satu file HTML mandiri; screenshot PNG/JPEG di-inline base64 selama < 400KB (`MAX_INLINE_BYTES`).
