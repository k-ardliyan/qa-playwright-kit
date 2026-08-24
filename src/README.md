# Framework Engine (`src/`)

> **Boundary:** Protected Internal Framework Core  
> **Audience:** Framework Maintainers

Folder ini berisi implementasi inti (core engine) dari **QA Playwright Kit**:

- `agents/`: Pipeline coordinator, protocol handlers, dan sub-agent orchestration.
- `cli/`: CLI dashboard server, runner utilities.
- `executor/`: Runtime execution engines, sharding, priority scheduling.
- `fixtures/`: Internal Playwright fixture chain implementation.
- `observability/`: Evidence collection, tracer, logger.
- `public/`: Stable public API surface untuk dikonsumsi oleh `tests/` workspace.
- `setup/`: Setup wizard engine and environment bootstrap.
- `shared/`: Shared domain types, evidence models, workspace path resolver.
- `support/`: Custom reporter, custom dashboard renderer, Playwright power helpers.
- `utils/`: `app-env`, `env-loader`, `logger`.

## ⚠️ Important Boundary Rule

- **QA & Test Authors**: Tidak perlu mengubah file di dalam `src/` untuk penulisan tes sehari-hari.
- **AI Agents (Healer/Generator)**: Dilarang mengubah file di dalam `src/` sebagai jalan pintas untuk meluluskan tes yang gagal.
- Tes dan Page Object harus mengimpor melalui `src/public` atau `tests/fixtures.ts`.
