# QA Playwright Kit — Cheat Sheet

> Print halaman ini (A4 portrait) dan tempel di meja Anda.

---

## Setup Pertama Kali

```bash
npm install
npm run setup
npm run setup:check && npm run health:check
# ganti kredensial nanti: npm run env:edit
# refresh session: npm run auth:setup
# OTP/CAPTCHA di browser: npm run auth:setup:headed
```

Manual (tanpa wizard):

```bash
npx playwright install --with-deps chromium
npm run mcp:build
cp config/environments/local.env.example config/environments/local.env   # isi BASE_URL + kredensial
npm run setup:check && npm run health:check
```

---

## Daily Flow

```bash
# Setelah setup → requirements/login.md = REAL website kamu
# (catalog mode: requirements/auth/login-<none|auto|otp-browser|otp-stdin|captcha-browser>.md)
npm run qa:run
# Hermes: snapshot_page dulu (locator per site) → plan → generate → report

# Fitur lain:
cp requirements/_TEMPLATE.md requirements/fitur-saya.md
# Edit → validate → prompt Hermes
```

---

## Command Paling Sering

| Command                         | Kapan                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| `npm run qa:run`                | Preflight + pilih requirement + prompt Hermes (bukan executor lokal) |
| `npm run validate:requirement`  | Cek requirement saja (TTY pilih file)                                |
| `npm run env:edit`              | Ganti password / role / browser / OTP-CAPTCHA                        |
| `npm run auth:setup`            | Refresh session (mode paralel)                                       |
| `npm run auth:setup:headed`     | Session + OTP/CAPTCHA di browser (workers=1)                         |
| `npm run manual:check`          | List semua skenario `(@manual)`                                      |
| `list_requirement_status` (MCP) | Peta: requirement → plan → tests → manual                            |
| `pipeline_status` (MCP)         | Cek fase pipeline, resume safety, staleness requirement              |
| `npm test`                      | Jalankan semua test                                                  |
| `npm run test:smoke`            | Cuma smoke test                                                      |
| `npm run test:contract`         | Validasi Golden Contract CI offline                                  |
| `npm run health:check`          | Cek MCP + env                                                        |

---

## Discovery & Requirement Synthesis Workflow (Phase -0.5)

```
# 1. Snapshot halaman (dengan session role) → semantic catalog tersimpan
snapshot_page (qa-playwright-kit) — url, featureName, pageName, role (opsional: exploreModals)

# 2. Synthesize requirement otomatis dari komponen UI (tabel, form, KPI, modal)
synthesize_requirement (qa-playwright-kit) — featureName, moduleName, title, entryUrl, role
→ requirements/<featureName>.md

# 3. Validasi & Jalankan Pipeline
npm run validate:requirement
npm run qa:run
```

---

## POM Workflow (Path B — opsional)

```
# 1. Snapshot halaman → catalog tersimpan permanen
snapshot_page (qa-playwright-kit) — url, featureName, pageName

# 2. Generate scaffold dari catalog
generate_page_object (qa-playwright-kit) — featureName, pageName
→ tests/pages/<ClassName>.ts (skip jika sudah ada)

# 3. Edit scaffold + register di src/fixtures/project.fixture.ts

# 4. Pipeline berjalan normal — Generator auto-import POM
```

> Path A (tanpa POM): langsung pipeline, Generator pakai inline locators — cukup untuk QA pemula.

---

## Tipe Skenario

| Tag                     | Artinya                                                 |
| ----------------------- | ------------------------------------------------------- |
| `(@success)`            | Happy path — alur normal                                |
| `(@failure)`            | Negative path — validasi, input salah                   |
| `(@access-restriction)` | Role tidak berhak, akses ditolak                        |
| `(@manual)`             | Tidak bisa diotomasi (CAPTCHA, OTP, layout PDF visual)  |
| `(@network)`            | Mock/intercept HTTP                                     |
| `(@network-assert)`     | Live payload + response (`waitAndAssertApi` / contract) |
| `(@hybrid)`             | Seed API + assert UI                                    |
| `(@aria)` / `(@visual)` | ARIA snapshot / visual regression                       |
| `(@download)`           | Download file → `downloadAndSave`                       |
| `(@upload)`             | Upload fixture-first → `uploadFixture`                  |
| `(@file-content)`       | PDF teks / Excel header (needle skenario)               |

---

## File fixtures (local-first)

| Path                  | Isi                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/data/pdf/`     | Sample PDF untuk upload / content assert                                                                                               |
| `tests/data/excel/`   | Sample xlsx                                                                                                                            |
| `tests/data/images/`  | Sample image upload                                                                                                                    |
| `tests/data/invalid/` | Negative (empty / spoofed)                                                                                                             |
| `tests/data/network/` | Contract partial untuk `@network-assert` (demo only)                                                                                   |
| Helpers               | `@/support/pw` — `waitAndAssertApi`, `waitForApi`, `assertNetworkContract`, `uploadFixture`, `downloadAndSave`, `assertPdfContains`, … |

Upload **bukan** `@manual`. PDF **teks** = `@file-content`; PDF **layout** visual = `@manual`. Live payload/response = `@network-assert` (bukan overload `@network` mock).

Setelah tool MCP baru / `npm run mcp:build` → **restart server `qa-playwright-kit`** di IDE (Hermes reload MCP).

---

## Kalau Gagal — Cek Ini Dulu

| Gejala                       | Pertama Cek                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `health_check` fail          | `npm run mcp:build` lalu **restart `qa-playwright-kit`** / IDE                    |
| Tool MCP baru tidak muncul   | `npm run mcp:build` → restart `qa-playwright-kit`                                 |
| `validate_requirement` error | Baca hint di output → perbaiki → coba lagi                                        |
| Test gagal semua satu role   | Cek `.auth/{APP_ENV}/<role>.json` ada atau belum                                  |
| Auth file missing            | `npm run auth:setup` / `auth:setup:headed`                                        |
| `@network-assert` timeout    | `waitForApi` **sebelum** click; cek urlIncludes/method; `serviceWorkers: 'block'` |
| Exit `2` (escalate)          | Hubungi Framework Maintainer                                                      |

---

## Keputusan Setelah Report

| Kondisi                    | Keputusan                            |
| -------------------------- | ------------------------------------ |
| Semua pass                 | ✅ APPROVE — archive sebagai baseline |
| Failure: app salah         | 🐛 FILE BUG — buat defect ticket     |
| Failure: requirement kabur | 📝 REVISE REQUIREMENT                |
| Failure: test/AI salah     | 🔧 FIX TEST/GENERATOR                |
| Failure: auth/env/data     | 🔧 FIX ENVIRONMENT                   |
| Tidak bisa diselesaikan    | 🚫 MARK BLOCKED                      |

---

## Referensi Cepat

| Dokumen                 | Link                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| Panduan lengkap         | [docs/GUIDE.md](GUIDE.md)                                         |
| Template requirement    | [requirements/_TEMPLATE.md](../requirements/_TEMPLATE.md)         |
| Contoh requirement baik | [requirements/_GOOD_EXAMPLE.md](../requirements/_GOOD_EXAMPLE.md) |
| Panduan `@manual`       | [docs/MANUAL-SCENARIOS.md](MANUAL-SCENARIOS.md)                   |
| Auth per role           | [docs/AUTH-CONTEXT-CONVENTION.md](AUTH-CONTEXT-CONVENTION.md)     |
| Kredensial & multi-role | [docs/CREDENTIALS.md](CREDENTIALS.md)                             |

---

> **Tips:** Setup awal = `npm run setup` menulis `requirements/login.md` (mode challenge + URL/role) lalu print prompt Hermes.
> Catalog mode: `requirements/auth/login-none.md` / `login-auto.md` / `login-otp-browser.md` / `login-otp-stdin.md` / `login-captcha-browser.md`.
