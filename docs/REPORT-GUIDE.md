# Panduan Report QA — QA Playwright Kit

Dokumen ini menjelaskan **3 jenis report** yang dihasilkan framework setiap kali test dijalankan, format data yang tersedia, dan cara membacanya untuk keperluan QA.

---

## Ringkasan Report yang Dihasilkan

Setiap test run menghasilkan **3 lapisan report**:

```
Playwright Test Run
│
├── artifacts/reports/html/index.html              ← Playwright built-in HTML report
├── artifacts/reports/custom-dashboard.html        ← Custom dashboard (local + CI; mode via CI=true)
├── artifacts/reports/test-summary.json            ← Structured JSON summary
└── artifacts/reports/pipeline-report-<runId>.md   ← Pipeline markdown report (saat run via orchestrator; ditulis ke `artifacts/reports/`)
```

### 1. **Playwright HTML Report** (`artifacts/reports/html/index.html`)

- **Sumber:** Playwright built-in reporter
- **Isi:** Test result per file, test step, screenshot, video, trace viewer
- **Kapan digunakan:** Debugging test individual, lihat trace interaktif

### 2. **Custom Dashboard** (`artifacts/reports/custom-dashboard.html`)

- **Sumber:** `CustomReporter` (`src/support/custom-reporter.ts`) + modules `src/support/custom-dashboard/*`
- **File output:** selalu `artifacts/reports/custom-dashboard.html` (bukan path terpisah untuk CI). Mode **local** vs **ci** dipilih di builder (`buildLocalHtml` / `buildCiHtml`) berdasarkan `CI=true`.
- **Isi:** **2 view mode** (toggle di section head)
  - **Table View** (**default**) — triage table + Filter columns + export
  - **Accordion View** — grouped failure-first, **semua card collapse** (termasuk failed)
- **Layout:** full-width (tanpa max-width 1360px); sticky command bar; toolbars **sejajar** `.report-layout` (bukan di dalam panel)
- **Density:** fixed **dense** (tidak ada picker Comfortable/Dense)
- **Evidence & reports:** satu card collapsible (default **tertutup**) — inventory file + deep links
- **Tidak ada:** integrasi Jira / Create JIRA, donut Chart.js, Scan guide, Ops summary duplikat hero
- **Kapan digunakan:** QA review harian, triage `failureSource`, export Confluence/CSV/TSV

### 3. **Test Summary JSON** (`artifacts/reports/test-summary.json`)

- **Sumber:** `CustomReporter` → `onEnd()`
- **Isi:** Structured JSON dengan metadata test, pass/fail counts, per-role breakdown (jika role-aware), dan detail test case per item
- **Kapan digunakan:** Automasi CI/CD, parsing programmatic, MCP tool integration

### 4. **Pipeline Report Markdown** (`artifacts/reports/pipeline-report-<runId>.md`)

- **Sumber:** Reporter agent (`.github/agents/reporter.agent.md`), ditulis oleh `report-builder.ts` ke `artifacts/reports/` sesuai workspace manifest
- **Isi:** Markdown narrative dari full pipeline run (Plan → Generate → Execute → Heal → Report(Analyze)); Report includes the mandatory Analyze sub-phase and `## AI Analysis` contract section
- **Kapan digunakan:** Review end-to-end pipeline result, audit trail, QA decision tracking; APPROVE is valid only when `analysisVerdict=complete` and `analysisVerified=true`

---

## Custom Dashboard — Anatomy & Fitur

### Hierarchy (atas → bawah)

1. **Hero** — verdict (`Run Failed` / `Healthy` / `Degraded`), meta `APP_ENV` / duration / unhealthy count, stat bar Total/Passed/Failed/Skipped/Pass rate
2. **Command bar (global)** — search, status, priority, optional role, has-evidence
3. **Incident alert** — queue active/clear + **export CTAs**
   - **Copy for Confluence** — rich HTML table (Atlassian palette) via clipboard `text/html`; plain fallback = Confluence wiki markup (`||header||` / `|cell|`)
   - **Copy Data (TSV)** — tab-separated for Sheets/Excel; multi-line cells flattened with `|`
   - **Download CSV** — RFC4180 + BOM UTF-8; multi-line preserved inside quotes
   - Semua format menyertakan kolom **AI NOTES** (setelah NOTES); catatan QA ikut di kolom NOTES dengan prefix `QA:`
   - All three respect **filtered rows** + **Filter columns** visibility
4. **Section head** — “Detailed test records” + Table ⇄ Accordion toggle
5. **View toolbars** (sibling of `.report-layout`, show/hide per view)
   - Table: sort + **Filter columns** (visibility + pin sticky header / pin Test ID)
   - Accordion: sort only
6. **Main table / accordion content**
7. **Evidence & reports** (`artifacts-card`, default **collapsed**) — inventory + related links

### View Modes

#### **Table View** (Default)

| Aspek              | Perilaku sekarang                                                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kolom              | 13 kolom — Test ID, Module, Feature, Description, Test Step, Input Data, Expected, Actual, Status, Priority, **SOURCE**, Notes, **AI NOTES**                                                                                                                                                             |
| Steps / Input      | Multi-line blocks (`1. step…`, `key: value` per baris) — **bukan** join inline `·`, **tanpa** ellipsis truncate                                                                                                                                                                                          |
| SOURCE (gagal)     | Stack **Cause** (badge) → **Do** (decision: FILE BUG / FIX TEST / …) → **blurb** singkat; hover = tooltip lengkap                                                                                                                                                                                        |
| SOURCE (pass/skip) | `-` saja                                                                                                                                                                                                                                                                                                 |
| Notes              | chip scenarioId, **CATATAN QA** (free-text, editable QA via tombol ✎), durasi, thumbnail screenshot, link video/trace, badge layer                                                                                                                                                                       |
| AI NOTES           | Catatan AI untuk QA/programmer, 2 lapis: auto-deterministik (selalu ada; bahasa Indonesia; gagal **dan** passed — mis. deteksi lambat, flaky) + naratif agent (badge sumber `[healer]`/`[generator]`/`[reporter]`/`[analyzer]`; saran UI/UX, perbandingan flow, tips data — termasuk di scenario passed) |
| Sticky             | Header optional; **sticky left hanya Test ID** (pin lewat Filter columns)                                                                                                                                                                                                                                |
| Export             | Di alert, **bukan** di table toolbar; menghormati **row filter + kolom visible**                                                                                                                                                                                                                         |
| Density            | Fixed dense — **tidak ada** picker                                                                                                                                                                                                                                                                       |

Kolom tetap tidak pernah di-hide via media query — layar sempit memakai **horizontal scroll**. Tombol ✎ di cell NOTES membuka dialog Catatan QA (detail di [Catatan per Test](#catatan-per-test-qa-notes--notes-from-ai) di bawah).

#### **Accordion View**

- Grouped Unhealthy → Passed → Skipped
- **Semua card collapse by default** (termasuk failed) — expand manual
- Chip body: Errors / Test Steps (Filter steps) / Attachments
- Unhealthy: **Copy failure packet** saja (**tanpa** Create JIRA)
- Trace link di summary + meta grid

#### **Evidence & reports** (bawah)

- Default **collapse**; summary menampilkan readiness: `N retried · N trace · N ss · N video`
- Expand → 4 bucket (Retries / Traces / Screenshots / Videos) dengan **daftar file** (max 4 + “+N more”)
- Related links: Playwright HTML, `test-summary.json`, folder attachments (preview auto-prefix `../`)

#### **Run meta & role health**

- Hero: `APP_ENV`, optional Run ID, generated time, total duration, unhealthy
- `test-summary.json` → `runMeta: { appEnv, runId?, requirementPath?, ci, totalDurationMs, generatedAt }`
- Role-aware: strip pass rate per role di bawah command bar

#### **Attachments**

- Reporter menyalin screenshot/video/trace ke `artifacts/reports/attachments/{screenshots,videos,traces}/` bila file sumber ada, lalu rewrite path relatif ke dashboard.
- `test-summary.json` + `custom-dashboard.html` ditulis oleh custom reporter saat test run. Serve tanpa run ulang: `npm run dashboard`.

---

## Data Schema — `test-summary.json`

### Root Schema

```typescript
interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number; // 0–100 (rounded percent)
  timestamp: string; // ISO 8601

  // === Table View extensions ===
  reportMode?: 'general' | 'role-aware';
  rolesInScope?: string[]; // ['finance', 'super-admin', 'hrd']
  testCases?: CollectedTestCase[]; // Detail per test case
  runMeta?: {
    appEnv: string;
    runId?: string;
    requirementPath?: string;
    ci: boolean;
    totalDurationMs: number;
    generatedAt: string;
  };
}
```

### Per-Test Case Schema

```typescript
interface CollectedTestCase {
  testId: string; // 'TC-LOGIN-01' atau derived ID
  title: string; // Test title dari test('...')
  status: 'passed' | 'failed' | 'skipped' | string;
  duration: number; // ms
  scenarioId?: string;
  role?: string;
  /** Module dari requirement `- **Module:** <name>` atau subfolder tests/. Default: '-' jika belum diisi. */
  module: string;
  /** Feature dari requirement `- **Feature:** <name>` atau filename stem. Default: '-' jika belum diisi. */
  feature: string;
  priority?: 'high' | 'medium' | 'low';
  inputData?: Record<string, string>;
  expectedResult?: string;
  actualResult?: string;
  affectedLayer?: Array<'FE' | 'BE' | 'DB' | 'API'>;
  attachmentCount?: number;
  hasTrace?: boolean;
  /** Unhealthy only (annotation wins over heuristic) */
  failureSource?: 'app' | 'test' | 'requirement' | 'env' | 'ai_generation' | 'unknown';
  /** Catatan QA free-text (sidecar test-notes.json — diedit via ✎ di dashboard, API, CLI, atau MCP). */
  qaNotes?: string;
  /** Catatan AI untuk QA/programmer — 2 lapis: auto-deterministik dari custom reporter + naratif agent (badge sumber). */
  aiNotes?: string;
}
```

---

## Cara Membaca Report untuk QA

### Scenario 1: Review Harian Test Result

1. Buka `artifacts/reports/custom-dashboard.html`
2. Lihat **Run Health Panel** di bagian atas:
   - Total tests, passed, failed, skipped
   - Pass rate (hijau ≥90%, kuning 70-89%, merah <70%)
   - Duration
3. Toggle ke **Table View**
4. Scan kolom **Status** — cari badge merah (❌ FAILED)
5. Untuk setiap FAILED:
   - Baca **Actual Result** — apakah error dari app atau test?
   - Cek **Priority** — HIGH priority di-triage duluan
   - Klik screenshot/video/trace di kolom **Notes** untuk investigasi

### Scenario 2: Export Report ke External Tool (Confluence, Excel)

1. Buka `artifacts/reports/custom-dashboard.html`
2. Toggle ke **Table View**
3. Klik button **Export** di kanan atas tabel
4. Pilih format:
   - **CSV** → Import ke Excel/Google Sheets
   - **TSV** → Import ke tools yang butuh tab-separated
   - **Confluence** → Paste langsung ke Confluence page (sudah dalam format wiki markup)
5. Hasil export menyertakan kolom **AI NOTES** (setelah NOTES) — analisa penyebab gagal dari AI; catatan QA ikut di kolom NOTES dengan prefix `QA:`

### Scenario 3: Triage Failed Test — Tentukan Root Cause

Untuk classify failure, lihat failure source di pesan error test (`result.errors`) — heuristic: app/test/env/requirement.

| Kondisi Actual Result                                   | Decision                  | Action                                                 |
| ------------------------------------------------------- | ------------------------- | ------------------------------------------------------ |
| Error dari app (500, validation error, crash)           | 🐛 **FILE BUG**           | Buat defect ticket, keep test sebagai regression guard |
| Error dari test code (selector broken, assertion salah) | 🔧 **FIX TEST**           | Fix test code atau generator input, rerun              |
| Expected result tidak match requirement                 | 📝 **REVISE REQUIREMENT** | Update requirement, replan, regenerate                 |
| Auth/env issue (token expired, seed data missing)       | 🔧 **FIX ENVIRONMENT**    | Fix auth/env/seed, rerun dari Execute phase            |
| Blocker eksternal (API down, staging broken)            | 🚫 **MARK BLOCKED**       | Archive trace, document blocker                        |

### Scenario 4: Role-Aware Test — Review Per Role

Jika `reportMode: 'role-aware'` di `test-summary.json`:

1. Buka `artifacts/reports/custom-dashboard.html`
2. Toggle ke **Table View**
3. Table akan grouped by **ROLE** dengan section header berwarna teal:

   ```
   ═══ ROLE: FINANCE ═══
   [table rows untuk role finance]

   ═══ ROLE: SUPER-ADMIN ═══
   [table rows untuk role super-admin]
   ```

4. Review pass rate per role — role mana yang paling stabil?
5. Export per role jika perlu (filter manual via Excel setelah export)

---

## Catatan per Test (QA Notes & Notes from AI)

Setiap baris test punya 2 kolom catatan di Table View: **NOTES** (berisi CATATAN QA + evidence) dan **AI NOTES** (catatan dari AI untuk dibaca QA/programmer). Catatan tidak disimpan di dalam `test-summary.json` karena ditulis **setelah** run (review QA, narasi healer) — summary dimiliki reporter — melainkan di **sidecar terpisah** yang di-merge saat render.

### Storage — sidecar `test-notes.json`

- **Lokasi:** `artifacts/reports/test-notes.json` (latest run) — schema `qa.test-notes/v1`.
- **Key:** `<scenarioId>::<role>` (fallback `testId`; role `general` untuk run general-mode; `user` dan `general` saling dianggap ekuivalen saat membaca — konvensi generator memakai role `user` di general mode).
- **Field per key:** `qaNotes`, `aiNotes`, `qaUpdatedAt`, `aiUpdatedAt`, plus `runId` run pemilik. Maks **4000 karakter** per field.
- **Keamanan:** semua teks note (QA maupun AI) di-redact otomatis sebelum disimpan — Bearer token, JWT, `password=/token=/api_key=`, cookie, dan AWS key diganti `[REDACTED]`.
- **Idempoten:** insight AI identik (teks ternormalisasi sama dari source yang sama) tidak disimpan dua kali — aman terhadap retry agent.
- **Reset per-run:** saat run disimpan ke history (`archive:save` / tombol Save di dashboard serve-mode / MCP `archive_report`), sidecar ikut disalin ke `artifacts/reports/archive/<runId>/test-notes.json` lalu sidecar latest di-reset — run baru mulai bersih. Sidecar yang tidak terikat run (tanpa `runId` tapi berisi catatan) juga dianggap stale saat run baru dimulai.
- **Pending pipeline run:** saat pipeline aktif (Orchestrator start / `pipeline_status` dengan state `running`), marker `.pending-run.json` mencatat identitas run yang AKAN datang — catatan Generator/Plan terikat ke run itu dan di-adopsi reporter saat onEnd (TTL 24 jam). **Batasan: satu workspace = satu pipeline aktif**; jalankan pipeline secara berurutan. Identitas pending terekspos sebagai `pipelineRunId` di `pipeline_status` dan `get_test_summary`.
- **Run terarsip:** catatan permanen dan tetap bisa diedit (dialog Catatan QA di dashboard / API).

### Isi kolom AI NOTES — 2 lapis

1. **Auto-deterministik (selalu ada):** analisa berbahasa Indonesia yang di-bake custom reporter ke `testCases[].aiNotes` di `test-summary.json`, dengan tag `Jenis:` dari taxonomy kanonik. Untuk scenario **gagal**: "Jenis: Root Cause — Analisa: Elemen tidak muncul tepat waktu…", "Diduga penyebab: bug aplikasi — siapkan defect ticket", "Berhenti di langkah …", "Gagal konsisten di N attempt — bukan flake". Untuk scenario **passed**: "Jenis: Stability — Flaky: lulus setelah retry ×N", "Jenis: Test Quality — Tidak ada assertion (expect) terdeteksi … (false-green risk)", deteksi durasi lambat relatif terhadap median run (bukan threshold hardcode), dan pengingat actual-result belum diisi generator.
2. **Naratif agent (saat pipeline jalan):** Healer/Generator/Reporter agent memanggil MCP tool `record_ai_note`; tiap baris diawali badge sumber `[healer]` / `[generator]` / `[reporter]` / `[analyzer]`. Catatan AI **tidak hanya untuk error** — pada scenario passed agent bisa menulis saran UI/UX ("filter belum punya empty state"), perbandingan flow ("flow B lebih sederhana dari flow A untuk kasus X"), atau tips data/seed.

**Format insight kanonik** — agent menulis insight terstruktur via field `record_ai_note` (`kind`/`observation`/`evidence`/`impact`/`recommendation`/`priority`/`confidence`/`nextAction`/`status`), dirender dengan label `Jenis / Observasi / Bukti / Dampak / Rekomendasi / Prioritas / Confidence / Next Action` dan label bukti `observed|inferred|recommendation`. Detail taxonomy + guardrails ada di `skills/qa-playwright-kit/references/ai-insight-format.md`.

### AI Run Insights (panel overview)

Halaman overview (`/`) menampilkan panel **AI Run Insights** — pola lintas skenario dari dua sumber:

1. **Deterministik** (di-bake reporter ke `test-summary.json → aiInsights`): modul dengan failure terbanyak, role paling sering gagal, test flaky, pola error berulang (error fingerprint), flow paling lambat vs rata-rata, cluster test passed tanpa assertion, skipped coverage besar.
2. **Agent-authored** (sidecar `runInsights`, ditulis via `record_ai_note` dengan `scope: "run"`): ringkasan naratif reporter/healer, rekomendasi smoke/regression minimum, verdict perbandingan flow. Panel kosong = run kecil & bersih (anti-noise).

### Cara menulis & membaca catatan

- **Dashboard:** tombol **✎** di cell NOTES membuka **dialog Catatan QA**. Serve mode (`npm run dashboard`) → tersimpan otomatis via API (+ SSE `notes-updated` untuk auto-refresh). Mode file:// statis → dialog menyalin perintah CLI untuk dijalankan di terminal.
- **API dashboard:** `GET`/`POST /api/notes/latest` (alias `/api/runs/latest/notes`) dan `GET`/`POST /api/archive/<runId>/notes` (alias `/api/runs/<runId>/notes`). POST body `{scenarioId | testId, role?, qaNotes}` — `qaNotes` string ≤4000 char, string kosong = hapus catatan.
- **CLI:** `npm run note:set -- --scenario=SC-03 [--role=finance] [--test-id=TC-X] --note="teks"` (`--note=""` untuk hapus; `--run=run-…` untuk run terarsip) dan `npm run note:list [--run=run-…]`.
- **MCP tools (total 25):** `record_ai_note` {`message` **atau** field terstruktur (`kind`, `observation`, `evidence`, `impact`, `recommendation`, `nextAction`, `priority`, `confidence`, `status`), `scope?: test|run`, `scenarioId?`, `testId?`, `role?`, `source?: healer|generator|reporter|analyzer`, `runId?`} — additive (catatan AI lama dipertahankan); `set_test_note` {`note` wajib (string kosong menghapus), `scenarioId?`, `testId?`, `role?`, `runId?`}. Tanpa `runId` → latest run; dengan `runId` → run terarsip.
- **Detail views:** accordion TestDetail, detail run terarsip, dan expandable row di daftar arsip menampilkan section **"Catatan"** (Catatan QA + Catatan AI).

---

## Troubleshooting — Known Issues & Workarounds

### Issue #1: Table View tidak responsive di mobile/small viewport

**Status:** Mitigated — **jangan hide** kolom PRIORITY/SOURCE/NOTES lewat media query; pakai **horizontal scroll**. Sticky kiri hanya Test ID.

### Issue #2: Screenshot/video tidak muncul di kolom Notes

**Status:** Mitigated — reporter materializes screenshot/video/trace to `artifacts/reports/attachments/*` when source files exist. Missing files show muted “Missing” chips instead of broken empty `src`.

### Issue #3: Actual Result / steps terpotong (`…`)

**Status:** Mitigated — body text **full wrap**, no `-webkit-line-clamp` / no cell-expand ellipsis. Steps & input multi-line blocks.

### Issue #4: Filter steps di Accordion “tidak jalan”

**Status:** Mitigated — hide via `.tree-item--filtered-out` (`display:none !important`) karena `display:flex` mengalahkan attribute `hidden`. Filter steps hanya di Accordion (bukan Table).

### Issue #5: Deep links 404 dari preview

**Status:** Mitigated — client prefix `../` bila path mengandung `/preview/`; preview script menulis `artifacts/reports/test-summary.json`.

---

## Metadata Extraction — Annotation Pattern

Framework mengekstrak metadata dari **test annotation** yang ditulis oleh Generator agent. Pattern yang dikenali:

```typescript
test('should login successfully', async ({ page }) => {
  // @testId TC-LOGIN-01
  // @priority HIGH
  // @role finance
  // @affectedLayer ui,api
  // @inputData {"username": "finance@example.com", "password": "SecurePass123"}
  // @expectedResult User successfully logged in and redirected to dashboard

  await test.step('Navigate to login page', async () => {
    await page.goto('/login');
  });

  // ... test steps ...
});
```

Jika annotation tidak ada, framework fallback ke:

- `testId`: Hanya di-derive dari pola `TC-<...>` di judul test (`deriveTestId` di custom-reporter.ts) — jika tidak ada pola `TC-`, testId kosong. Contoh `login-finance-should-login-successfully` **tidak** menghasilkan testId.
- `priority`: Dari global requirement metadata atau default `MEDIUM`
- `role`: Extracted dari file name pattern `*-<role>.spec.ts`
- `actualResult`: Error message dari `TestResult.error` atau `'Test passed'`

---

## Pipeline Report — Markdown Format

Saat test dijalankan via **Orchestrator pipeline** (Plan → Generate → Execute → Heal → Report(Analyze)), Reporter agent menghasilkan markdown report di `artifacts/reports/pipeline-report-<runId>.md`. Report memiliki sub-phase Analyze wajib dan section `## AI Analysis`; untuk pipeline run, `APPROVE` hanya sah bila `analysisVerdict=complete` dan `analysisVerified=true`.

### Structure

```markdown
# Pipeline Report — <runId>

**Requirement:** `requirements/<feature-name>.md`  
**Mode:** general | role-aware  
**Started:** <ISO timestamp>  
**Duration:** XXs

---

## Run Summary

- **Total scenarios:** X
- **Tests generated:** Y
- **Passing:** Z (XX%)
- **Failing:** N
- **Skipped:** M

---

## Test Coverage

| Scenario                            | Status    | Duration | Role    | Notes                   |
| --- | --- | --- | --- | --- |
| SC-01: Login with valid credentials | ✅ PASSED | 2.5s     | finance | -                       |
| SC-02: Login with invalid password  | ❌ FAILED | 1.8s     | finance | Error: Assertion failed |

---

## Test Cases (General Mode)

| Test ID     | Description                           | Status    | Priority | Notes                |
| --- | --- | --- | --- | --- |
| TC-LOGIN-01 | should login successfully             | ✅ PASSED | HIGH     | -                    |
| TC-LOGIN-02 | should show error on invalid password | ❌ FAILED | HIGH     | Screenshot available |

---

## Unresolved Failures

### TC-LOGIN-02

- **Stage:** execute
- **Failure Source:** app
- **Error:** Expected error message "Invalid credentials" but got "Login failed"
- **Trace:** `artifacts/test-results/.../trace.zip`
- **Screenshot:** `artifacts/test-results/.../screenshot.png`

---

## QA Decision

**Decision:** 🐛 FILE BUG  
**Reason:** Error message mismatch — app returning generic "Login failed" instead of specific "Invalid credentials"  
**Action:** Create defect ticket, keep test as regression guard
```

---

## FAQ

### Q: Bagaimana cara lihat test untuk role tertentu saja?

**A:** Saat run test, pass `roleFilter`:

```bash
npx playwright test --grep @finance
```

Atau via Orchestrator:

```json
{
  "requirementPath": "requirements/invoice-approve.md",
  "roleFilter": ["finance"]
}
```

### Q: Bagaimana cara archive report setelah QA review?

**A:** Setelah report selesai dan QA memilih keputusan, panggil MCP `archive_report` dengan `runId`, `reportPath`, dan `qaDecision` eksplisit (opsional `qaNotes`). Arsip disimpan ke `artifacts/reports/archive/<runId>/`; writer tidak menimpa arsip yang sudah ada.

### Q: Apa bedanya `reportMode: 'general'` vs `'role-aware'`?

**A:**

- **General:** Satu test suite untuk semua user, tidak ada role-specific auth/data
- **Role-aware:** Test suite terbagi per role (finance, super-admin, hrd), masing-masing punya auth state (`storageState`) dan data seed sendiri

### Q: Bagaimana cara custom kolom Table View?

**A:**

- Runtime (tanpa code): **Filter columns** di table-toolbar — show/hide + pin sticky header / pin Test ID (persist localStorage)
- Source code:
  - Header/export: `src/support/custom-dashboard/export-helpers.ts`
  - HTML row: `src/support/custom-dashboard/components/table/TableView.tsx`
  - Filter attrs: `src/support/custom-dashboard/filter-attrs.ts`
  - SOURCE decision: `src/support/custom-dashboard/failure-source.ts`

Rebuild: run test ulang (custom reporter menulis `test-summary.json` + dashboard) atau `npm run dashboard` (lalu **Ctrl+F5**).

### Q: Kenapa tidak ada Create JIRA / density picker / donut chart?

**A:** Sengaja dihapus/disederhanakan:

- **Jira** — tidak dipakai; triage lewat SOURCE + defect ticket manual / export
- **Density** — fixed dense saja
- **Donut / Scan guide / Ops duplikat** — diganti **Evidence & reports** card (file list + deep links); health counts sudah di hero

### Q: Filter steps di mana?

**A:** Hanya di **Accordion** → expand card → chip **Test Steps** → input “Filter steps”. Table view tidak punya step filter.

### Q: Dashboard serve-mode punya halaman apa saja?

**A:** `npm run dashboard` (src/cli/dashboard-server.ts) menyajikan dashboard interaktif dengan beberapa halaman: **Dashboard** (overview + triage), **History** (daftar run tersimpan), **Compare** (perbandingan run), dan **ReportDetail** (inspeksi mendalam per test). Mode statis (buka `custom-dashboard.html` langsung) hanya menampilkan halaman Dashboard. Tombol Save/Delete/Compare aktif di serve-mode via REST API + SSE auto-refresh.

---

## Changelog (dashboard)

### v0.4.0 (2026-09-06 — Per-test QA Notes & AI Notes)

- ✅ Kolom ke-13 **AI NOTES** di Table View — 2 lapis: auto-deterministik dari custom reporter (analisa penyebab gagal, bahasa Indonesia) + naratif agent dengan badge sumber `[healer]`/`[generator]`/`[reporter]`/`[analyzer]`
- ✅ Kolom NOTES berisi **CATATAN QA** editable — tombol ✎ membuka dialog Catatan QA: serve mode (`npm run dashboard`) tersimpan via API; mode file:// salin perintah CLI
- ✅ Sidecar `artifacts/reports/test-notes.json` (schema `qa.test-notes/v1`, key `<scenarioId>::<role>`) — ikut disalin ke `archive/<runId>/` saat run di-save lalu sidecar latest di-reset; run baru mulai bersih, catatan run terarsip permanen & tetap bisa diedit
- ✅ API GET/POST `/api/notes/latest` (alias `/api/runs/latest/notes`) & `/api/archive/<runId>/notes` (alias `/api/runs/<runId>/notes`) + SSE event `notes-updated`
- ✅ MCP tools baru `record_ai_note` & `set_test_note` (total 25); CLI `npm run note:set` / `npm run note:list`
- ✅ Export TSV/CSV/Confluence menambah kolom AI NOTES (setelah NOTES); catatan QA di kolom NOTES dengan prefix `QA:` — tetap respect row filter + Filter columns
- ✅ Detail views (accordion TestDetail, detail run terarsip, expandable row arsip) menampilkan section "Catatan" (QA + AI)

### v0.3.0 (Current — Monitor/Operate triage board)

- ✅ Full-width shell; command bar global; toolbars sibling of `.report-layout`
- ✅ Fixed dense; no Comfortable/Dense picker; no Jira integration
- ✅ Table: multi-line steps/input; full wrap; SOURCE Cause/Do/blurb; Notes stack
- ✅ Export di incident alert; rows **dan** columns follow live Filter columns
- ✅ Accordion: all cards collapsed by default; Filter steps; Copy failure packet only
- ✅ Evidence & reports collapsible card (file inventory + related links); no Chart.js donut
- ✅ Preview writes `artifacts/reports/test-summary.json`; deep-link `../` from preview

### v0.2.0

- ✅ Full-width; sticky command bar; `runMeta`; `failureSource`; attachments materialize
- ✅ Table/Accordion dual view; role health strip

### v0.1.0-alpha.2

- ✅ Table + Accordion toggle; export CSV/TSV/Confluence; role-aware grouping
- 🆕 Dark mode toggle

---

**Pertanyaan atau feedback?** Buka issue di repo atau hubungi QA lead.
