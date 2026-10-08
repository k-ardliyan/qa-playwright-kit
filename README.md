<div align="center">

# QA Playwright Kit

### Tulis apa yang harus dites. Biarkan AI yang mengetes.

**QA menulis _apa_ yang harus dites. Framework mengerjakan *bagaimana*nya — di browser sungguhan, dengan bukti.**

Markdown requirement → test plan → Playwright test → triage dashboard

Diorkestrasi [Hermes Agent](https://hermes-agent.nousresearch.com/docs) · 28 MCP tools · quality-gated CI

[![Quality Gate](https://img.shields.io/badge/quality%20gate-3%20lane-2E86AB?style=flat-square&logo=githubactions&logoColor=white)](.github/workflows/quality.yml) [![Tests](https://img.shields.io/badge/tests-1039%20unit%20%C2%B7%2026%20property-45ba4b?style=flat-square&logo=playwright&logoColor=white)](#kualitas-bukan-janji) [![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org) [![Playwright](https://img.shields.io/badge/playwright-1.64+-45ba4b?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev) [![TypeScript](https://img.shields.io/badge/typescript-5.9+-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.32+-A23B72?style=flat-square&logo=protocol&logoColor=white)](https://modelcontextprotocol.io) [![Version](https://img.shields.io/badge/version-0.2.0--alpha.1-2E86AB?style=flat-square&logo=git&logoColor=white)](https://github.com/k-ardliyan/qa-playwright-kit/releases) [![License](https://img.shields.io/badge/license-MIT-2E86AB?style=flat-square)](LICENSE)

</div>

---

> **Masalahnya:** QA menulis test manual, menjalankan manual, copy-paste hasil ke spreadsheet, dan berdoa tidak ada yang terlewat.
>
> **Solusinya:** Tulis requirement dalam Markdown biasa. Agen AI mengeksplorasi aplikasi secara nyata, memodelkan alur, menantang asumsi, membuat test Playwright, menjalankannya di browser sungguhan, memperbaiki yang gagal, dan melaporkan hasilnya sebagai dashboard triage siap-keputusan.

```text
01 Explore  →  02 Model  →  03 Challenge  →  04 Generate  →  05 Validate
(App answers)   (Shared model)   (The gate)      (Fourth, not first)  (Earned trust)
```

**Untuk siapa?** QA engineer / product owner yang ingin cakupan test nyata tanpa menulis Playwright dari nol — dan tim engineering yang ingin pipeline test yang bisa diaudit, bukan kotak hitam.

---

## Kenapa framework ini?

|                   | Sebelum (manual)                  | Sesudah (QA Playwright Kit)                                       |
| ----------------- | --------------------------------- | ----------------------------------------------------------------- |
| **Menulis test**  | Playwright spec dari nol          | Tulis requirement Markdown, AI generate spec                      |
| **Menjalankan**   | Klik Run, lihat terminal          | `npm run qa:workflow` — Explore→Model→Challenge→Generate→Validate |
| **Test gagal**    | Debug manual, cek locator         | AI healer: diagnosis → fix spec → re-snapshot → rerun             |
| **Melihat hasil** | Scroll terminal, tebak yang merah | Dashboard triage: filter by role/module/priority                  |
| **Multi-role**    | Copy test, ganti storageState     | Requirement metadata → spec terpisah otomatis per role            |
| **Bukti**         | "Kayaknya sudah jalan"            | Evidence gate: test tak boleh mengklaim bukti yang tak dimiliki   |

---

## Yang kamu dapatkan

|                       | Fitur                                                    | Apa artinya                                                                                                                                                             |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evidence-driven**   | Explore → Model → Challenge → Generate → Validate        | AI amati app, uji asumsi, baru buat test                                                                                                                                |
| **Requirement-first** | QA tulis Markdown, AI generate test                      | Tidak perlu tahu Playwright API untuk menulis test                                                                                                                      |
| **Evidence gate**     | Plan & spec divalidasi terhadap bukti nyata              | Skenario tanpa katalog selector → Coverage Gap, bukan test palsu. `captureActualResult` harus bacaan UI nyata                                                           |
| **Seed graph**        | `config/qa-kit.seeds.json` + `withSeededData` / `seeded` | Data CRUD dibangun berurutan (parent→child), dibersihkan terbalik, hanya ID milik run itu                                                                               |
| **Self-healing**      | Test gagal → AI diagnosis → fix spec → rerun             | AI (Healer) memperbaiki lewat MCP (`get_test_failures`, `record_ai_note`); routing + cap re-entry 3 pass di-enforce runtime (perbaikan tetap ditulis agent di `tests/`) |
| **Dashboard triage**  | Tabel + accordion, filter by role/module                 | Tidak perlu scroll 500 bar terminal                                                                                                                                     |
| **Multi-role auth**   | Role-based storage + OTP/CAPTCHA assist                  | Admin, user, finance — semua terotomasi                                                                                                                                 |
| **28 MCP tools**      | Validate, compile, snapshot, seed graph, notes           | Terintegrasi penuh dengan AI agent                                                                                                                                      |
| **Multi-environment** | local/staging/production via `APP_ENV`                   | Switch environment tanpa ubah kode                                                                                                                                      |
| **Quality gates**     | format/lint/typecheck/unit/property/contract             | Tidak ada yang lolos tanpa diuji                                                                                                                                        |
| **Encrypted creds**   | dotenvx after setup — secret keys only (`*_PASSWORD`)    | URL/flag tetap plaintext; env file gitignored                                                                                                                           |

---

## Cara kerja

```text
01. Explore ──────► 02. Model ──────► 03. Challenge ──────► 04. Generate ──────► 05. Validate
(Playwright MCP)   (Req Contract)     (QA Gate)         (PW Automation)     (Exec / Heal / Report)
       ▲                                                                               │
       └───────────────────────── LEARN ◄─── REFINE ◄─── RE-EXPLORE ──────────────────┘
```

> **Alur Metodologi:** Explore the app. Model the flow. Challenge the assumptions. Generate the test. Validate the trust.
> Diorkestrasi oleh **Hermes Agent** via sub-agent spesialis — lihat [AGENTS.md](AGENTS.md).

---

## Quick Start

```bash
git clone https://github.com/k-ardliyan/qa-playwright-kit.git
cd qa-playwright-kit
npm install
npm run setup                 # generate clean .env → encrypt secrets
```

**Buktikan install-mu hidup — tanpa perlu app/kredensial asli:**

```bash
# Suite demo publik (playwright.dev) → artifacts/reports/custom-dashboard.html
npm run test:demo
npm run dashboard             # buka dashboard interaktif, lihat hasilnya
```

**Jalankan pipeline di app-mu** (setelah kredensial diisi di `config/environments/{APP_ENV}.env`):

```bash
npm run qa:run                # preflight + pilih requirement + prompt Hermes
npm run qa:workflow           # pipeline semantic penuh via driver produksi
                              # tanpa AI agent: ikuti nextRequiredAction saat jeda di Generate, lalu resume
```

> `npm test` butuh kredensial valid (project setup melakukan login sungguhan). Sebelum itu, pakai `npm run test:demo`.
>
> **Archive gate:** `APPROVE` hanya sah bila `analysisVerdict=complete`, `analysisVerified=true`, `analysis.completed=true`, jumlah insight persis cocok dengan bukti sidecar, insight Reporter tersedia, dan tidak ada unresolved failures. Detail → [docs/REPORT-GUIDE.md](docs/REPORT-GUIDE.md).

---

## Requirement format

```bash
cp requirements/_TEMPLATE.md requirements/fitur-saya.md
```

```markdown
# REQ-001: Login dengan Email Valid

## Metadata

| Field        | Nilai           |
| ------------ | --------------- |
| Tags         | #smoke #ui      |
| Prioritas    | high            |
| Auth state   | unauthenticated |
| Halaman awal | /login          |
| Module       | auth            |
| Feature      | login-valid     |

## Kriteria Penerimaan

| ID    | Kriteria                                                    |
| ----- | ----------------------------------------------------------- |
| AC-01 | URL berubah ke /dashboard setelah login berhasil.           |
| AC-02 | Toast "Welcome" muncul setelah login berhasil.              |
| AC-03 | Password salah menampilkan pesan error dan tetap di /login. |

## Skenario Uji

### SC-01: Login berhasil (@success)

| Field                 | Nilai                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Test ID               | `TC-001`                                                           |
| Covers                | `AC-01`, `AC-02`                                                   |
| Prioritas skenario    | `high`                                                             |
| Layer terdampak       | `FE`                                                               |
| Input Data            | email: credential:user.email<br>password: credential:user.password |
| Langkah               | 1. Isi email valid + password benar<br>2. Klik tombol Login        |
| Hasil yang Diharapkan | URL /dashboard, Toast "Welcome" muncul                             |

### SC-02: Login gagal (@failure)

| Field                 | Nilai                                                               |
| --------------------- | ------------------------------------------------------------------- |
| Test ID               | `TC-002`                                                            |
| Covers                | `AC-03`                                                             |
| Prioritas skenario    | `high`                                                              |
| Layer terdampak       | `FE`                                                                |
| Input Data            | email: credential:user.email<br>password: literal:WrongPassword123! |
| Langkah               | 1. Isi email valid + password salah<br>2. Klik tombol Login         |
| Hasil yang Diharapkan | Pesan error "Email atau password salah", tetap di /login            |
```

> Contoh di atas adalah bentuk ringkas yang lolos validator (fitur login — tanpa CRUD,
> jadi tanpa `## Data Targets` / `## Relationships`). Kontrak lengkap (Access Matrix,
> Prekondisi, Data Targets, Relationships, checklist pra-simpan) ada di
> [requirements/\_TEMPLATE.md](requirements/_TEMPLATE.md).

Validasi: `npm run validate:requirement`

Bentuk kanonik: [requirements/\_TEMPLATE.md](requirements/_TEMPLATE.md) · [specs/\_TEMPLATE.md](specs/_TEMPLATE.md)

---

## Kualitas bukan janji

Framework ini menegakkan klaimnya sendiri — dan menolak klaim yang tidak bisa dibuktikan.

| Gate                       | Yang dijaga                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Evidence gate**          | Skenario `automated` wajib punya katalog selector; tanpa bukti → Coverage Gap (`PLAN_EVIDENCE_MISSING`) |
| **Test-evidence boundary** | Spec tak boleh menyamar UI test dengan `fetch`/`request.*` mentah atau token `.auth` (AST gate)         |
| **Archive gate**           | `APPROVE` butuh analisis berbasis bukti yang cocok dengan sidecar — tidak ada hijau palsu               |
| **Re-entry cap**           | Maks 3 pass heal per target; pass ke-4 di-blok (`LOOP_LIMIT_REACHED`), butuh keputusan QA               |
| **Doctrine stamp**         | Setiap spec di-stamp versi instruksi generator (`// doctrine: doctrine/v2`)                             |

CI berjalan 3 lane (fast / Windows / full) — format, lint, typecheck, unit 1039, property 26, contract,
dashboard-browser, dan harness upgrade. Lihat [.github/workflows/quality.yml](.github/workflows/quality.yml).

---

<details>
<summary><b>🏷️ Scenario tags</b></summary>

<br/>

| Tag                     | Kapan Dipakai                                              |
| ----------------------- | ---------------------------------------------------------- |
| `(@success)`            | Happy path — alur normal berhasil                          |
| `(@failure)`            | Negative path — validasi gagal                             |
| `(@access-restriction)` | Role tidak berhak, akses ditolak                           |
| `(@manual)`             | Tidak bisa diotomasi (CAPTCHA, OTP, layout PDF)            |
| `(@network)`            | Mock request/response                                      |
| `(@network-assert)`     | Live observe/assert payload + response                     |
| `(@upload)`             | Upload file via fixture (bukan OS picker)                  |
| `(@download)`           | Download file via fixture                                  |
| `(@file-content)`       | Assert isi PDF teks / file download                        |
| `(@aria)`               | Accessibility snapshot                                     |
| `(@visual)`             | Visual regression (`toHaveScreenshot`)                     |
| `(@hybrid)`             | Seed data via API + assert UI (`Evidence Mode: hybrid-ui`) |

Tags bisa digabung: `(@failure @network-assert)` · `(@success @download @file-content)`

Panduan lengkap: [docs/MANUAL-SCENARIOS.md](docs/MANUAL-SCENARIOS.md)

</details>

---

<details>
<summary><b>⌨️ Commands</b></summary>

<br/>

### Daily Flow

| Command                        | Fungsi                                                               |
| ------------------------------ | -------------------------------------------------------------------- |
| `npm run qa:run`               | Preflight + pilih requirement + prompt Hermes (bukan executor lokal) |
| `npm run qa:workflow`          | Pipeline semantic penuh (Explore→Model→Challenge→Generate→Validate)  |
| `npm run validate:requirement` | Validasi format (TTY pilih file)                                     |
| `npm run auth:setup`           | Refresh session login                                                |
| `npm run auth:setup:headed`    | Session + OTP/CAPTCHA di browser                                     |
| `npm run env:edit`             | Ganti password / role / OTP mode                                     |

### Discovery & Setup

| Command                       | Fungsi                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run setup`               | Setup interaktif (recommended)                                                                                           |
| `npm run setup:check`         | Verifikasi setup lokal                                                                                                   |
| `npm run upgrade`             | Update framework dari upstream (WIP QA tak perlu di-commit; snapshot otomatis; `--commit` = commit otomatis saat bersih) |
| `npm run upgrade:check`       | Preview update tanpa mengubah file                                                                                       |
| `npm run health:check`        | Cek MCP + env (sesi expired = warning)                                                                                   |
| `npm run health:check:strict` | Pre-flight pra-run (sesi expired = gagal)                                                                                |
| `npm run mcp:config`          | Generate MCP config semua platform                                                                                       |

### Test & Quality

| Command                 | Fungsi                               |
| ----------------------- | ------------------------------------ |
| `npm test`              | Jalankan semua test                  |
| `npm run test:demo`     | Suite demo publik (tanpa kredensial) |
| `npm run test:smoke`    | Smoke test saja                      |
| `npm run test:quality`  | Gate lengkap sebelum push            |
| `npm run test:unit`     | Unit tests (1039)                    |
| `npm run test:property` | Property tests (26)                  |
| `npm run test:contract` | Golden contract CI                   |
| `npm run manual:check`  | List scenario `(@manual)`            |
| `npm run mcp:check`     | Cek kompatibilitas MCP               |

</details>

---

<details>
<summary><b>🏗️ Architecture</b></summary>

<br/>

```text
qa-playwright-kit/
├─ requirements/        Input requirement QA (Indonesian & English)
├─ specs/               Test plan output (AI Planner)
├─ tests/               Playwright Test Workspace
├─ artifacts/           Consolidated runtime output
├─ src/                 Framework Core Engine
├─ tools/               Maintainer tooling, scripts, validators & MCP server
├─ config/              Environment credentials & Playwright configs
├─ docs/                Operational & architectural documentation
```

Detail peta folder & boundary: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

</details>

---

<details>
<summary><b>🔌 MCP Servers</b></summary>

<br/>

| Server                  | Fungsi Utama                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------ |
| **`qa-playwright-kit`** | Requirement parsing, validation, coverage, seed graph, POM, health, failure analysis |
| **`playwright-test`**   | Run dan debug test                                                                   |
| **`playwright`**        | Browser interaction, eksplorasi UI                                                   |

```bash
npm run mcp:build          # build custom QA server
npm run mcp:config         # generate config semua platform (claude/cursor/kiro)
```

</details>

---

<details>
<summary><b>👥 Role-Based Testing</b></summary>

<br/>

Tambahkan metadata role di requirement — `Role scope` di Metadata, lalu tabel `Access Matrix`:

```markdown
## Metadata

| Field      | Nilai                  |
| ---------- | ---------------------- |
| Role scope | `super-admin, finance` |

## Access Matrix

| Role        | Access | Expectation                        |
| ----------- | ------ | ---------------------------------- |
| super-admin | allow  | Bisa approve                       |
| finance     | allow  | Bisa approve                       |
| hrd         | deny   | Tidak bisa membuka halaman finance |
```

Generator otomatis membuat file test flat terpisah per role (`tests/<feature>-<role>.spec.ts`) dengan storage state sesuai dari `.auth/{APP_ENV}/`. Nested spec paths hanya kompatibilitas workspace lama jika `trace_requirement` masih dapat mencocokkan basename.

Multi-role auth + OTP/CAPTCHA → [docs/AUTH-CONTEXT-CONVENTION.md](docs/AUTH-CONTEXT-CONVENTION.md)

</details>

---

<details>
<summary><b>🛠️ Tech Stack</b></summary>

<br/>

| Layer         | Tools                                                  |
| ------------- | ------------------------------------------------------ |
| **Runtime**   | Node.js >= 20.19 · TypeScript 5.9+                     |
| **Testing**   | Playwright 1.64+ · MCP SDK 1.32+                       |
| **AI Agent**  | Hermes Agent · Claude                                  |
| **Security**  | dotenvx after setup (secret keys only, not whole file) |
| **CI/CD**     | GitHub Actions · Husky (pre-commit)                    |
| **Reporting** | Custom HTML Dashboard (triage table + accordion)       |

</details>

---

<details>
<summary><b>📚 Dokumentasi</b></summary>

<br/>

| Saya ingin...                      | Buka                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| Panduan QA & setup                 | [docs/GUIDE.md](docs/GUIDE.md)                                     |
| Menulis requirement valid          | [docs/WRITING-REQUIREMENTS.md](docs/WRITING-REQUIREMENTS.md)       |
| Auth per role + OTP/CAPTCHA        | [docs/AUTH-CONTEXT-CONVENTION.md](docs/AUTH-CONTEXT-CONVENTION.md) |
| Kredensial & multi-role            | [docs/CREDENTIALS.md](docs/CREDENTIALS.md)                         |
| Dashboard triage guide & report    | [docs/REPORT-GUIDE.md](docs/REPORT-GUIDE.md)                       |
| Skenario `(@manual)`               | [docs/MANUAL-SCENARIOS.md](docs/MANUAL-SCENARIOS.md)               |
| Command cheat sheet                | [docs/CHEATSHEET.md](docs/CHEATSHEET.md)                           |
| Troubleshooting                    | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)                 |
| Alur upgrade framework (flowchart) | [docs/UPGRADE-FLOW.md](docs/UPGRADE-FLOW.md)                       |
| Agent git safety (deny destruktif) | [docs/AGENT-GIT-SAFETY.md](docs/AGENT-GIT-SAFETY.md)               |
| Arsitektur & Folder Map            | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                       |
| Domain glossary & roles            | [docs/CONTEXT.md](docs/CONTEXT.md)                                 |
| Riwayat perubahan                  | [CHANGELOG.md](CHANGELOG.md)                                       |
| Pipeline agent contract            | [AGENTS.md](AGENTS.md)                                             |

</details>

---

## Kontribusi

Kontribusi welcome! Untuk perubahan besar:

1. Buka issue dulu — diskusikan perubahan
2. Buat branch dari `main` (`feat/...`, `fix/...`, `docs/...`)
3. Jalankan `npm run test:quality` sebelum push
4. Update changelog & dokumentasi relevan

Panduan lengkap (setup lingkungan, konvensi commit, batas arsitektur) ada di
[CONTRIBUTING.md](CONTRIBUTING.md). Lisensi: [MIT](LICENSE).

---

<div align="center">

QA Playwright Kit · [github.com/k-ardliyan/qa-playwright-kit](https://github.com/k-ardliyan/qa-playwright-kit)

</div>
