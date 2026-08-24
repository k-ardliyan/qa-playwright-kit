# Architectural Decisions

> WHY di balik constraint-constraint di framework ini.
> Agent: baca ini jika kamu menemukan edge case yang tidak tercakup TL;DR.
> Last updated: 2026-07-27

---

## D-01: Auth via `authStatePath()`, bukan hardcode path

**Keputusan:** Selalu gunakan `authStatePath('<role>')` dari `src/support/auth-paths.ts`.

**Kenapa:** Path `.auth/{APP_ENV}/role.json` berubah setiap APP_ENV berbeda (local, staging, production).
Hardcode path → test pass di local, silently fail di CI/staging karena file tidak ada di path yang di-hardcode.

```ts
// ❌ Jangan
test.use({ storageState: '.auth/local/finance.json' });

// ✅ Lakukan
import { authStatePath } from '@/support/auth-paths';
test.use({ storageState: authStatePath('finance') });
```

---

## D-02: Import dari `./fixtures` (atau `@/public`), bukan langsung `@playwright/test`

**Keputusan:** Semua spec di `tests/` harus import `test` dan `expect` dari `./fixtures` (atau `@/public`).

**Kenapa:** `fixtures.ts` me-re-export framework fixtures (`logger`, lifecycle `testTrace`) yang dibutuhkan
untuk reporting dan debugging. Import langsung dari `@playwright/test` melewati fixture chain ini —
test akan jalan tapi tanpa trace, tanpa logger, dan reporter tidak bisa render detail yang benar.

```ts
// ❌ Jangan
import { test, expect } from '@playwright/test';

// ✅ Lakukan
import { test, expect } from './fixtures';
```

---

## D-03: Satu spec file per role, bukan satu file dengan multiple `test.use()`

**Keputusan:** Role-aware requirement → `tests/<feature>-<role>.spec.ts` per role.

**Kenapa:** Playwright tidak support multiple `test.use({ storageState })` dalam satu file dengan auth berbeda.
Satu file per role juga memudahkan `roleFilter` di pipeline dan `--grep` saat debugging.

```
// ❌ Jangan — tidak bekerja dengan benar
tests/invoice.spec.ts   ← berisi test finance DAN test hrd

// ✅ Lakukan
tests/invoice-finance.spec.ts
tests/invoice-hrd.spec.ts
```

---

## D-04: `APP_ENV` sebagai satu-satunya environment selector

**Keputusan:** Gunakan `APP_ENV` untuk menentukan target environment. Jangan gunakan `NODE_ENV`.

**Kenapa:** `NODE_ENV` adalah konvensi Node.js untuk development/production mode, bukan untuk target URL.
`APP_ENV` (local/staging/production) menentukan `.env.{APP_ENV}` mana yang di-load, termasuk `BASE_URL`,
kredensial, dan auth paths. Mixing keduanya menyebabkan test salah target secara silent.

---

## D-05: `test.skip()` bukan hapus — untuk scenario yang diblokir

**Keputusan:** Scenario yang tidak bisa diotomasi → `test.skip(true, '<alasan>')`, bukan dihapus.

**Kenapa:** Test yang dihapus hilang dari coverage report. `test.skip` dengan alasan eksplisit:

1. Mempertahankan visibility bahwa scenario ini ada tapi belum covered
2. Jadi reminder untuk diimplementasi nanti
3. Tidak merusak pipeline — skip dihitung dalam report sebagai `testsSkipped`

---

## D-06: `setTestMetadata()` selalu di baris pertama test body

**Keputusan:** Panggil `setTestMetadata(test, { testId, priority, inputData, ... })` sebagai statement pertama.

**Kenapa:** Custom reporter dan Table View dashboard membaca annotations yang di-set oleh `setTestMetadata`.
Kalau dipanggil setelah action pertama, ada kemungkinan test timeout atau fail sebelum metadata ter-set,
dan reporter tidak bisa render Test ID, Priority, atau Input Data untuk test tersebut.

---

## D-07: Barrel imports — selalu dari index, bukan path langsung

**Keputusan:** Import shared types dari `@/shared/types`, PW helpers dari `@/support/pw`.

**Kenapa:** Barrel exports memungkinkan refactor internal tanpa breaking semua import di test files.
Direct path imports (`@/support/pw/network-mock`) akan break jika file dipindah atau direstruktur.

```ts
// ❌ Jangan
import { mockJson } from '@/support/pw/network-mock';
import type { PipelineReport } from '@/shared/types/pipeline-metrics.schema';

// ✅ Lakukan
import { mockJson, unmockAll } from '@/support/pw';
import type { PipelineReport } from '@/shared/types';
```

> Catatan: barrel `@/support/pw` mengekspor `mockJson`, `mockServerError`, `mockAbort`, `mockText`, `unmockAll` (bukan `networkMock` — lihat `src/support/pw/index.ts`).

---

## D-08: Hybrid Architecture Boundary (v2.1)

**Keputusan:**

- Alur kerja QA: `requirements/` ➔ `specs/` ➔ `tests/` ➔ `artifacts/`.
- Framework core engine tetap di `src/`, tooling di `tools/`, konfigurasi di `config/`.
- File tes di `tests/` tidak boleh mengimpor langsung internal `src/agents`, `src/cli`, `src/setup`, melainkan melalui `tests/fixtures.ts` atau `@/public`.

**Kenapa:**

1. Memisahkan test workspace aplikasi dari implementasi framework QA Playwright Kit.
2. Mencegah AI Healer/Generator mengubah implementasi framework core engine saat melakukan healing skenario.
3. Selaras dengan standar dokumentasi dan konvensi resmi Playwright (`playwright.config.ts`, `tests/seed.spec.ts`, `tests/auth.setup.ts`).

---

## D-09: Contract-first Pre-Prompt-Studio Stabilization (v2.2)

**Keputusan:**
1. Pertahankan arsitektur hybrid (`src/`, `tests/`, `tools/`, `config/`, `artifacts/`).
2. `config/qa-kit.workspace.json` adalah canonical single source of truth untuk semua path workspace.
3. Requirement Markdown adalah human authoring format; machine contract versioned (`qa.requirement/v1`, `qa.test-plan/v1`, `qa.traceability/v1`, `qa.selector-catalog/v1`, `qa.mcp-result/v1`) adalah machine state truth.
4. Validasi requirement (`compile_requirement`) dan test plan (`validate_plan`) wajib berjalan sebagai quality gate sebelum Generator/Execution.
5. Prompt Studio dibangun di atas compiler dan schema yang sama setelah seluruh readiness gate lulus.

**Kenapa:**
1. Mencegah path drift dan semantic loss antar tahapan pipeline AI (Planner → Generator → Healer → Reporter).
2. Memastikan setiap assertion memiliki provenance yang jelas (`requirement`, `live-verification`, `framework-derived`, `planner-assumption`).
3. Menjamin keterlacakan penuh: Requirement → AC → Scenario → Test ID → Spec → Execution Status → Artifact Evidence.

---

## D-10: Contract Adoption & Harness Pipeline Closure (v2.3)

**Keputusan:**
Milestone saat ini adalah Contract Adoption & Harness Pipeline Closure. Implementasi Prompt Studio diblokir hingga seluruh readiness gate pada milestone ini lulus.

**Kenapa:**
Fondasi kontrak (`qa.requirement/v1`, `qa.test-plan/v1`, `qa.traceability/v1`, `qa.mcp-result/v1`) harus diadopsi secara konsisten di seluruh lapisan harness (`qa:run`, Planner, Generator, Healer, Reporter, CI, dan dokumentasi) agar eksekusi pipeline deterministik, versioned, resumable, dan bebas path drift sebelum antarmuka authoring grafis dibangun.

---

## D-12: Contract Closure v1 Hardening (v2.4)

**Keputusan:**
1. Contract Closure v1 adalah final core-framework hardening milestone sebelum beralih ke Prompt Studio. Tidak ada penambahan runtime abstraksi baru yang tidak bersumber dari requirement kontrak.
2. Seluruh 21 MCP tool terdaftar dengan stabilitas (`stable`, `compat`, `experimental`), profil intent (`planner`, `generator`, `healer`, `reporter`, `author`, `debug`, `auth`, `visual`, `artifact`, `minimal`, `all`), dan flag `readOnly`.
3. Validasi test plan menerima input Markdown langsung (`validate_plan({ testPlanPath, requirementPath })`) dan memverifikasi source hash, AC coverage, assertion provenance, dan mendeteksi ephemeral refs.
4. Keterlacakan penuh ditutup dengan `TraceabilityContractV1` menghubungkan Requirement → AC → Skenario → Test ID → Spec → Execution Status → Artifact Evidence.

**Kenapa:**
Seluruh runtime, MCP registry, agent instructions, template requirements, harness runner (`qa:run`), dokumentasi arsitektur, dan quality gate CI harus 100% konsisten terhadap spesifikasi kontrak (`qa.requirement/v1`, `qa.test-plan/v1`, `qa.traceability/v1`, `qa.mcp-result/v1`). Hal ini membekukan fondasi core sehingga value selanjutnya dibangun di atas antarmuka dan pengalaman authoring QA (Prompt Studio).

---

## D-13: Core Freeze v1 Established & Long-Term Stability Policy (v2.5)

**Keputusan:**
> `Core Freeze v1` established. Requirement, Plan, MCP, harness launcher, traceability, and workspace contracts are considered stable. Future core changes require a concrete product need or proven QA workflow issue.

1. **Core Freeze v1 Active**: Fondasi core framework QA Playwright Kit (arsitektur hybrid, schema versioning `qa.*/v1`, compiler requirement, compiler test plan, traceability matrix with exact ID primary lookup and heuristic diagnostics, MCP tool registry with runtime profile filtering, failure classification, and pipeline state manager) dibekukan dan stabil.
2. **Backward Compatibility Guarantee**: Schema kontrak `qa.requirement/v1`, `qa.test-plan/v1`, `qa.traceability/v1`, dan `qa.mcp-result/v1` dijamin kompatibel ke belakang. Setiap perubahan non-breaking harus melalui field opsional; perubahan breaking memerlukan bump version ke `v2`.
3. **Freeze Rules (Allowed vs Not Allowed)**:
   - **Allowed**: bug fixes, security fixes, compatibility fixes, changes required by Prompt Studio, changes justified by real QA usage.
   - **Not Allowed**: speculative architecture, new contract version without need, MCP tool expansion without workflow need, directory redesign.
4. **Readiness for Prompt Studio**: Dengan selesainya 4 closure gate (MCP Profile Enforcement, Traceability Convergence, Contract CI Closure, Documentation Parity), repository siap untuk pengembangan antarmuka authoring grafis Prompt Studio.

**Kenapa:**
Memberikan kepastian arsitektur dan stabilitas jangka panjang bagi tim QA dan automasi, memastikan pipeline deterministik dan bebas regresi saat beroperasi dalam skala besar.




