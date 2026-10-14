# Framework Engine (`src/`)

> **Boundary:** Protected Internal Framework Core  
> **Audience:** Framework Maintainers

Folder ini berisi implementasi inti (core engine) dari **QA Playwright Kit**:

- `agents/`: Sub-agent logic. `pipeline/` adalah workflow engine (`WorkflowController`, stage `explore|model|challenge|generate|validate`, feedback router); `reporting/` adalah report builder, archive/history/compare, dan notes sidecar.
- `cli/`: Dashboard server + runner utilities. `routes/` memisahkan handler HTTP: `http.ts` (request/response + security header), `pages.ts` (perakitan halaman), `studio.ts` / `archive.ts` / `notes.ts` (route per fitur).
- `contracts/`: Typed schema & diagnostics layer (`qa.requirement/v1`, `qa.test-plan/v1`, `qa.traceability/v1`, …).
- `fixtures/`: Internal Playwright fixture chain (`base.fixture.ts` — logger/sessionGuard/testTrace + the test-scoped `seeded` fixture backed by `support/pw/seed-graph.ts`).
- `pipeline-telemetry/`: Pipeline run metrics (`metrics-collector.ts`) dan taksonomi error pipeline (`error-classifier.ts`). Keduanya dipakai test; bukan collector bukti browser — bukti ada di `shared/evidence/`.
- `public/`: Stable public API surface untuk dikonsumsi oleh `tests/` workspace.
- `setup/`: Setup wizard engine, prompt layer, dan task-tasks (`tasks/`).
- `shared/`: Shared domain types, evidence models, workspace path resolver. `shared/mcp/` holds cores twin-synced to `tools/mcp`; `shared/utils/` holds the role-credential and env accessors.
- `support/`: `dashboard/` (renderer + komponen report/dashboard), `report-artifacts/` (collector + artifact renderer seperti `portable-html`), `pw/` (Playwright power helpers), plus auth/session helpers.
- `utils/`: `app-env`, `env-loader`, `logger`, dan helper env lain (`env-text`, `env-clean`, `env-secrets`, `dotenv-keys`).

## ⚠️ Important Boundary Rule

- **QA & Test Authors**: Tidak perlu mengubah file di dalam `src/` untuk penulisan tes sehari-hari.
- **AI Agents (Healer/Generator)**: Dilarang mengubah file di dalam `src/` sebagai jalan pintas untuk meluluskan tes yang gagal.
- Tes dan Page Object harus mengimpor melalui `src/public` atau `tests/fixtures.ts`.
