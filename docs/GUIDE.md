# Panduan QA — Bekerja di Laptop Lokal

Panduan setup, pipeline, dan troubleshooting tim QA.

> **🆘 Setup error?** Cek [TROUBLESHOOTING.md](TROUBLESHOOTING.md) untuk 10 error paling umum + solusinya.
>
> **▶️ Baru selesai menjalankan pipeline?** Baca [REPORT-GUIDE.md](REPORT-GUIDE.md) untuk memahami dashboard triage, failureSource, dan keputusan QA.

Referensi cepat: [CHEATSHEET.md](CHEATSHEET.md) · [REPORT-GUIDE.md](REPORT-GUIDE.md) · [CREDENTIALS.md](CREDENTIALS.md) · [TROUBLESHOOTING.md](TROUBLESHOOTING.md) · [AGENTS.md](../AGENTS.md)

---

## Mulai di Sini

| Langkah                            | Dokumen                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Tulis requirement                  | [requirements/\_TEMPLATE.md](../requirements/_TEMPLATE.md) · [WRITING-REQUIREMENTS.md](WRITING-REQUIREMENTS.md)          |
| Rapikan catatan (ChatGPT/Gemini)   | [WRITING-REQUIREMENTS.md → Prompt untuk AI eksternal](WRITING-REQUIREMENTS.md#prompt-untuk-ai-eksternal-chatgpt--gemini) |
| Pipeline AI                        | Section **Prompt Siap Pakai** di dokumen ini                                                                             |
| Contoh requirement login (catalog) | [requirements/auth/login-none.md](../requirements/auth/login-none.md)                                                    |

---

## Setup Lokal (Sekali per Mesin)

Prasyarat: Node.js >= 20.19.0 dan Git terpasang di sistem.

```bash
npm install                 # install dependencies
npm run setup               # generate clean .env → encrypt secrets + login.md
npm run setup:check         # verify setup setelah selesai
npm run health:check        # pastikan MCP server siap
```

> **Setup error?** Cek [TROUBLESHOOTING.md](TROUBLESHOOTING.md) untuk 10 error paling umum + solusinya.

---

## Konfigurasi MCP di IDE

| Server              | Fungsi                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright`        | Eksplorasi UI (`browser_navigate`, `browser_snapshot`)                                                                                                                              |
| `playwright-test`   | Menjalankan tes (`run_tests`)                                                                                                                                                       |
| `qa-playwright-kit` | Requirement, validasi, coverage map (`list_requirement_status`), kegagalan, ringkasan, archive, `snapshot_page`, `discover_pages`, `synthesize_requirement`, `generate_page_object` |

**Hermes:** `.mcp.json` di root project dibaca langsung oleh Hermes. Tidak perlu generate config tambahan. `npm run mcp:config` sudah support multi-platform (claude/cursor/kiro) tapi tidak di-surface ke QA di alur default.

**Cursor / Kiro / VS Code + Copilot (advanced, bukan alur default):** Settings → MCP → pastikan ketiga server connected.

**Playwright profile:** set `PLAYWRIGHT_CONFIG` di `config/environments/{APP_ENV}.env` (default `playwright.config.ts`). Cek env aktif: `npm run env:status`. Setelah mengubah env, restart MCP server di IDE.

---

## Playwright CLI vs MCP (Generator)

- **playwright-cli** (preferred): token-efficient, attach via `npx playwright test --debug=cli tests/seed.spec.ts` lalu `npx playwright-cli attach tw-XXXX`. Replay langkah skenario dengan `snapshot`, `click`, `fill`, `press`, lalu pakai output TS sebagai basis spec. Jangan `open`/`goto` URL mentah — selalu attach lewat seed test agar bootstrap auth/fixture tetap benar.
- **playwright MCP**: fallback exploratory/healing — `browser_snapshot`, `browser_click`, dll. via server `playwright`.

Instal CLI: `npx playwright-cli --help` (pastikan command tersedia sebelum generate tes halaman baru).

---

## Fitur Resmi Playwright yang Dipakai Framework

Helper tipis di `src/support/pw/` membungkus API resmi (bukan abstraksi berat):

| Kebutuhan                     | Tag skenario                            | Helper / API                                                                                                      |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Mock HTTP / error API         | `(@network)` / `#network`               | `mockJson`, `mockServerError`, `unmockAll` → `page.route`                                                         |
| Live payload + response       | `(@network-assert)` / `#network-assert` | `waitAndAssertApi` (prefer), `waitForApi`, `assertNetworkMatch` / `assertNetworkContract`, `startNetworkRecorder` |
| Seed data via API + assert UI | `(@hybrid)` / `#hybrid`                 | `apiSeed`, `apiCleanup` + fixture `request`                                                                       |
| Struktur accessibility        | `(@aria)` / `#aria`                     | `expectAriaMatchesCatalog` → `toMatchAriaSnapshot`                                                                |
| Visual regression             | `(@visual)` / `#visual`                 | `expectVisual` → `toHaveScreenshot`                                                                               |
| Download file                 | `(@download)` / `#download`             | `downloadAndSave`, `assertDownloadedEnvelope` → `page.waitForEvent('download')`                                   |
| Upload file (fixture-first)   | `(@upload)` / `#upload`                 | `uploadFixture`, `uploadViaChooser` → `setInputFiles` / filechooser                                               |
| PDF teks / Excel header       | `(@file-content)` / `#file-content`     | `assertPdfContains`, `extractPdfText`, `assertExcelHeaders`, `readExcelSummary`                                   |
| Multi-field validation        | `(@failure)` multi-error                | `expect.soft` / `expectSoftFieldErrors`                                                                           |
| Time-sensitive UI             | date/countdown                          | `freezeTime` / `advanceTime` → `page.clock`                                                                       |
| Multi-role projects           | Role scope                              | `buildRoleProjects` + recipe `playwright.role-projects.recipe.ts`                                                 |

Semua helper di atas diimpor dari `@/support/pw` (lihat `src/support/pw/files.ts` + `file-content-core.ts` untuk file).

**File / fixture rules:**

- Upload **selalu** fixture-first dari `tests/data/` — **bukan** `@manual`, **bukan** headed OS picker pause.
- Needle PDF / header Excel **milik skenario** (Hasil yang Diharapkan / Input Data) — jangan hardcode skema domain (judul/kode/nama tetap).
- MCP inspect-time: `inspect_file`, `extract_pdf_text`, `read_excel_summary`, `list_test_fixtures`. Test committed tetap assert lewat helper, bukan memanggil MCP di runtime.
- Demo file capabilities: `tests/demo/demo-file-capabilities.spec.ts` (`npx playwright test tests/demo/demo-file-capabilities.spec.ts --project=demo`)
- Demo network assert: `tests/demo/demo-network-assert.spec.ts` (`npx playwright test tests/demo/demo-network-assert.spec.ts --project=demo`)

**Validator capability:** `npm run validate` gagal jika file memakai tag `@network`/`@network-assert`/`@hybrid`/`@aria`/`@visual`/`@download`/`@upload`/`@file-content` tanpa API terkait.

**Visual baselines:**

```bash
npx playwright test --update-snapshots tests/demo/demo-pw-power-extended.spec.ts
```

> Catatan: `tests/demo/demo-visual.spec.ts` tidak ada di repo — contoh visual ada di `demo-pw-power-extended.spec.ts` (folder `-snapshots/` berisi baseline PNG).

Jangan update snapshot hanya untuk menutupi product bug.

**Service Worker + mock/network events:** jika `page.route` atau `waitForApi` tidak menangkap request, set `test.use({ serviceWorkers: 'block' })`.

Demo self-contained:

```bash
npx playwright test tests/demo/demo-pw-power.spec.ts --project=demo
npx playwright test tests/demo/demo-pw-power-extended.spec.ts --project=demo
npx playwright test tests/demo/demo-network-assert.spec.ts --project=demo
npm run test:network-assert
```

Contoh requirement login per challenge mode:

- Tanpa challenge: `requirements/auth/login-none.md`
- OTP browser: `requirements/auth/login-otp-browser.md`
- OTP terminal: `requirements/auth/login-otp-stdin.md`
- CAPTCHA browser: `requirements/auth/login-captcha-browser.md`
- Auto-detect: `requirements/auth/login-auto.md`

CI shard merge: set `PW_BLOB=1` (nightly; PR e2e saat `shardCount` > 1) → `artifacts/blob-report/` → `npx playwright merge-reports`.

---

## Alur kerja QA

Pipeline mengikuti kontrak di [AGENTS.md](../AGENTS.md):

1. `health_check` (qa-playwright-kit)
2. `validate_requirement` — atau CLI: `npm run validate:requirement`
3. Planner → `specs/*-test-plan.md` (dengan kolom Role, Auth Context, Type)
4. Generator → `tests/*.spec.ts` (satu file per role jika role-aware)
5. `validate_generated_tests` — atau CLI: `npm run validate`
6. `run_tests` (playwright-test)
7. Jika gagal: `get_test_failures` → Healer → `run_tests` (scoped)
8. `get_test_summary` → Reporter → `archive_report`

---

## Validasi Format

Sebelum jalankan pipeline AI, cek format requirement:

```bash
npm run validate:requirement
```

- `status: success` → lanjut pipeline
- `error` → perbaiki dulu (lihat Troubleshooting)
- `warn` → bisa lanjut, tapi review saran perbaikan

Warning baru yang mungkin muncul setelah upgrade:

| Warning                        | Artinya                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `role_scope_recommended`       | Auth authenticated tapi tidak ada Role scope — pertimbangkan isi         |
| `access_expectation_missing`   | Role scope diisi tapi Access expectation belum ada                       |
| `failure_scenario_recommended` | Ada kata gagal/error di requirement tapi tidak ada `(@failure)` scenario |
| `layer_recommended`            | Skenario tanpa `Layer terdampak` — isi FE/BE/DB/API untuk triage SOURCE  |

---

## Walkthrough: Setup awal (real project)

**Setelah wizard — website kamu:**

```bash
npm run setup
# wizard menulis requirements/login.md sesuai AUTH_CHALLENGE_MODE
# lalu print prompt Hermes siap-paste

npm run qa:run
# atau paste prompt yang sudah dicetak wizard
```

OTP/CAPTCHA: `npm run auth:setup` / `auth:setup:headed` dulu, baru pipeline.

Catalog mode (bukan target app): `requirements/auth/login-<none|auto|otp-browser|otp-stdin|captcha-browser>.md`.

---

## Prompt Siap Pakai

Ganti `requirements/nama-fitur.md` dengan file Anda.

### Validasi format saja

```
Validasi requirements/nama-fitur.md menggunakan tool validate_requirement di server qa-playwright-kit.
Jika ada error severity, perbaiki file requirement lalu validasi ulang.
Jangan jalankan pipeline — hanya validasi dan perbaikan format.
```

### Pipeline lengkap

```
Jalankan pipeline lengkap untuk requirements/nama-fitur.md sesuai kontrak AGENTS.md:

1. Pre-flight dan validasi requirement; berhenti jika ada error.
2. Buat test plan di specs/nama-fitur-test-plan.md (dengan kolom Role, Auth Context, Type).
3. Jika requirement punya Role scope, buat satu file spec per role di tests/<fitur>-<role>.spec.ts.
4. Generate spec Playwright memakai ./fixtures atau @/public.
5. Validasi generated tests sebelum eksekusi.
6. Jalankan tests lewat playwright-test.
7. Jika gagal, ambil failure dari JSON hasil run aktif, heal, validasi ulang, lalu re-run scoped.
8. Buat pipeline report dan archive ke artifacts/reports/archive/<runId>/.
9. Return summary akhir dan unresolved failures jika ada.

Untuk situs publik, boleh gunakan discover_pages/snapshot_page agar selector-catalog bisa dipakai ulang.
```

### Role-aware pipeline

```
Jalankan pipeline untuk requirements/nama-fitur.md — fitur ini role-aware.
Roles in scope: [tulis role, misal: super-admin, finance, hrd].

1. Validasi requirement; pastikan Role scope dan Access expectation sudah ada.
2. Planner buat scenario per role dengan kolom Role dan Auth Context.
3. Generator buat satu file per role: tests/<fitur>-<role>.spec.ts
   - Gunakan `test.use({ storageState: authStatePath('<role>') })` atau `.auth/{APP_ENV}/<role>.json` per file.
4. Jalankan semua role files, atau filter dengan: roleFilter: ["<role>"].
5. Report mencakup summaryByRole per role.
6. Archive report setelah selesai.
```

### Plan saja

```
Plan test scenarios dari requirements/nama-fitur.md:

1. validate_requirement (qa-playwright-kit)
2. parse_requirement_scenarios + normalize_requirements (qa-playwright-kit)
3. Tulis specs/nama-fitur-test-plan.md dengan kolom: Scenario Name | Steps | Expected Result | Role | Auth Context | Type
4. Tambah section Coverage Gap untuk scenario yang tidak bisa diplankan.

Jangan generate kode tes — hanya test plan.
```

### Generate saja

```
Generate Playwright tests dari specs/nama-fitur-test-plan.md:

1. Baca kolom Role dan Auth Context per scenario.
2. Jika role-aware, buat satu file per role (tests/<fitur>-<role>.spec.ts).
3. Untuk halaman baru: live verification via playwright-cli (preferred) atau browser_* MCP tools.
   Untuk halaman di selector-catalog: cek apakah `tests/pages/<PomName>.ts` sudah ada.
   - Ada → import via fixture, gunakan langsung.
   - Belum ada → jalankan `generate_page_object` (qa-playwright-kit) untuk scaffold otomatis, lalu QA register di project.fixture.ts.
   - Tidak ada catalog → `snapshot_page` dulu, baru `generate_page_object`.
4. Tulis file di tests/ (kebab-case .spec.ts, import ./fixtures).
5. Scenario (@access-restriction): assert penolakan akses — redirect, error message, atau elemen tidak ada.
6. Scenario (@failure): assert pesan error atau state validasi gagal.
7. Scenario (@manual): test.skip(true, 'Manual: <alasan>').
8. validate_generated_tests (qa-playwright-kit).
```

### Heal saja

```
Heal kegagalan tes:

1. get_test_failures (qa-playwright-kit) dari JSON hasil run aktif.
2. Klasifikasikan failure source: app | test | requirement | env | ai_generation.
3. Perbaiki file spec yang gagal di tests/ (gunakan tracePath/screenshotPath jika ada).
4. validate_generated_tests (qa-playwright-kit).
5. run_tests (playwright-test) hanya untuk file yang diperbaiki.
```

### Snapshot saja

```
Snapshot halaman https://staging.app/login lalu simpan ke artifacts/selector-catalog/login/login-form:

1. snapshot_page (qa-playwright-kit) — url, featureName=login, pageName=login-form
2. Baca file artifacts/selector-catalog/login/login-form.json untuk lihat daftar selector
3. Jika perlu crawl banyak halaman, pakai discover_pages sebagai gantinya
```

### Snapshot + Generate POM scaffold (Path B)

```
Buat POM scaffold dari halaman https://staging.app/login:

1. snapshot_page (qa-playwright-kit) — url, featureName=login, pageName=login-form
2. generate_page_object (qa-playwright-kit) — featureName=login, pageName=login-form
   → Hasilkan tests/pages/LoginForm.ts (scaffold, tidak overwrite file yang sudah ada)
3. QA review scaffold: rename locator, tambah goto(), tambah business methods (doLogin dll)
4. Register POM di tests/fixtures.ts atau src/fixtures/project.fixture.ts
5. Tambah "POM yang dibutuhkan: LoginForm" di requirement
6. Jalankan pipeline normal — Generator akan import LoginForm otomatis
```

---

## Kamus Istilah

| Untuk QA (Bahasa Indonesia) | Nama di framework                                       |
| --------------------------- | ------------------------------------------------------- |
| Dokumen kebutuhan           | `requirements/*.md`                                     |
| Test plan                   | `specs/*-test-plan.md`                                  |
| Kode tes                    | `tests/**/*.spec.ts`                                    |
| Tes per role                | `tests/<fitur>-<role>.spec.ts`                          |
| Auth state per role         | `.auth/{APP_ENV}/<role>.json` (helper: `authStatePath`) |
| Katalog selector            | `artifacts/selector-catalog/<fitur>/<halaman>.json`     |
| Scaffold POM                | `tests/pages/<NamaHalaman>.ts`                          |
| Daftarkan POM               | `tests/fixtures.ts` / `src/fixtures/project.fixture.ts` |
| Server QA custom            | `qa-playwright-kit`                                     |
| Cek kesehatan               | tool `health_check`                                     |
| Validasi format             | `validate_requirement` / `npm run validate:requirement` |
| Validasi kode tes           | `npm run validate`                                      |
| Arsip laporan               | `archive_report` / `artifacts/reports/archive/<runId>/` |
| Agent perencana             | Planner                                                 |
| Agent penulis tes           | Generator                                               |
| Agent perbaikan             | Healer                                                  |
| Agent pelapor               | Reporter                                                |
| Koordinator pipeline        | Orchestrator                                            |
| Maintainer framework        | Tim yang maintain `tools/mcp/`, CI, parser              |

---

## Troubleshooting `validate_requirement`

| Rule                           | Severity | Perbaikan                                                                           |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------- |
| `title_required`               | error    | Tambah baris `# REQ-01: Judul Fitur`                                                |
| `content_required`             | error    | Tambah bullet di `## Kriteria Penerimaan` atau skenario `###`                       |
| `scenario_structure`           | error    | Setiap `###` wajib punya `**Langkah:**` dan `**Hasil:**`                            |
| `observable_result`            | warn     | Hasil harus menyebut URL, teks, atau visibility                                     |
| `precondition_recommended`     | warn     | Tambah `**Prekondisi:**` untuk skenario auth-sensitive                              |
| `manual_reason`                | warn     | Skenario `(@manual)` perlu alasan jelas di Hasil                                    |
| `role_scope_recommended`       | warn     | Auth authenticated + fitur multi-role → tambah `Role scope` di Metadata             |
| `access_expectation_missing`   | warn     | `Role scope` sudah diisi tapi `Access expectation` belum ada                        |
| `failure_scenario_recommended` | warn     | Ada kata gagal/error tapi tidak ada skenario `(@failure)`                           |
| `layer_recommended`            | warn     | Skenario tanpa `**Layer terdampak:**` (FE/BE/DB/API) — SOURCE dashboard kurang info |

Detail tool dan pipeline: [AGENTS.md](../AGENTS.md).

---

## Troubleshooting `health_check`

| Check             | Status    | Perbaikan                                              |
| ----------------- | --------- | ------------------------------------------------------ |
| `node`            | fail      | Install Node.js >= 20.19.0                             |
| `mcp_build`       | fail      | `npm run mcp:build`                                    |
| `playwright_mcp`  | fail      | `npm install`                                          |
| `playwright_test` | warn/fail | Upgrade `@playwright/test` >= 1.56                     |
| `environment`     | fail/warn | Buat `config/environments/{APP_ENV}.env` dari template |
| `base_url`        | warn      | Set `BASE_URL` di file env                             |
| `auth_storage`    | warn      | `.auth/{APP_ENV}/` kosong — `npm run auth:setup`       |
| `json_results`    | warn      | Normal sebelum tes pertama — jalankan `npm test`       |

---

## Troubleshooting `validate_generated_tests`

| Rule              | Perbaikan                                                                 |
| ----------------- | ------------------------------------------------------------------------- |
| Import rule       | Pakai `import { test } from '@/fixtures/base.fixture'`                    |
| Describe rule     | Bungkus tes dalam `test.describe(...)`                                    |
| Step rule         | Gunakan `test.step(...)` per aksi                                         |
| Traceability rule | Tambah header `// spec:` dan `// seed:` (wajib untuk tes hasil Generator) |

Tes legacy (login, smoke, seed, demo) exempt via `tools/mcp/src/tools/validate-generated-tests.ts`.

---

## Troubleshooting MCP merah di IDE

1. `npm run mcp:build` — wajib setelah clone atau setelah update MCP tools
2. Cek [`.mcp.json`](../.mcp.json) sebagai source-of-truth project MCP config
3. Hermes: reload MCP servers / restart Hermes
4. Cursor/Kiro: Settings → MCP → restart server; pastikan ketiga server connected

---

## Environment: Active target (`APP_ENV`)

| Variable                   | Fungsi                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **`APP_ENV`**              | **Satu-satunya nama paten** — selector file `config/environments/{name}.env` (`local` \| `dev` \| `staging` \| `production`) |
| `BASE_URL`                 | URL aplikasi                                                                                                                 |
| `TEST_USER_*` / `{ROLE}_*` | Kredensial                                                                                                                   |
| `PLAYWRIGHT_CONFIG`        | Path config Playwright                                                                                                       |

`ENV_NAME` **tidak dipakai lagi** sebagai konsep. Kalau masih muncul di file lama, diabaikan. Kode yang masih baca `env.ENV_NAME` mendapat **read-only alias** ke `APP_ENV` (deprecated).

### Switch environment (lokal)

```bash
npm run env:use:dev             # pin config/environments/.active-env
npm run env:status              # lihat APP_ENV + source=pin|os|default
APP_ENV=staging npm test        # one-shot override (mengalahkan pin)
```

CI mengabaikan pin (`CI=true`). Setelah `env:use`, restart MCP servers.

**Ganti password / tambah role:** `npm run env:edit` — lihat **[CREDENTIALS.md](CREDENTIALS.md)**.

---

## Batasan Normal (Bukan Bug)

- **Halaman baru** tanpa POM → Generator pakai inline locators dari selector-catalog. POM opsional — lihat [Path A vs Path B](WRITING-REQUIREMENTS.md#path-a-vs-path-b-kapan-pakai-pom).
- **`(@manual)`** → tes di-skip otomatis (CAPTCHA, email nyata, biometric).
- **Healer** → menggunakan prioritization berbasis pattern; tidak ada cap arbitrer.
- **Role auth file** → `.auth/{APP_ENV}/<role>.json` harus dibuat dulu via `npm run auth:setup`.
- **Environment** → tiap QA pakai file `config/environments/{APP_ENV}.env` sendiri (BASE_URL + kredensial per env).
- **Selector catalog** → di-cache per-hash. `snapshot_page` skip re-capture kalau UI tidak berubah — aman di-run berulang.

---

## Kapan Eskalasi ke Maintainer Framework

Hubungi maintainer framework jika:

- `npm run setup:check` gagal setelah ikuti panduan ini
- `npm run mcp:build` gagal dengan error TypeScript
- Property tests (`npm run test:property`) gagal tanpa ada perubahan di kode QA
- Ada perilaku aneh di pipeline yang tidak tercakup troubleshooting di atas

---

## Branch Protection (Maintainer)

- Required check PR: workflow **Quality Gate** (`quality.yml`)
- E2E (`e2e.yml`): push main / manual — butuh secrets: `BASE_URL`, `TEST_USER_EMAIL`, `TEST_USER_USERNAME`, `TEST_USER_PASSWORD`, `TEST_USER_PHONE`
