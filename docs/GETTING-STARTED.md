# Getting Started — Panduan QA Baru

> **Untuk Anda yang baru pertama kali setup framework ini.** Ikuti langkah-langkah di bawah ini **berurutan**. Estimasi total: 10-15 menit.

---

## 📋 Checklist Pra-Setup (Cek Dulu!)

Jalankan perintah ini di terminal Anda. **Jika ada yang ❌, perbaiki dulu sebelum lanjut.**

```bash
node --version    # Harus >= 20.19.0
git --version     # Harus ada (versi berapa saja)
```

| Prasyarat        | Versi Minimum  | Cara Cek                                                            | Cara Install                      |
| ---------------- | -------------- | ------------------------------------------------------------------- | --------------------------------- |
| Node.js          | **>= 20.19.0** | `node --version`                                                    | <https://nodejs.org/> (pilih LTS) |
| Git              | Apa saja       | `git --version`                                                     | <https://git-scm.com/>            |
| **Hermes Agent** | Latest         | Lihat [panduan install](https://hermes-agent.nousresearch.com/docs) | Sama seperti di atas              |

> **⚠️ Node.js versi lama adalah penyebab #1 setup gagal.** Jika `node --version` menunjukkan v18 atau lebih lama, wizard akan error di Phase 0.

---

## 🚀 Setup dalam 3 Langkah

### Langkah 1 — Clone / Download Repo

**Opsi A: Clone via Git (recommended untuk update di masa depan)**

```bash
git clone https://github.com/<your-org>/qa-playwright-kit.git
cd qa-playwright-kit
```

**Opsi B: Download ZIP (sekali pakai, tanpa Git history)**

1. Buka halaman GitHub repo → klik tombol hijau **Code** → **Download ZIP**
2. Extract ZIP ke folder pilihan Anda
3. Buka terminal di folder tersebut

---

### Langkah 2 — Install Dependencies

```bash
npm install
```

Tunggu sampai selesai (1-3 menit tergantung koneksi internet).

---

### Langkah 3 — Jalankan Setup Wizard

```bash
npm run setup
```

Wizard interaktif memandu Anda melalui **6 langkah**:

| Langkah                    | Apa yang terjadi                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| **1. Deteksi konfigurasi** | Cek apakah `config/environments/{APP_ENV}.env` sudah ada (tanya update/skip)                      |
| **2. APP_ENV**             | Pilih environment (`local`/`staging`/…)                                                           |
| **3. BASE_URL**            | Masukkan BASE_URL untuk env itu + verifikasi reachable                                            |
| **4. Role kredensial**     | Pilih role (mis. `user`, `finance`, `super-admin`); per role pilih metode login (Email/Username/Phone) → isi nilainya → password + konfirmasi |
| **5. AUTH_CHALLENGE_MODE** | Pilih mode challenge (`none`/`otp-browser`/`otp-stdin`/`captcha-browser`/`auto`)                  |
| **6. Verify + Summary**    | Tulis `config/environments/{APP_ENV}.env`, validasi setup, tampilkan ringkasan                    |

File yang dihasilkan: `config/environments/{APP_ENV}.env` (fallback legacy: `environments/{APP_ENV}.env`).

**Yang TIDAK dilakukan wizard ini:** wizard tidak menginstall browser/MCP server, tidak menjalankan auth setup, tidak mengenkripsi nilai secara otomatis, dan tidak membuat `requirements/login.md`. Langkah-langkah itu dilakukan terpisah (lihat di bawah). Enkripsi file env dilakukan lewat `npm run env:edit` (re-encrypt) atau `npx @dotenvx/dotenvx encrypt -f config/environments/{APP_ENV}.env`.

---

## ✅ Verifikasi Setup Berhasil

Setelah wizard selesai, jalankan:

```bash
npm run setup:check
npm run health:check
```

**Target output: semua hijau ✓.** Jika ada warning tentang `json_results.json belum ada` — itu **normal** sebelum test pertama dijalankan.

---

## Setelah Setup — Ganti Kredensial / Ganti Environment

```bash
npm run env:status                 # APP_ENV aktif + source (os|pin|default)
npm run env:use:staging            # pin environment (local work)
npm run env:edit                   # ganti BASE_URL / password / role / OTP-CAPTCHA di file aktif
npm run auth:setup                 # refresh session
npm run auth:setup:headed          # OTP/CAPTCHA (browser terlihat)
```

**Catatan:** Setiap environment punya file sendiri (`config/environments/local.env`, `config/environments/staging.env`, …) dengan **BASE_URL dan kredensial sendiri**. Jangan mengasumsikan URL sama di semua env.

Detail: **[CREDENTIALS.md](CREDENTIALS.md)**.

---

## 🎯 Mulai Testing

Setelah env aktif terisi kredensial, buat requirement untuk website kamu. Mulai dari template:

```bash
cp requirements/_TEMPLATE.md requirements/login.md
# isi: judul, Metadata (module/feature/tags), Kriteria Penerimaan, Skenario Uji
```

> `requirements/login.md` **tidak** dibuat otomatis oleh wizard — buat sendiri dari template (contoh isi: [requirements/_GOOD_EXAMPLE.md](../requirements/_GOOD_EXAMPLE.md)).

| Langkah    | Yang terjadi                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| **Lihat**  | Buka `requirements/login.md` — requirement REAL project                                                         |
| **Paste**  | Jalankan pipeline via `npm run qa:run` atau prompt Hermes (wajib `snapshot_page` dulu — locator beda tiap site) |
| **Tunggu** | Plan → Generate → Execute → Heal → Report                                                                       |
| **Baca**   | [docs/POST-PIPELINE.md](POST-PIPELINE.md) untuk failureSource + keputusan QA                                    |

**Prompt inti (sama dengan output `qa:run`):**

```
Run full pipeline in automatic mode for requirements/login.md
(orchestrator: AGENTS.md).
BEFORE Plan/Generate: snapshot_page on real BASE_URL+login path;
use selector-catalog locators (Path A, no POM).
```

Atau via CLI:

```bash
npm run qa:run
```

> **ℹ️** `requirements/sample-*.md` = sample format saja. Requirement produksi = file sendiri (mis. `login.md`).
> **ℹ️** `qa:run` = preflight + prompt helper (prompt dinamis per Auth state / Halaman awal) — pipeline penuh di Hermes.
> **ℹ️** Cek coverage plan/tests: Hermes tool `list_requirement_status` (qa-playwright-kit).

Hermes akan otomatis:

1. Validasi requirement (cek format)
2. Generate test plan (`specs/login-test-plan.md`)
3. Generate spec Playwright (`tests/login*.spec.ts`)
4. Jalankan test
5. Heal jika ada failure
6. Buat laporan di `artifacts/reports/custom-dashboard.html`

---

## 🆘 Ada Masalah?

- **Lihat [TROUBLESHOOTING.md](TROUBLESHOOTING.md)** untuk 10 error paling umum
- **Atau tanya langsung ke Hermes Agent** — dia tahu semua dokumen di repo ini

---

## 📚 Langkah Selanjutnya

| Setelah Setup                   | Baca                                                     |
| ------------------------------- | -------------------------------------------------------- |
| Ganti password / multi-role     | [CREDENTIALS.md](CREDENTIALS.md)                         |
| Ingin tulis requirement pertama | [WRITING-REQUIREMENTS.md](WRITING-REQUIREMENTS.md)       |
| Ingin lihat command penting     | [CHEATSHEET.md](CHEATSHEET.md)                           |
| Ingin paham pipeline lengkap    | [GUIDE.md](GUIDE.md)                                     |
| Ingin paham role-based testing  | [AUTH-CONTEXT-CONVENTION.md](AUTH-CONTEXT-CONVENTION.md) |
| Ingin lihat laporan test        | [REPORT-GUIDE.md](REPORT-GUIDE.md)                       |
| Setup dari fork template        | [FORK-ONBOARDING.md](FORK-ONBOARDING.md)                 |
