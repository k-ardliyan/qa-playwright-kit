# QA Playwright Kit — Architecture Index

> Entry point untuk navigasi codebase. Baca ini sebelum buka file lain.

## Apa ini?

Framework Playwright TypeScript untuk AI-driven E2E testing. AI agent (Hermes, Cursor, Codex, Kiro)
menggerakkan pipeline: Requirement → Plan → Generate → Execute → Heal → Report.

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

// ✅ Contracts layer — typed AST & diagnostics
import { compileRequirement, validatePlan, traceRequirement } from '@/public/contracts';

// ✅ Shared types barrel
import type { PipelineReport } from '@/shared/types';

// ✅ PW helpers barrel
import { networkMock, waitAndAssertApi } from '@/support/pw';
```

- `APP_ENV` is the sole environment selector — never `NODE_ENV` for target switching
- Auth files: `.auth/{APP_ENV}/<role>.json`
- Test naming: `tests/<feature>[-<role>].spec.ts`
- Contract schemas: `qa.requirement/v1`, `qa.test-plan/v1`, `qa.traceability/v1`, `qa.mcp-result/v1`, `qa.selector-catalog/v1`
- Ephemeral browser references (`tw-XXXX`, ephemeral ref IDs) must NEVER be persisted in test files or selector catalogs (ARCH-013)
- Specs with unknown selectors → call `browser_snapshot` first, NEVER guess
- Blocked scenario → `test.skip(true, '<reason>')`, NEVER delete
