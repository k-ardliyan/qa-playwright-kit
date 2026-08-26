<div align="center">

# QA Playwright Kit

### Tulis kebutuhan. Biarkan AI yang mengetes.

**QA menulis *apa* yang harus dites. Framework mengerjakan *bagaimana*nya.**

Markdown requirement → test plan → Playwright test → self-heal → dashboard triage.

Diorkestrasi [Hermes Agent](https://hermes-agent.nousresearch.com/docs) · 21 MCP tools · quality-gated CI

[![Version](https://img.shields.io/badge/version-0.2.0--alpha.1-2E86AB?style=flat-square&logo=git&logoColor=white)](https://github.com/k-ardliyan/qa-playwright-kit/releases)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/playwright-1.62+-45ba4b?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5.9+-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.30+-A23B72?style=flat-square&logo=protocol&logoColor=white)](https://modelcontextprotocol.io)

</div>

---

> **Masalahnya:** QA menulis test manual, menjalankan manual, copy-paste hasil ke spreadsheet, dan berdoa tidak ada yang terlewat.
>
> **Solusinya:** Tulis requirement dalam Markdown biasa. Lima agen AI menyusun rencana, membuat test Playwright, menjalankannya di browser sungguhan, memperbaiki yang gagal, dan melaporkan hasilnya sebagai dashboard triage siap-keputusan.

```
📝 requirement  →  📋 test plan  →  ⚡ auto test  →  🔁 self-heal  →  📊 triage dashboard
```

---

## Kenapa framework ini?

| | Sebelum (manual) | Sesudah (QA Playwright Kit) |
|--|--|--|
| **Menulis test** | Playwright spec dari nol | Tulis requirement Markdown, AI generate spec |
| **Menjalankan** | Klik Run, lihat terminal | `npm run qa:run` — satu perintah |
| **Test gagal** | Debug manual, cek locator | Self-heal: AI fix locator → re-snapshot → rerun |
| **Melihat hasil** | Scroll terminal, tebak yang merah | Dashboard triage: filter by role/module/priority |
| **Multi-role** | Copy test, ganti storageState | Requirement metadata → test terpisah otomatis per role |

---

## Yang kamu dapatkan

| | Fitur | Apa artinya |
|--|--|--|
| **Requirement-first** | QA tulis Markdown, AI generate test | Tidak perlu tahu Playwright API untuk menulis test |
| **5-Phase Pipeline** | Plan → Generate → Execute → Heal → Report | Satu perintah, hasil lengkap |
| **Self-healing** | Test gagal → AI fix → re-snapshot → rerun | Locator berubah? Framework memperbaiki sendiri |
| **Dashboard triage** | Tabel + accordion, filter by role/module | Tidak perlu scroll 500 bar terminal |
| **Multi-role auth** | Role-based storage + OTP/CAPTCHA assist | Admin, user, finance — semua terotomasi |
| **21 MCP tools** | Validate, compile, snapshot, POM, health check | Terintegrasi penuh dengan AI agent |
| **Multi-environment** | local/staging/production via `APP_ENV` | Switch environment tanpa ubah kode |
| **Capability tags** | `@upload` `@download` `@file-content` `@network-assert` | Test canggih tanpa boilerplate |
| **Quality gates** | format/lint/typecheck/unit/property/file-content | Tidak ada yang lolos tanpa diuji |
| **Encrypted creds** | dotenvx auto-encrypt + `env:edit` | Kredensial tidak pernah plaintext di repo |

---

## Cara kerja

```
requirements/*.md          QA tulis requirement
       │
       ▼
   AI Planner  ──────►  specs/*-test-plan.md
       │
       ▼
   AI Generator ──────►  tests/*.spec.ts
       │
       ▼
   Execute ──►  Healer  ──►  Reporter
   (run test)  (fix+re-     (custom-dashboard.html)
                snapshot)
       │                        │
       ▼                        ▼
  pass / fail            triage Table/Accordion
```

> Diorkestrasi oleh **Hermes Agent** via 5 sub-agent — lihat [AGENTS.md](AGENTS.md).

---

## Quick Start

```bash
git clone https://github.com/k-ardliyan/qa-playwright-kit.git
cd qa-playwright-kit
npm install
npm run setup                 # setup interaktif 6 langkah
```

**Setelah wizard selesai:**

```bash
# 1) Preflight + validasi + cetak prompt Hermes
npm run qa:run -- requirements/auth/sample-login-empty-fields.md

# 2) Paste prompt ke Hermes Agent
#    Pipeline: snapshot → Plan → Generate → Execute → Heal → Report

# 3) Dashboard terbuka otomatis
npm run qa:run -- requirements/auth/sample-login-empty-fields.md --open-dashboard
```

> Detail pasca-pipeline → [docs/POST-PIPELINE.md](docs/POST-PIPELINE.md)

---

## Requirement format

```bash
cp requirements/_TEMPLATE.md requirements/fitur-saya.md
```

```markdown
# REQ-001: Login dengan Email Valid

## Metadata
- Tags: #smoke #ui
- Prioritas: high
- Auth state: unauthenticated
- Halaman awal: /login

## Kriteria Penerimaan
- URL berubah ke /dashboard setelah login
- Toast "Welcome" muncul

## Skenario Uji

### SC-01: Login berhasil (@success)
1. Isi email valid + password benar
2. Klik tombol Login
**Hasil:** URL /dashboard, Toast "Welcome"

### SC-02: Login gagal (@failure)
1. Isi email valid + password salah
2. Klik tombol Login
**Hasil:** Pesan error "Email atau password salah", tetap di /login
```

Validasi: `npm run validate:requirement -- requirements/fitur-saya.md`

Contoh lengkap: [_GOOD_EXAMPLE.md](requirements/_GOOD_EXAMPLE.md) · [_BAD_EXAMPLE.md](requirements/_BAD_EXAMPLE.md)

---

<details>
<summary><b>🏷️ Scenario tags</b></summary>

<br/>

| Tag                     | Kapan Dipakai                                   |
| ----------------------- | ----------------------------------------------- |
| `(@success)`            | Happy path — alur normal berhasil               |
| `(@failure)`            | Negative path — validasi gagal                  |
| `(@access-restriction)` | Role tidak berhak, akses ditolak                |
| `(@manual)`             | Tidak bisa diotomasi (CAPTCHA, OTP, layout PDF) |
| `(@network)`            | Mock request/response                           |
| `(@network-assert)`     | Live observe/assert payload + response          |
| `(@upload)`             | Upload file via fixture (bukan OS picker)       |
| `(@download)`           | Download file via fixture                       |
| `(@file-content)`       | Assert isi PDF teks / header Excel              |
| `(@aria)`               | Accessibility snapshot                          |
| `(@visual)`             | Visual regression (`toHaveScreenshot`)          |
| `(@hybrid)`             | Gabungan capability tags                        |

Tags bisa digabung: `(@failure @network-assert)` · `(@success @download @file-content)`

Panduan lengkap: [docs/MANUAL-SCENARIOS.md](docs/MANUAL-SCENARIOS.md)

</details>

---

<details>
<summary><b>⌨️ Commands</b></summary>

<br/>

### Daily Flow

| Command                                | Fungsi                                |
| -------------------------------------- | ------------------------------------- |
| `npm run qa:run -- requirements/X.md`  | Preflight + prompt Hermes + dashboard |
| `npm run validate:requirement -- X.md` | Validasi format requirement           |
| `npm run auth:setup`                   | Refresh session login                 |
| `npm run auth:setup:headed`            | Session + OTP/CAPTCHA di browser      |
| `npm run env:edit`                     | Ganti password / role / OTP mode      |

### Discovery & Setup

| Command                | Fungsi                                 |
| ---------------------- | -------------------------------------- |
| `npm run setup`        | Setup interaktif (recommended)         |
| `npm run setup:check`  | Verifikasi setup lokal                 |
| `npm run health:check` | Pre-flight pipeline (env + MCP + auth) |
| `npm run mcp:config`   | Generate MCP config semua platform     |

### Test & Quality

| Command                 | Fungsi                    |
| ----------------------- | ------------------------- |
| `npm test`              | Jalankan semua test       |
| `npm run test:smoke`    | Smoke test saja           |
| `npm run test:quality`  | Gate lengkap sebelum push |
| `npm run test:unit`     | Unit tests                |
| `npm run test:property` | Property tests            |
| `npm run test:contract` | Golden contract CI        |
| `npm run manual:check`  | List scenario `(@manual)` |
| `npm run mcp:check`     | Cek kompatibilitas MCP    |

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

Detail: [docs/architecture/DIRECTORY-MAP.md](docs/architecture/DIRECTORY-MAP.md) · [DECISIONS.md](docs/architecture/DECISIONS.md)

</details>

---

<details>
<summary><b>🔌 MCP Servers</b></summary>

<br/>

| Server                     | Fungsi Utama                                                                   |
| -------------------------- | ------------------------------------------------------------------------------ |
| **`qa-playwright-kit`**    | Requirement parsing, validation, coverage, POM, health check, failure analysis |
| **`playwright-test`**      | Run dan debug test                                                             |
| **`playwright`**           | Browser interaction, eksplorasi UI                                             |

```bash
npm run mcp:build          # build custom QA server
npm run mcp:config         # generate config semua platform (claude/cursor/kiro)
```

21 tool lengkap → [CUSTOM-MCP.md](CUSTOM-MCP.md)

</details>

---

<details>
<summary><b>👥 Role-Based Testing</b></summary>

<br/>

Tambahkan metadata role di requirement:

```markdown
- Role scope: super-admin, finance
- Access expectation:
  - super-admin: bisa approve
  - finance: bisa approve
  - hrd: tidak bisa membuka halaman finance
```

Generator otomatis membuat file test terpisah per role (`<feature>-<role>.spec.ts`) dengan storage state sesuai dari `.auth/{APP_ENV}/`.

Multi-role auth + OTP/CAPTCHA → [AUTH-CONTEXT-CONVENTION.md](docs/AUTH-CONTEXT-CONVENTION.md)

</details>

---

<details>
<summary><b>🧩 Integration Recipes</b></summary>

<br/>

| Recipe                                   | Use Case                                                   |
| ---------------------------------------- | ---------------------------------------------------------- |
| `playwright.config.nextjs-e2e.recipe.ts` | Next.js app under `/e2e` dengan auth setup + `webServer`   |
| `playwright.role-projects.recipe.ts`     | Multi-role via `buildRoleProjects` + `.auth/<role>.json`   |
| `FILE-UPLOAD-DOWNLOAD.md`                | Fixture-first `@upload` / `@download` — no OS picker       |
| `PDF-EXCEL-CONTENT-ASSERT.md`            | `@file-content` PDF text / Excel headers                   |
| `NETWORK-ASSERT.md`                      | `@network-assert` live payload/response — partial contract |
| `MULTI-SESSION-SYNC.md`                  | Dual `browser.newContext` admin↔user data sync             |

Semua → [docs/recipes/README.md](docs/recipes/README.md)

</details>

---

<details>
<summary><b>🛠️ Tech Stack</b></summary>

<br/>

| Layer       | Tools                                                                          |
| ----------- | ------------------------------------------------------------------------------ |
| **Runtime** | Node.js >= 20.19 · TypeScript 5.9+                                           |
| **Testing** | Playwright 1.62+ · MCP SDK 1.30+                                             |
| **AI Agent**| Hermes Agent · Claude                                                          |
| **Security**| dotenvx (auto-encrypt)                                                        |
| **CI/CD**   | GitHub Actions · Husky (pre-commit)                                           |
| **Reporting**| Custom HTML Dashboard (triage table + accordion)                              |

</details>

---

<details>
<summary><b>📚 Dokumentasi</b></summary>

<br/>

| Saya ingin...                       | Buka                                                               |
| ----------------------------------- | ------------------------------------------------------------------ |
| Setup QA pertama kali               | [docs/GUIDE.md](docs/GUIDE.md)                                     |
| Panduan pemula step-by-step         | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)                 |
| Menulis requirement valid           | [docs/WRITING-REQUIREMENTS.md](docs/WRITING-REQUIREMENTS.md)       |
| Auth per role + OTP/CAPTCHA         | [docs/AUTH-CONTEXT-CONVENTION.md](docs/AUTH-CONTEXT-CONVENTION.md) |
| Kredensial & multi-role             | [docs/CREDENTIALS.md](docs/CREDENTIALS.md)                         |
| Pasca-pipeline                      | [docs/POST-PIPELINE.md](docs/POST-PIPELINE.md)                     |
| Dashboard triage guide              | [docs/REPORT-GUIDE.md](docs/REPORT-GUIDE.md)                       |
| Skenario `(@manual)`                | [docs/MANUAL-SCENARIOS.md](docs/MANUAL-SCENARIOS.md)               |
| Environment (local/staging/prod)    | [docs/ENVIRONMENT-GUIDE.md](docs/ENVIRONMENT-GUIDE.md)             |
| Command cheat sheet                 | [docs/CHEATSHEET.md](docs/CHEATSHEET.md)                           |
| Integration recipes                 | [docs/recipes/README.md](docs/recipes/README.md)                   |
| Full E2E walkthrough                | [docs/SAMPLE-E2E-PIPELINE.md](docs/SAMPLE-E2E-PIPELINE.md)         |
| Fork ke project lain                | [docs/FORK-ONBOARDING.md](docs/FORK-ONBOARDING.md)                 |
| Troubleshooting                     | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)                 |
| MCP tool reference                  | [CUSTOM-MCP.md](CUSTOM-MCP.md)                                     |
| Pipeline agent contract             | [AGENTS.md](AGENTS.md)                                             |
| Architecture decisions              | [docs/architecture/DECISIONS.md](docs/architecture/DECISIONS.md)   |

</details>

---

## Kontribusi

Kontribusi welcome! Untuk perubahan besar:

1. Buka issue dulu — diskusikan perubahan
2. Buat branch dari `main` (`feat/...`, `fix/...`, `docs/...`)
3. Jalankan `npm run test:quality` sebelum push
4. Update changelog & dokumentasi relevan

> Lihat [docs/architecture/DECISIONS.md](docs/architecture/DECISIONS.md) untuk WHY di balik constraint framework.

---

<div align="center">

QA Playwright Kit · [github.com/k-ardliyan/qa-playwright-kit](https://github.com/k-ardliyan/qa-playwright-kit)

</div>
