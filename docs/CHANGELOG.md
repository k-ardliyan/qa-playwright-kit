# Changelog

All notable changes to QA Playwright Kit are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Per-test QA Notes & AI Notes di Report — 2026-09-06

- **Kolom AI NOTES (ke-13) & catatan QA editable di dashboard Table View:** kolom NOTES kini memuat chip scenarioId, **CATATAN QA** (free-text, diedit QA via tombol ✎ yang membuka **dialog Catatan QA** — tersimpan via API di serve mode `npm run dashboard`, dialog menyalin perintah CLI di mode file://), durasi, thumbnail screenshot, link video/trace, dan badge layer. Kolom baru **AI NOTES** berisi catatan AI 2 lapis untuk QA/programmer: auto-deterministik (di-bake custom reporter ke `testCases[].aiNotes` di `test-summary.json` dengan tag `Jenis:` — untuk gagal: "Jenis: Root Cause — Analisa: …", "Diduga penyebab: …", "Gagal konsisten di N attempt"; untuk passed: "Jenis: Stability — Flaky: …", "Jenis: Test Quality — Tidak ada assertion (expect) terdeteksi (false-green risk)", deteksi durasi lambat relatif median run, pengingat actual-result kosong) + naratif agent dengan badge sumber `[healer]`/`[generator]`/`[reporter]`/`[analyzer]` — **tidak hanya untuk error**: saran UI/UX, perbandingan flow A vs B, dan tips data juga ditulis pada scenario passed.
- **Sidecar `artifacts/reports/test-notes.json` (schema `qa.test-notes/v1`):** catatan disimpan per-run dengan key `<scenarioId>::<role>` (fallback `testId`, role `general`) dan field `qaNotes`/`aiNotes`/`qaUpdatedAt`/`aiUpdatedAt` + `runId` run pemilik. Saat run di-save ke history (`archive:save` / tombol Save dashboard / MCP `archive_report`) sidecar ikut disalin ke `artifacts/reports/archive/<runId>/test-notes.json` lalu sidecar latest di-reset — run baru mulai bersih. Catatan run terarsip permanen dan tetap bisa diedit (dialog Catatan QA / API).
- **MCP tools baru (total 25):** `record_ai_note` {`message` **atau** field terstruktur (`kind`, `observation`, `evidence`, `impact`, `recommendation`, `nextAction`, `priority`, `confidence`, `status: observed|inferred|recommendation`) yang dirender dalam **format insight kanonik**, `scope?: test|run`, `scenarioId?`, `testId?`, `role?`, `source?`, `runId?`} — additive; `set_test_note` {`note` wajib (string kosong menghapus), `scenarioId?`, `testId?`, `role?`, `runId?`}. Tanpa `runId` → latest run; dengan `runId` → run terarsip. Taxonomy `Jenis` + guardrails AI didokumentasikan di `skills/qa-playwright-kit/references/ai-insight-format.md`.
- **AI Run Insights (panel overview):** halaman `/` menampilkan panel pola lintas skenario — deterministik dari `test-summary.json → aiInsights` (modul/role dengan failure terbanyak, test flaky, pola error berulang via error fingerprint, flow paling lambat vs rata-rata, cluster test passed tanpa assertion, skipped coverage) + **trend lintas-run** (regresi vs run arsip sebelumnya, failure berulang, penurunan pass rate ≥10%) + naratif agent dari sidecar `runInsights` (`record_ai_note` `scope: "run"`). Detail run terarsip juga menampilkan panel ini.
- **Hardening notes (P0/P1):** secret **redaction otomatis** di semua jalur tulis (Bearer/JWT/`password=/token=/api_key=`/cookie/AWS key → `[REDACTED]`); **deduplication/idempotency** (insight identik dari source yang sama tidak disimpan dua kali — aman retry agent); fix **double source prefix** (`composeInsightText` kini body-only, prefix dimiliki storage layer); **alias role `user` ↔ `general`** (konvensi generator general-mode `user` kini kompatibel dengan writer yang menghilangkan role); **runId stamp di API dashboard** (note dari run A tidak bisa bocor ke run B — sidecar tanpa identitas dianggap stale); enum MCP **ditolak eksplisit** (`INVALID_ENUM`), **provenance guard** (source harus cocok dengan profile aktif healer/reporter/generator); `record_ai_note` kini tersedia untuk **profile generator** (insight skeleton/blocked/data gap); **Analyze sub-phase wajib** di Phase 5 (`Execute → Heal → Analyze → Report`); `get_test_summary` kini me-merge sidecar (qaNotes/aiNotes) + expose `aiInsights`, `runInsights`, dan `archiveRunId` (kontrak runId canonical); failure insight membawa **bukti** (error fingerprint + ketersediaan trace/screenshot); wording deteksi assertion lebih hati-hati (helper assertion diakui bisa tak terlihat); unit tests XSS rendering, redaction, dedupe, alias role, dan lifecycle stale-sidecar.
- **Hardening notes round 2 (P0/P1):** **pending pipeline run identity** (`.pending-run.json`, TTL 24 jam) — dibuat saat pipeline start (`Orchestrator.run`) & `pipeline_status` pada state `running`, di-adopsi reporter onEnd sebagai canonical id lalu di-clear; catatan Generator/Plan kini **selamat** dari stale-sidecar reset; resolver identitas dipakai semua writer (MCP, dashboard, CLI); **lock mencakup seluruh transaksi read-modify-write** (`withNotesWrite`: lock → read → mutate → temp+rename → release, timeout via `QA_NOTES_LOCK_TIMEOUT_MS`, stale lock >5s di-break); **semua reader alias-aware** (`noteKeyCandidates`, termasuk `normalizeTestCases` dashboard); detail run terarsip menggabungkan `summary.aiInsights` + sidecar `runInsights`; **`kind` divalidasi sebagai enum canonical** (`INVALID_KIND` untuk nilai di luar taxonomy) + metadata **`affectedTests/affectedModules/affectedRoles`** pada run insight (terekspos di schema & tersimpan di sidecar); **kontrak runtime Analyze**: `PipelineReport.analysis` (`completed`, `runInsightsRecorded`, `passedScenariosReviewed`, `skippedForInsufficientEvidence`) — report tanpa `completed: true` dianggap tidak lengkap; `get_test_summary` expose `pipelineRunId`; tests baru: pending-run lifecycle, stale-lock break, RMW tanpa lost update, handler MCP (enum/provenance/affected), XSS rendering.
- **Hardening notes round 3 (P0 review-4):** **`analysis` kini mengalir sampai report final** — `BuildReportInput.analysis`, `buildReport()` selalu menghasilkan `analysis` (default `{ completed: false }` bila Analyze tidak terbukti), section **"## AI Analysis"** baru di `pipeline-report-<runId>.md` dengan peringatan eksplisit saat Analyze tidak terbukti; helper **`isAnalysisComplete()`** untuk konsumen; **`archive_report` menandai** report tanpa Analyze (`analysisComplete: false` + WARNING di pesan — arsip tetap terjadi, tidak diblokir); **lock timeout tidak lagi force-remove lock aktif** — gagal dengan error `NOTES_LOCK_TIMEOUT` (force-acquire justru membuka kembali lost update); **batasan single-active-pipeline per workspace dinyatakan eksplisit** (dokumentasi run-context & REPORT-GUIDE); metadata **`affected` tampil di panel** AI Run Insights (chip jumlah test + module + role) dan tipe domain; contract test baru: catatan Generator selamat sampai adopsi+cleanup marker.
- **Analyze quality gate (final, review-5):** **verifikasi evidence** — `archive_report` mencocokkan `analysis.runInsightsRecorded` dengan jumlah run insight di sidecar arsip, dan memvalidasi `passedScenariosReviewed` tidak melebihi jumlah test passed (mismatch → `analysisVerified: false` + WARNING); **hard gate APPROVE** — `archive_report` **menolak** `qaDecision: APPROVE` saat `analysis.completed !== true` (error `ANALYSIS_INCOMPLETE`, keputusan non-APPROVE tetap diarsipkan); **badge AI Analysis di detail run terarsip** (✓ completed / ⚠ incomplete) agar report tanpa Analyze langsung terlihat QA; docs konsisten — Analyze resmi sebagai **sub-phase WAJIB dari Report** (`Execute → Heal → Report(Analyze)`), bukan phase pipeline terpisah; tests: `verifyAnalysisEvidence` (match/mismatch/missing/tolerant), default `analysis` di buildReport, section markdown complete+incomplete.
- **Unified archive gate + strict APPROVE (final, review-6):** gate Analyze **disatukan di ketiga jalur arsip** (MCP `archive_report`, dashboard Save to History, CLI `archive:save`) lewat modul `analysis-gate.ts` (src) + twin MCP — verdict dihitung **sebelum tulis apa pun** sehingga penolakan tidak meninggalkan arsip parsial; verdict 5-status (`complete / incomplete / inconsistent / unverifiable / not-applicable`): **APPROVE hanya saat `complete`** — missing declaration + tanpa agent run insight → `ANALYSIS_UNVERIFIABLE`, over-claim count → `ANALYSIS_EVIDENCE_MISMATCH`, missing sidecar evidence **strict** untuk APPROVE; jalur tanpa requirement (plain run) tidak digate; **verifikasi deklarasi vs sidecar**: `runInsightsRecorded` tidak boleh melebihi jumlah run insight, `passedScenariosReviewed` tidak boleh melebihi passed test; **lint + xss:scan kembali hijau** (unused variable & unused `safe` attribute diperbaiki — precompose string chip); **parity test src ↔ MCP twin** (6 kasus verdict identik) + unit tests `saveLatestRun` gate (reject/success/non-APPROVE/plain run); metadata `affected` tampil sebagai chips di panel AI Run Insights.
- **API dashboard baru:** `GET`/`POST /api/notes/latest` (alias `/api/runs/latest/notes`) dan `GET`/`POST /api/archive/<runId>/notes` (alias `/api/runs/<runId>/notes`). POST body `{scenarioId | testId, role?, qaNotes}` — `qaNotes` string ≤4000 char, string kosong = hapus. SSE event baru `notes-updated`.
- **CLI baru:** `npm run note:set -- --scenario=SC-03 [--role=finance] [--test-id=TC-X] --note="teks"` (`--note=""` untuk hapus; `--run=run-…` untuk run terarsip) dan `npm run note:list [--run=run-…]`.
- **Export:** TSV/CSV/Confluence kini menyertakan kolom `AI NOTES` (setelah NOTES); catatan QA ikut di kolom NOTES dengan prefix `QA:` — tetap respect row filter + Filter columns.
- **Detail views:** accordion TestDetail, detail run terarsip, dan expandable row detail arsip menampilkan section "Catatan" (Catatan QA + Catatan AI).
- **Unit tests:** `tool-registry.test.ts` + fixture `registry-contract.json`/`tool-argument-inventory.json` diperbarui untuk surface registry 25 tool.
- **Dokumentasi:** `docs/REPORT-GUIDE.md` (kolom NOTES/AI NOTES, field `qaNotes`/`aiNotes` di `CollectedTestCase`, subsection "Catatan per Test", changelog dashboard v0.4.0) dan `docs/CHEATSHEET.md` (command `note:set`/`note:list`, catatan triage per test).

### Toolchain hybrid Biome + ESLint (Prettier dihapus) — 2026-09-05

- **Biome 2.5.12 menggantikan Prettier** sebagai formatter + core linter; ESLint 10 dipersempit khusus aturan spec Playwright via `eslint.playwright.config.mjs` (typescript-eslint parser + `eslint-plugin-playwright`, hanya `tests/**/*.spec.ts` & `examples/**/*.spec.ts`) — toolchain hybrid.
- **Script baru `lint:playwright` / `lint:playwright:fix`:** ESLint hanya untuk spec Playwright. `lint` = `biome lint .` + `lint:playwright`; `lint:fix` = padanannya dengan `--write`/`--fix`.
- **`format` / `format:check` kini memakai Biome:** `format` = `biome format --write .` + `format:markdown` — markdown tetap ditangani script kustom (Biome tidak mendukung format Markdown, plugin-nya pun lint-only).
- **Script `tools/scripts/format-markdown.ts` (rename dari `format-markdown-tables.ts`, script `format:tables` → `format:markdown`):** formatter markdown lengkap — align tabel markdown, normalisasi heading ATX (`#Title` → `# Title`, strip closing `##`), bullet `*`/`+` → `-`, ordered list `)` → `.`, collapse baris kosong berlebih, blank line konsisten di sekeliling heading/tabel/code fence, EOF newline tunggal. Hard-break dua spasi dipreservasi, isi fenced code block tidak tersentuh. Plus mode `--check` (dipakai `format:check` sehingga gate kini juga memvalidasi markdown), dukungan argumen path file/direktori untuk run ter-target, skip direktori AI-state lokal (`.zcode`, `.hermes`), dan pelestarian EOL (`\r\n`/`\n`).
- **lint-staged (husky pre-commit):** `biome check --write --no-errors-on-unmatched` untuk file kode ter-stage + `eslint --config eslint.playwright.config.mjs --fix` untuk spec Playwright ter-stage + `format-markdown.ts` untuk `.md` ter-stage.
- **Dihapus:** `.prettierrc`, `.prettierignore`, `eslint.config.mjs`, dan dependensi `prettier`. `typecheck` (`tsc --noEmit`) tidak berubah — Biome tidak menggantikan TypeScript compiler.

### MCP hardening, `pipeline_status` tool & docs sinkronisasi — 2026-09-03

- **Tool baru `pipeline_status`:** orientasi satu panggilan — fase pipeline saat ini, resume safety, staleness requirement (via `computeSourceHash`), missing artifacts, dan hasil run terakhir. Terdaftar read-only, diekspos ke profil `planner`/`reporter`/`all`.
- **Hardening write path MCP:** `synthesize_requirement` kini memvalidasi `outputPath` via `resolveAllowedPath('requirements')` dan `generate_page_object` ke `tests/pages/` — blokir path traversal, `_TEMPLATE`/README, dan path di luar repo. HTTP server dibatasi bind loopback + body size limit.
- **Report dir resolver konsisten:** `report-builder.ts` tidak lagi hardcode `reports/` — memakai kontrak resolver yang sama dengan `state.ts` (`QA_REPORT_DIR` → `artifacts/reports/`). Markdown pipeline report kini selalu mendarat di lokasi yang dijanjikan `qa:run` dan wizard (`artifacts/reports/pipeline-report-<runId>.md`).
- **Dokumentasi:** README 21→23 MCP tools, AGENTS.md melengkapi `generate_page_object`, CHEATSHEET & GUIDE menambah `pipeline_status`, reporter.agent.md & docs arsip memakai path canonical `artifacts/reports/`.
- **Unit tests baru** (`mcp-hardening.test.ts`): registry profile, parsing state, dan penolakan out-of-bounds output; test synthesize disesuaikan menulis di dalam repo sesuai guard baru.

### Per-role login & redirect paths — 2026-09-02

- **Per-Role Login & Redirect Flow:** `promptRoleCredentials` di wizard kini menyatukan input kredensial, path halaman login (`{ROLE}_LOGIN_URL_PATH`, default `/login`), dan path redirect sukses (`{ROLE}_SUCCESS_URL_PATH`, default `/dashboard`) dalam satu konteks per-role. `BASE_URL` terpisah murni sebagai host server.
- **Dynamic Multi-Role Setup:** Setup wizard menerima daftar role kustom apa pun (`admin,guru,murid`, `buyer,seller`, dll.) tanpa menyisipkan role `user` siluman jika tidak didefinisikan.
- **Auth Setup Per-Role:** `src/support/auth.setup.ts` men-generate blok otentikasi per-role yang membaca path login & redirect milik masing-masing role secara terisolasi (`process.env.${envPrefix}_LOGIN_URL_PATH` dan `process.env.${envPrefix}_SUCCESS_URL_PATH`).
- **`env:edit` Per-Role Paths:** Aksi edit role dan tambah role di `npm run env:edit` kini menyertakan input path login & redirect per role.

### Login & success redirect paths, one-shot Hermes prompt & setup overhaul — 2026-09-02

- **Prompt login & redirect di wizard (Opsi C):** Step 3 wizard kini menanyakan path halaman login (`AUTH_LOGIN_URL_PATH`, default `/login`) dan path redirect setelah login sukses (`AUTH_SUCCESS_URL_PATH`, default `/dashboard`) dengan prefill, validasi leading-slash, dan normalisasi URL-ke-pathname (`normalizeAppPath`). Nilai masuk ke env bersih section "URL Aplikasi", `src/support/auth.setup.ts`, `requirements/login.md`, pratinjau, dan summary.
- **Menu env:edit:** `npm run env:edit` menu "Edit BASE_URL / browser / OTP-CAPTCHA" kini menyertakan field `AUTH_LOGIN_URL_PATH` dan `AUTH_SUCCESS_URL_PATH`; tabel kredensial menampilkan keduanya.
- **Terminal terpisah untuk auth:setup:** setelah summary, jika target reachable, wizard menawarkan membuka terminal baru untuk menjalankan `npm run auth:setup` (atau `:headed`) via `src/setup/terminal.ts` — session `.auth/{APP_ENV}/` bisa langsung dibuat tanpa keluar wizard.
- **One-shot Hermes prompt:** prompt akhir kini dirancang selesai dalam satu instruksi — mulai dari `health_check` (stop jika fail), snapshot locator, Plan → Generate → Execute → Heal, penutup summary lengkap, QA exit decision, dan instruksi penutup menjalankan `npm run dashboard`.
- **Cleanup:** artefak `src/support/auth.setup.ts.bak` dihapus dari repo; `auth.setup.ts` di-regenerate membaca login/redirect path nyata.

### Wizard UX, real verification & robust auth scenarios — 2026-09-02

- **Wizard end-to-end UX:** banner pembuka + ringkasan `6 langkah`, header `[n/6]` per fase (Bahasa → Environment → URL → Kredensial → Challenge → Konfirmasi), section `Menulis file` / `Verifikasi artefak` yang konsisten, pratinjau per-role yang lebih kompak, dan deteksi config existing kini menampilkan state saat ini (BASE_URL, roles + status terenkripsi, challenge) sebelum prompt update/keep.
- **Verifikasi artefak nyata** (`src/setup/verify-setup.ts`): setelah menulis, wizard mengecek **bukan sekadar asumsi** — node_modules, config Playwright, Chromium, file env + BASE_URL, secret ciphertext di disk, keberadaan file kunci dotenvx, **decrypt roundtrip asli** via dotenvx CLI, requirements/login.md, agent skills, MCP configs (.cursor/.kiro/.codex/claude), dan file sesi `.auth/{APP_ENV}/<role>.json`. Check kritis gagal → `npm run setup` exit non-zero.
- **Prompt Hermes akhir diperbaiki:** dicetak sebagai blok bersih (tanpa prefix `>>>` per baris) agar gampang disalin; kini meminta `health_check` sebagai aksi pertama sebelum Plan, dan menambahkan reminder `npm run auth:setup` otomatis ketika requirement terdeteksi punya challenge (OTP/CAPTCHA) — mode dibaca dari `AUTH_CHALLENGE_MODE=` di requirement.
- **Katalog auth lebih robust (`requirements/auth/login-*.md`, 13 → 19 skenario):** tier-3 baru — deep-link protection `(@access-restriction)`, reload session, browser back, double-submit, identifier markup/XSS-safe `(@failure)`, dan logout end-to-end `(@access-restriction)`; AC diperluas ke AC-19 (none) / AC-20 (challenge). Generator katalog kini script resmi: `tools/scripts/gen-login-catalogs.ts`. Skenario challenge `(@manual)` tetap tepat satu di SC-07; semua katalog valid `validate:requirement` 100/100.
- **`EnvWriteResult.warnings`:** warning normalisasi role kini mengalir ke output wizard (bukan `console.warn` di dalam writer).

### Clean generated env files — 2026-09-01

- **Generator, bukan salinan:** `buildEnvFileContent` tidak lagi menyalin `*.env.example` verbatim. Wizard **generate** `{APP_ENV}.env` minimal via `src/utils/env-clean.ts`: hanya key aktif, dikelompokkan per section (URL Aplikasi / Role / Browser / Challenge / Playwright / Lainnya), tanpa komentar placeholder dan tanpa key opsional ter-comment (`# FINANCE_*`, `# AUTH_OTP_*`, dst). `.env.example` tetap dokumentasi ber-komentar.
- **Upsert sadar-komentar:** `upsertEnvContent` kini mengenali `# KEY=...` — nilai di-uncomment-replace di posisinya (tidak lagi di-append di akhir file, duplikat ter-comment dibuang).
- **Banner dotenvx ternormalisasi:** setelah encrypt, box ASCII `#/---/`, komentar `-fk <path>` machine-specific, dan marker `# <filename>` dibuang; baris `DOTENV_PUBLIC_KEY_*` fungsional tetap.
- **Parser dotenv round-trip:** `parseEnvText` membuang inline comment (` # ...`) dan menghormati closing quote — value `DOTENV_PUBLIC_KEY="hex" # -fk <path>` tidak lagi terbaca sebagai hex+path.
- **Urutan wizard diperbaiki:** APP_ENV final ditentukan **sekali** (`--env` > prompt dengan default pin/OS) **sebelum** membaca existing config — prefill BASE_URL/roles/challenge dan konfirmasi update tidak lagi bisa tertarget ke file env yang salah; browser check dipindah setelah keputusan update.
- **Loader fail-fast:** file env terenkripsi tanpa private key kini **throw** dengan pesan actionable (restore `~/.dotenvx-keys/<project>/.env.keys` atau `npm run setup`) — tidak lagi diam-diam memuat template placeholder yang membuat test gagal login dengan kredensial dummy.
- **env:edit — aksi "Rapikan file":** rebuild file dari key aktif ke layout bersih (jalur migrasi sekali klik untuk file lama yang masih berantakan).
- **Isolasi dotenvx child:** child `dotenvx` tidak mewarisi nilai env untuk key milik file target (dotenvx mem-merge env di atas file — polusi `process.env` bisa ter-enkripsi ke file atau bocor ke output decrypt). `playwright-mcp-launch` kini memanggil `bootstrapMcpEnvironment` hanya di `main()` — import modul tidak lagi memuat env asli (side-effect import yang pernah mengotori worker test).

### Setup auto-encrypts secrets from .env.example — 2026-09-01

- **Encrypt pairing:** `encryptSecretKeysInFile` no longer injects `DOTENV_PRIVATE_KEY*` into the dotenvx child env (stale inherited keys + newly minted public key caused `DECRYPTION_FAILED` after a successful encrypt). Uses `-fk` against `~/.dotenvx-keys/<project>/.env.keys` when present; restores plaintext if decrypt-verify fails.
- **Writer:** `writeEnvFile` copies `config/environments/{APP_ENV}.env.example` (comments + every template key), upserts wizard values, then encrypts **secret keys only** (`*_PASSWORD` / `*_SECRET` / `*_TOKEN` / `API_KEY`). URL, flags, identifiers stay plaintext — edit the file without `env:edit`.
- **Shared helper:** `src/utils/env-secrets.ts` used by setup **and** `env:edit` (no more whole-file encrypt).
- **No extra command after setup.** `npm run env:edit` remains for later password/role changes.
- **Legacy `environments/` fallback removed.** Canonical path is only `config/environments/`.
- **Dotenv text helpers** moved to `src/utils/env-text.ts` (env:edit re-exports).

### Honesty: setup does not auto-encrypt — 2026-09-01

- **Superseded** by “Setup auto-encrypts secrets from .env.example” (same day). Historical: first honesty pass deleted orphan `tools/validators/setup-check.ts` and stopped docs from claiming whole-file auto-encrypt.

### Login catalogs match AUTH_CHALLENGE_MODE — 2026-09-01

- **Setup writes `requirements/login.md`:** after env write, wizard renders a real login requirement from BASE_URL + roles + `AUTH_CHALLENGE_MODE` and prints a ready-to-paste Hermes prompt (`>>> `). File is gitignored (per-project).
- **Five committed catalogs** under `requirements/auth/login-<mode>.md` matching wizard choices 1:1: `none`, `auto`, `otp-browser`, `otp-stdin`, `captcha-browser`. OTP/CAPTCHA scenarios stay `(@manual)`.
- **Removed format-demo samples:** `sample-login-empty-fields.md`, `sample-network-hybrid.md`, `sample-network-assert.md`. Tests/docs/quality gate retargeted to `login-none.md` (traceability manual case → `login-otp-browser.md`).
- **Steps vs Input Data:** generated login steps are UI actions only (`Buka halaman login`, `Isi field login`). Values stay in `**Input Data:**` (`credential:` / `literal:`). Hermes prompt forbids copying those values into `test.step` titles (dashboard Test Step vs Input Data columns).
- **Login catalogs: negatives first:** empty identifier/password/both → whitespace → malformed format → fictional user, then success (or OTP/CAPTCHA `@manual` last). No wrong-password on a real account (anti-lockout).

### Script de-clutter — 2026-09-01

- **Removed unused npm scripts (no callers in CI, docs, or code):** `test:smart-shard`, `test:failed-only` (core logic still unit-tested via `test:unit`), `manifest:generate` (manifest still generated at build/runtime; `agent-manifest.json` remains gitignored), duplicate `dashboard:serve` (identical to `dashboard`). 64 → 60 scripts.

### Harden 8.5 — 2026-08-26

- **Dead wizard removed:** unused `tools/scripts/setup-wizard.ts` deleted. Canonical entry remains `src/setup/index.ts` (`npm run setup`). `wizard-auth-template.ts` kept (used by `env:edit`).
- **CLI rename:** `npm run setup:wizard` → `npm run setup`. `setup:check` unchanged. No alias.
- **Contract SoT:** `src/contracts/` is canonical; `tools/mcp/src/contracts/` is AUTO-SYNCED via `npm run sync:mcp-generated` (`--check` in quality gate). `CoverageStateBreakdown` ported onto `qa.traceability/v1` as optional fields.
- **CI summary truth:** quality/mcp-compat workflow summaries no longer hardcode stale unit/property counts.

### Setup Wizard — 2026-08-24

- **Setup wizard fixes:** `--env` honored in interactive mode; single `checkReachable`/`isReachableStatus` predicate (304 included on both sides); encrypted (dotenvx `encrypted:`) values no longer leak into prompts/validation — `setup:check` reports `Encrypted roles` instead of false "ready"/fake "unreachable"; password confirm + `isPlaceholderCredential` rejection at prompt; preview (masked `p***t`) + confirm before write; `HEADLESS` managed for all challenge modes (symmetric `true`/`false`); `resolveEnvPath` deduped into `wizard-writer.ts`. New: `src/__tests__/unit/wizard.test.ts` (reachability + `isEncryptedValue`).
- **Setup wizard UX (type-then-Enter):** numeric selectors (`APP_ENV`, challenge mode, login-id) switched from auto-submit-on-keypress `select` to type-then-Enter `text` via `parseNumberedChoice` (trim, leading zeros, bounds 1..N; empty/out-of-range/decimals rejected). Prompt text is now Bahasa Indonesia for a lay-user audience.
- **Setup wizard UX (simplified credentials):** per-role flow collapsed from 3 yes/no + 3 optional fields + optional pref to **1 method pick (Email/Username/Phone) → fill value → password + confirm**. Fewer prompts, no redundant confirm taps; pre-fills existing loginIdPref→email→username→phone.

### Documentation Parity Follow-up — 2026-08-22 (audit round 2)

- **CUSTOM-MCP.md contract truth:** corrected output schemas for `compile_requirement` (`requirementId`/`roles`/`title`/`expectations`/`automation`), `compile_test_plan` (`actions`/`assertions[{description,provenance}]`/`executionMode`, no `id`), `validate_plan` (nested `data` with `plannedScenarios`/`coverageGapsCount`), and `trace_requirement` (no `testPlanPath` arg; metrics `totalAcs`/`coveredAcs`/`healedScenarios`/…). Added missing `generate_page_object` section (was registered but undocumented). Marked `normalize_requirements`/`parse_requirement_scenarios`/`validate_requirement` as `compat` (replacement `compile_requirement`). Corrected `discover_pages` claims (no login-redirect auto-detection; checkpoint is status log, no resume logic) and `get_test_failures` default dir (`test-results/`).
- **Phantom paths removed:** `scripts/setup-wizard.ts` (TROUBLESHOOTING), `scripts/check-env-health.ts` (ENVIRONMENT-GUIDE → now points to `health:check`/`env:status`), `scripts/sync-init-agents.sh/.ps1` (MAINTENANCE → manual `npx playwright init-agents`), `qa-playwright-kit-CORE-FREEZE-RC-PROMPT-STUDIO-PREP.md` (PROMPT-STUDIO boundary → DECISIONS D-13).
- **Invalid commands fixed:** `npx playwright auth.setup` → `npm run auth:setup` (ENVIRONMENT-GUIDE); removed `npm run dev:backend`, `DEBUG_MODE`/`_option_browserClose` config snippet, `.env.local` naming, `RATE_LIMIT_ENABLED`; TROUBLESHOOTING "TypeScript 6.x" → `^5.9.3`.
- **Historical symbol drift fixed:** DECISIONS `networkMock` → `mockJson`/`unmockAll` and `validate_test_plan` → `validate_plan`; MIGRATION-GUIDE `EPHEMERAL_LOCATOR_LEAK`/`ROLE_MISMATCH` → `PLAN_EPHEMERAL_REF_DETECTED`/`PLAN_ROLE_DRIFT`; an earlier MAINTENANCE TAGS example was corrected to remove `SECURITY`; `TRACEABILITY_EXEMPT` → `TRACEABILITY_EXEMPT_PREFIXES_STATIC`/`_FILES`.
- **Wizard truth:** GETTING-STARTED/README/FORK-ONBOARDING/requirements-README now describe the actual `src/setup/index.ts` wizard (6 steps, env file only — no browser install, no auth setup, no auto-encrypt, no `requirements/login.md` generation).
- **Report paths:** pipeline-report is `reports/pipeline-report-<runId>.md` (no artifacts mirror) — POST-PIPELINE/REPORT-GUIDE corrected; archive path clarified as `artifacts/reports/archive/<runId>/`; testId fallback description corrected (TC- pattern only); serve-mode multi-page documented.
- **Contracts docs:** DIAGNOSTICS.md completed (13 missing codes incl. `TRACE_HEURISTIC_LINK_USED`, `PIPELINE_STATE_STALE`, `INVALID_INPUT`); TRACEABILITY-MODEL metrics/JSON/args aligned with `tools/mcp/src/contracts/traceability-contract.ts`; TRACEABILITY-CONTRACT.md rewritten to full contract; TEST-PLAN-CONTRACT.md added `CoverageGap`/`CatalogEvidence`.
- **Template & parser:** `_TEMPLATE.md`/WRITING-REQUIREMENTS `- **Actor:**` → `- **Role:**` (parser reads `Role:`); Feature severity "Wajib" → "Disarankan" (validator warn); default scenario type note (`general`, not `success`); `manual-check.ts` now also reads `**Hasil yang Diharapkan:**` label.
- **Misc:** DIRECTORY-MAP observability entry → `error-classifier.ts`/`metrics-collector.ts`; LESSONS-LEARNED path `src/tests/` → `tests/`; GUIDE link casing + `demo-visual.spec.ts` → `demo-pw-power-extended.spec.ts`; README `examples/` line removed; CREDENTIALS env path canonical; deck sharing HTML: dashboard paths → `artifacts/reports/`, wizard "enkripsi otomatis" → `env:edit` terpisah, Feature "wajib" → "disarankan" (angka 76 alat MCP dipertahankan — sesuai `mcp:check`/capability manifest).

### Core Freeze v1 — 2026-08-21

- **MCP Runtime Profile Enforcement (RC-1)**
  - Enforced active tool profiles (`planner`, `generator`, `healer`, `reporter`, `discovery`, `admin`, `all`) at runtime.
  - Dynamic `ListTools` filtering and strict profile authorization during tool dispatch (`MCP_TOOL_NOT_ALLOWED_FOR_PROFILE`).
  - Added unit test suite for profile filtering, unauthorized invocation blocking, and configuration resolution.
- **Traceability Convergence (RC-2)**
  - Prioritized exact identifier linkage (`testId` -> `scenarioId` -> `requirementId` -> heuristic fallback).
  - Emitted `TRACE_HEURISTIC_LINK_USED` diagnostic with reason and confidence score for fallback matching.
  - Integrated 4D coverage state model (`design`, `automation`, `execution`, `verification`) across scenario nodes and root contract.
  - Enforced strict AC coverage rules: non-executed / planned tests never marked as `covered`.
  - Reused shared failure classifier for structured root cause attribution (`app`, `test`, `env`, `ai_generation`, `unknown`).
- **Contract CI Closure (RC-3)**
  - Resolved npm script drift in `package.json` for `validate:test-plan` and `test:mcp-profiles`.
  - Enforced offline contract suite guarantee across all schema validators and golden contract fixtures.
  - Added golden fixtures for stale plans, invalid AC plans, unexecuted traces, and profile snapshots.
- **Documentation Parity (RC-4)**
  - Synchronized `README.md`, `CUSTOM-MCP.md`, and agent guidance documents with canonical tool names and 21 registered tools.
  - Eliminated legacy paths across documentation (`test-fixtures/`, `mcp-server/`, un-prefixed `selector-catalog/`).
  - **Doc sync follow-up (audit 2026-08-22):**
    - Restored missing npm scripts referenced by docs: `auth:setup:headed` (headed OTP/CAPTCHA session via `--headed`), `mcp:config` (new CLI `tools/scripts/mcp-config.ts` wrapping `mcp-config-generator`, supports `--platform=` and `--check` with exit 2 drift convention), `manifest:generate` (wraps `writeManifest`).
    - Fixed `.vscode/mcp.json` launcher path (`scripts/playwright-mcp-launch.ts` → `tools/scripts/playwright-mcp-launch.ts`) and added `.kiro/` to `.gitignore` (generated by `mcp:config`).
    - **Historical cleanup:** removed ghost commands from active README/CHEATSHEET guidance (`snapshot:page`, `discover:pages`, `test:headed`, `validate:agents`, `preview-dashboard.ts`); active command tables now use real npm scripts.
    - **Historical cleanup:** replaced the old `npx tsx scripts/preview-dashboard.ts` guidance; the current dashboard command is `npm run dashboard`.
    - Fixed broken link `docs/AUTH-CONT-CONVENTION.md` → `docs/AUTH-CONTEXT-CONVENTION.md` and dead `REQUIREMENT-CONTRACT.md` reference (now points to `src/contracts/requirement-contract.ts`).
    - Updated `MCP-CURRENT-STATE.md` / `MCP-MIGRATION-GUIDE.md` from stale `0.0.78` to `0.0.79` and corrected bootstrap path (`tools/mcp/src/utils/mcp-env-bootstrap.ts`).
  - **Example adapter removal & de-ERPku-ing (audit 2026-08-22):**
    - Removed `examples/erpku/` entirely (docs, POMs, adapter env overlay). Adapter seam tetap ada via `PLAYWRIGHT_ADAPTER_*` env dengan default sentinel `adapter-tests/` (tidak match spec apa pun) — `isAdapterSpecPath`/`getAdapterTestRoot`/`getAdapterConfigPath`/`getAdapterFixtureImport`/`getAdapterJsonResultsPath` default tidak lagi menunjuk ke path ERPKU.
    - Removed ERPKU adapter overlay dari `mcp-env-bootstrap.ts` (path `example/erpku/` singular ternyata salah selama ini — ghost path).
    - Removed `@erpku/*` alias dari `tsconfig.json`; updated property tests (`playwright-paths`, `get-test-failures`, `custom-reporter`) ke adapter-neutral fixtures.
    - Removed unused `image-size` dependency (+ lockfile).
    - Cleaned docs (`CUSTOM-MCP.md` env table, `CONTEXT.md`, `DIRECTORY-MAP.md`, `FORK-ONBOARDING.md`, `GUIDE.md`, `MAINTENANCE.md`, `.github/agents/planner.agent.md`, `AUTH-CONTEXT-CONVENTION.md`) from `examples/erpku` / `test:erpku-example` / `generate-mcp-config.ts` claims.
  - **Documentation consolidation & cleanup (audit 2026-08-22):**
    - Fixed CI bug: `nightly-e2e.yml` memanggil `playwright.cross-browser.config.ts` (tidak ada) → `config/playwright/cross-browser.ts` (config asli).
    - Removed orphaned/stale planning & task docs: `docs/architecture/HYBRID-MIGRATION-PLAN.md` (4.4k baris execution-plan selesai), `MCP-UPGRADE-CHECKLIST.md`, `INTENT-PROFILES.md` (duplikat CUSTOM-MCP), `HEALER-TAXONOMY.md` (terwakili reporter.agent + POST-PIPELINE), `docs/engineering/*` (MCP-CURRENT-STATE + MCP-MIGRATION-GUIDE — snapshot tugas selesai), `docs/HARNESS.md` (0 referensi, konten duplikat GUIDE/README qa:run), `docs/WRITING-TEST-PLANS.md` (0 referensi, konten di GUIDE), `.github/agents/orchestrator.agent.md` (stub → root AGENTS.md).
    - Merged `docs/TRACEABILITY.md` + `docs/contracts/COVERAGE-MODEL.md` → `docs/contracts/TRACEABILITY-MODEL.md` (konsep traceability + coverage 4D satu file).
    - Removed last ERPKU reference in `config/environments/local.env.example`.
    - Fixed `docs/recipes/README.md` broken link ke `FORK-ONBOARDING.md` (salah depth + anchor).
    - Full-repo markdown link scan: **0 broken links** dari 63 file `.md` (artifacts/ di-exclude).
- **Core Framework Freeze**
  - Formally established `Core Freeze v1` in `docs/architecture/DECISIONS.md` (D-13).
  - Defined Prompt Studio v1 integration boundary and contracts in `docs/architecture/PROMPT-STUDIO-INTEGRATION-BOUNDARY.md`.

## [0.2.0-alpha.1] - 2026-08-21

### Added

- **Hybrid Architecture**
  - Clean separation of concerns: `tests/` (workspace for test specs, POMs, test data, and fixtures), `src/` (protected framework core), `tools/` (maintainer tooling & MCP servers), `config/` (environments and Playwright configurations), and `artifacts/` (test results, reports, and selector catalogs).
  - Explicit Public Testing API boundary at `src/public/` (`fixtures`, `auth`, `metadata`, `workspace`).
  - Architecture and boundary validator (`tools/validators/architecture.ts`) with zero-tolerance enforcement for cross-boundary imports.
- **3-Server MCP Architecture & 19 Custom Tools**
  - Dedicated custom MCP server `qa-playwright-kit` under `tools/mcp/` exposing 19 tools across Preflight, Requirements, Selectors, Test Generation, Fixtures, Execution, and Reporting.
  - Profile-based launcher for Playwright MCP (`tools/scripts/playwright-mcp-launch.ts`) and Playwright Test MCP (`tools/scripts/playwright-test-mcp-launch.ts`).
  - 19 custom tools: `health_check`, `validate_requirement`, `normalize_requirements`, `parse_requirement_scenarios`, `list_requirement_status`, `snapshot_page`, `discover_pages`, `validate_generated_tests`, `generate_page_object`, `list_test_fixtures`, `inspect_file`, `extract_pdf_text`, `read_excel_summary`, `get_test_failures`, `list_artifacts`, `get_test_summary`, and `archive_report`.
- **Capability Helpers & Assertions**
  - Network live assertion (`@network-assert`): `src/support/pw/network-assert-core.ts` and `network-assert.ts`.
  - Document & file content validation (`@file-content`, `@upload`, `@download`): `src/support/pw/file-content-core.ts` and `files.ts` (PDF text & Excel header assertions).
  - Assisted human challenge solver for session bootstrap (OTP / CAPTCHA): `src/support/human-challenge.ts`.
- **Interactive Triage Dashboard v3**
  - Full-width modern layout with Table View and Accordion View.
  - Multi-line Test Step / Input Data, SOURCE root-cause explanation tooltips, dynamic column filtering, Confluence/TSV/CSV exports, and deep evidence inspection.
- **Documentation & Agent Governance**
  - Standardized all documentation files to UPPERCASE naming in `docs/` and `docs/recipes/`.
  - Standardized all markdown table delimiters to 3 hyphens (`| --- | --- |`).
  - Updated agent governance files (`AGENTS.md`, `.github/AGENTS.md`, `.github/agents/*.agent.md`) for canonical paths and tool contracts.

### Changed

- **Dependency Upgrades**
  - `@dotenvx/dotenvx` ^2.17.4 → **^2.21.0**
  - `@playwright/test` ^1.62.0 → **^1.62.1**
  - `playwright` ^1.62.0 → **^1.62.1** & `playwright-core` ^1.62.0 → **^1.62.1**
  - `@modelcontextprotocol/sdk` ^1.29.0 → **^1.30.0**
  - `tsx` ^4.23.1 → **^4.23.12**
  - `eslint` ^10.8.0 → **^10.8.1**
  - `eslint-plugin-playwright` ^2.10.5 → **^2.11.0**
  - `typescript-eslint` ^8.65.0 → **^8.67.0**
  - `lint-staged` ^16.4.0 → **^17.3.0**
  - Pinned `@types/node` at `^20.19.43` and `typescript` at `^5.9.3` / `^6.0.3` to ensure compiler and plugin stability.
- Relocated historical migration plan from root to `docs/architecture/HYBRID-MIGRATION-PLAN.md`.

### Removed

- Removed legacy root and deprecated directory structures (`src/tests/`, `test-fixtures/`, `src/pages/`).
- Removed redundant Jira integration in favor of universal CSV/TSV/Confluence exports.

## [0.1.0-alpha.2] - 2026-06-17

### Added

- Custom dashboard modules under `src/support/custom-dashboard/` with native-like errors, collapsible test steps, screenshots, video, and attachments
- Property tests for custom reporter attachments and Playwright env load order (`playwright-config-env.property.ts`)
- `.nvmrc` for Node 20 LTS workshop setup
- Dedicated Playwright `demo` project and `npm run test:demo` script

### Changed

- Node.js engine requirement lowered to **>= 20.19.0**; downgrade `lint-staged` to 16.x for Node 20 compatibility
- CI workflows and health check aligned to Node 20 LTS; workshop docs updated for Node 20.19+ prerequisite
- `SLOW_MO`, `HEADLESS`, and `BASE_URL` read after `loadEnvironment()`; `slowMo` wired via `launchOptions`
- `npm test` excludes `@demo` via `--grep-invert`; default chromium project ignores `demo/` folder
- Custom dashboard shows all tests in local mode with responsive layout and report-relative attachment paths

### Removed

- Unused placeholder folders `src/tests/e2e/` and `src/tests/api/`

## [0.1.0-alpha.1] - 2026-06-16

### Added

- Generic template core with `project.fixture.ts` seam and `frameworkFixtureExtend`
- Reference Adapter under `example/erpku/` (POMs, auth setup, adapter env overlay)
- MCP adapter path seam (`PLAYWRIGHT_ADAPTER_*`) and Playwright profile bootstrap (#16/#19)
- `createFrameworkReporters()` for Healer JSON gate (#15)
- Alpha workshop docs: `docs/WORKSHOP.md`, `docs/GETTING-STARTED.md`
- ADRs 0001–0003, `docs/FORK-ONBOARDING.md`, `CONTEXT.md`

### Changed

- ERPKU-specific code moved from template core to `example/erpku/`
- `playwright-test` MCP uses profile launcher (`scripts/playwright-test-mcp-launch.ts`)
- CI E2E artifact paths aligned with ERPKU adapter outputs
- `get_test_failures` prefers config-mapped JSON over stale `results.json`
- README Node requirement aligned to >= 22.22.1
- Workshop Path B documented as adapter reference only (no AI generate to adapter root)
- Generator verification sections renamed (CLI vs MCP) to avoid workshop Path A/B confusion

### Known limitations (alpha)

See [GUIDE.md](GUIDE.md).

[Unreleased]: https://github.com/k-ardliyan/qa-playwright-kit/compare/v0.2.0-alpha.1...HEAD
[0.2.0-alpha.1]: https://github.com/k-ardliyan/qa-playwright-kit/releases/tag/v0.2.0-alpha.1
[0.1.0-alpha.2]: https://github.com/k-ardliyan/qa-playwright-kit/releases/tag/v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/k-ardliyan/qa-playwright-kit/releases/tag/v0.1.0-alpha.1
