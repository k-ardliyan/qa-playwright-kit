# Troubleshooting — 10 Error Paling Umum

> **Quick reference** untuk error yang paling sering muncul saat setup atau menjalankan framework. Jika error Anda tidak ada di sini, tanya langsung ke **Hermes Agent** di VS Code — dia bisa akses semua dokumen di repo ini.

---

## 🔴 Blocker (Setup Tidak Bisa Lanjut)

### Error #1: `Node.js terlalu lama: v18.x.x`

**Gejala:** Wizard langsung keluar di Phase 0.

**Root cause:** Framework butuh Node.js >= 20.19.0 (lihat `engines` di package.json; TypeScript ^5.9.3).

**Fix:**

1. Buka <https://nodejs.org/>
2. Download versi LTS (20.x atau lebih baru)
3. Install, restart terminal
4. Verifikasi: `node --version`
5. Jalankan ulang: `npm run setup`

---

### Error #2: `npm install` Gagal — `EACCES` atau `EPERM`

**Gejala:** Permission denied saat install package.

**Root cause:** Folder project dimiliki user lain (misal setup awal dengan `sudo`), atau ada antivirus yang block.

**Fix (Windows):**

- Jalankan terminal **sebagai Administrator**
- Disable antivirus sementara saat install
- Hapus `node_modules` lalu coba lagi: `rm -rf node_modules && npm install`

**Fix (Mac/Linux):**

- Jangan pernah jalankan `npm install` dengan `sudo`
- Jika pernah: `sudo chown -R $USER:$USER .` lalu `rm -rf node_modules && npm install`

---

### Error #3: `npx playwright install` Gagal dengan `sudo: unable to resolve host`

**Gejala:** `playwright install --with-deps` butuh akses admin untuk install system packages (libnss3, dll).

**Fix (Mac/Linux):**

```bash
sudo npx playwright install --with-deps chromium
# Masukkan password Anda
```

**Fix (Windows):**

- Buka terminal sebagai Administrator (klik kanan PowerShell → "Run as administrator")
- Jalankan ulang `npm run setup`

> **Alternatif tanpa sudo:** Jalankan `npx playwright install chromium` (tanpa `--with-deps`). Browser akan jalan tapi beberapa fitur mungkin terbatas.

---

## 🟠 Setup Wizard Stuck atau Gagal

### Error #4: Wizard Crash dengan `Unterminated string literal`

**Gejala:** Error dari esbuild/tsx saat menjalankan `npm run setup`.

**Root cause:** Error esbuild/tsx saat kompilasi `src/setup/index.ts` (karakter/line ending corrupt), atau konflik versi Node/tsx lokal.

**Fix:**

```bash
# Lihat detail error
npm run setup 2>&1 | head -20

# Lapor ke maintainer jika persistent — sertakan:
# - Node.js version (node --version)
# - OS (Windows/Mac/Linux)
# - Output error lengkap
```

---

### Error #5: `local.env` Sudah Dienkripsi Tapi Kunci Hilang

**Gejala:** Setup di mesin baru, file `local.env` isinya `encrypted:BA+84...` tapi `.env.keys` tidak ada. Log: `[SECURITY] Decryption keys missing … Falling back to dummy template`.

**Root cause:** Kunci dekripsi dotenvx disimpan lokal di `~/.dotenvx-keys/` — tidak ikut ke Git. Guard hanya aktif bila file **encrypted** (`encrypted:`); file plaintext (termasuk yang di-materialize CI) tetap di-load.

**Fix:**

1. **Opsi A** — Minta kunci dari anggota tim yang punya akses (share `.env.keys` via 1Password/Vault yang aman). Simpan ke `~/.dotenvx-keys/qa-playwright-kit/.env.keys`
2. **Opsi B** — Buat ulang dari nol:

   ```bash
   rm config/environments/local.env
   cp config/environments/local.env.example config/environments/local.env
   # Isi BASE_URL + kredensial (boleh lewat editor — masih plaintext)
   npm run env:edit          # buka menu → Simpan & encrypt
   # fallback manual:
   npx @dotenvx/dotenvx encrypt -f config/environments/local.env
   ```

Panduan lengkap: [CREDENTIALS.md](CREDENTIALS.md).

---

### Error #5d: Nightly / E2E CI → `net::ERR_NAME_NOT_RESOLVED` di `staging.your-app.example.com`

**Gejala:** Job `authenticate:user` gagal ke URL placeholder; log `Encrypted config/environments/staging.env found but no dotenvx private key is available`.

**Root cause (historis + ops):**

1. Secret `BASE_URL` (dan kredensial) belum di-set di repo → workflow materialize `BASE_URL=` kosong, atau job jalan tanpa secret.
2. Perilaku lama: env-loader diam-diam fallback ke `.env.example` saat file terenkripsi tanpa keys. Sekarang **fail-fast**: throw dengan panduan restore kunci — test tidak lagi jalan pakai kredensial dummy (file CI plaintext tetap dimuat apa adanya).
3. Kredensial template (`test@example.com` / `your_password_here`) dulu dianggap login-ready → auth.setup tetap `page.goto` ke dummy URL. Sekarang `isRoleLoginReady` menolak placeholder.

**Fix:**

1. Set GitHub secrets: `BASE_URL`, `TEST_USER_EMAIL` (atau USERNAME/PHONE), `TEST_USER_PASSWORD`.
2. Workflow `e2e.yml` / `nightly-e2e.yml` punya job `check-secrets` — tanpa `BASE_URL` job E2E di-skip (bukan fail DNS dummy).
3. Step **Materialize CI environment file** fail-fast bila secret kosong / masih `your-app.example.com` / password atau identity hilang.
4. Auth setup di CI: throw jika `BASE_URL` masih placeholder kit.
5. Jangan commit `config/environments/staging.env` (encrypted atau plaintext) ke CI; biarkan materialize menulis plaintext ephemeral.

---

### Error #5b: Mau ganti password / tambah role

**Jangan** edit baris `encrypted:…` di editor. Gunakan:

```bash
npm run env:edit
# menu → Edit kredensial role / Tambah role → Simpan & encrypt
npm run auth:setup
# OTP / CAPTCHA (browser terlihat):
npm run auth:setup:headed
```

Jika `health_check` / `npm run health:check` melaporkan **`auth_storage` warn** (`.auth/{APP_ENV}/` missing, kosong, atau expired), jalankan `npm run auth:setup` untuk environment aktif. Tanpa file storage state, test authenticated akan gagal di auth setup / empty session.

> **Catatan gate (sejak 2026-09-11):** `npm run health:check` adalah gate kualitas kode — sesi expired hanya **warning** (exit 0) supaya gate tidak merah karena sesi login lokal. Untuk pra-run pipeline yang butuh sesi hidup, pakai `npm run health:check:strict` (sesi expired = **gagal**).

Jika `auth_storage` melaporkan **EXPIRED** (semua cookie sesi kedaluwarsa) → `npm run auth:setup`. Jika status **unknown** (sesi hidup di localStorage, tidak ada TTL cookie di disk) → verifikasi live dengan `npm run auth:verify` (navigate ke success URL per role; redirect ke login = sesi mati).

---

### Error #5b-2: 401 / Session Expired di Tengah Run

**Gejala:** Test authenticated tiba-tiba gagal — error `SESSION EXPIRED for role "<role>"`, `401`, atau trace/screenshot menunjukkan page berakhir di halaman login (sering menyamar jadi locator timeout).

**Fix (Auth Recovery Protocol — CC-AUTH-RECOVERY):**

1. STOP healing file tersebut — jangan patch locator saat page nyangkut di login.
2. Jalankan `npm run auth:setup` (login UI asli; sesi valid otomatis di-reuse).
3. Re-run spec file yang terdampak saja.
4. Maks **1 siklus re-auth per role per run** — 401 kambuh = masalah TTL sesi server → eskalasi ke QA (FIX ENVIRONMENT).
5. **DILARANG** inject storage state (`browser_set_storage_state`, `addCookies`, `localStorage.setItem`, edit manual `.auth/*.json`) dan **DILARANG** login di dalam spec — login UI via setup project adalah satu-satunya pembuat sesi.

---

### Error #5c: Auth stuck di OTP / CAPTCHA

**Gejala:** Login password OK tapi tidak sampai dashboard; empty storage state; atau hang.

**Fix:**

1. Set mode lewat `npm run env:edit` → _Edit BASE_URL / browser / OTP-CAPTCHA_
   - OTP: **otp-browser** (disarankan) atau **otp-stdin**
   - CAPTCHA: **captcha-browser** saja (terminal tidak bisa)
2. Jalankan `npm run auth:setup:headed` (browser terlihat + workers=1)
3. Isi OTP/CAPTCHA di browser, atau Resume di Playwright Inspector
4. CI: biarkan `AUTH_CHALLENGE_MODE=none` — mode interaktif dilarang di CI

Detail: [AUTH-CONTEXT-CONVENTION.md](AUTH-CONTEXT-CONVENTION.md).

---

### Error #6: Auth Setup Gagal — `selector not found` / `timeout`

**Gejala:** `npm run auth:setup` / `auth:setup:headed` gagal — selector login tidak ditemukan.

**Root cause:** Selector form login aplikasi Anda berbeda dari default (`input[type=email]`, `input[type=password]`).

**Fix:**

1. Buka `src/support/auth.setup.ts` yang baru di-generate
2. **Sebelum mengedit, tambahkan baris `// CUSTOM_AUTH_FLOW` di bagian paling atas file.** Penanda ini melindungi kustomisasi Anda: `npm run setup`, `env:edit`, dan `npm run upgrade` otomatis **tidak menimpa** file ber-penanda — tanpa perlu commit dulu.
3. Ganti selector dengan selector aplikasi Anda. Contoh untuk React app:

   ```typescript
   await page.fill('[data-testid="email-input"]', email);
   await page.fill('[data-testid="password-input"]', password);
   await page.click('[data-testid="login-button"]');
   ```

4. **Atau minta Hermes Agent:**

   ```
   Tolong perbaiki src/support/auth.setup.ts untuk login page di https://staging.myapp.com/login.
   Tambahkan // CUSTOM_AUTH_FLOW di baris atas file, lalu pakai snapshot_page dulu untuk lihat selector yang ada.
   ```

5. Jalankan ulang: `npm run auth:setup` / `npm run auth:setup:headed`

---

## 🟡 MCP Server / Hermes Issue

### Error #7: MCP Status Bar Tidak Menampilkan `3 servers`

**Gejala:** Status bar bawah VS Code menunjukkan `MCP ● 0 servers` atau tidak ada indikator MCP.

**Root cause:** Hermes Agent belum load `.mcp.json` atau `mcp:build` belum dijalankan.

**Fix (berurutan):**

1. Pastikan `mcp:build` sukses:

   ```bash
   ls tools/mcp/dist/index-mcp.js  # harus ada
   # Jika tidak ada:
   npm run mcp:build
   ```

2. Restart VS Code **sepenuhnya** (bukan hanya reload window) — `Ctrl+Shift+P` → "Reload Window"
3. Cek lagi status bar: `MCP ● 3 servers`
4. Jika masih 0: klik status bar → "Reload MCP Servers"

---

### Error #7b: Semua Tool MCP `qa-playwright-kit` Gagal (`WORKSPACE_MANIFEST_MISSING`)

**Gejala:** MCP terlihat sehat (`✓ Connected`, daftar tool muncul, status bar `3 servers`), tetapi **setiap** pemanggilan tool balas:

```json
{ "status": "error", "error": { "code": "TOOL_ERROR",
  "message": "WORKSPACE_MANIFEST_MISSING: Workspace manifest \"config\\qa-kit.workspace.json\" is missing in root \"C:\\Users\\<user>\"." } }
```

**Root cause:** host MCP (Hermes / Cursor / VS Code / Codex) menjalankan server dari cwd sembarang — biasanya home direktori. Server lama me-resolve repo root dari `process.cwd()`, sehingga mencari manifest di tempat yang salah.

**Fix:**

1. Update framework (perbaikan sudah masuk — root kini di-resolve dari lokasi modul, bukan cwd):

   ```bash
   npm run upgrade
   ```

2. Restart server MCP di IDE (agar build baru termuat).
3. Verifikasi: `npm run health:check` → baris `workspace_root` harus `ok` dan menyebut path repo yang benar.
4. Jika repo berada di luar jalur launcher: set `QA_REPO_ROOT` ke path repo absolut pada konfigurasi MCP server.

**Catatan:** `hermes mcp test <server>` **tidak** mendeteksi masalah ini — ia hanya menguji handshake. Gunakan `health_check` untuk verifikasi nyata.

---

### Error #7c: Tool `browser_*` Hilang — Server MCP `playwright` Gagal Start (Path Repo Mengandung Spasi)

**Gejala:** Daftar tool agent tidak memuat satu pun tool `browser_*` (`browser_navigate`, `browser_snapshot`, …), walau `.mcp.json` dan `config.yaml` benar. Host mencoba start ulang server `playwright` terus-menerus tanpa pernah berhasil.

**Root cause:** launcher menjalankan `npx` lewat shell, sehingga argumen `--output-dir=<path repo>` dipecah di setiap spasi. CLI `@playwright/mcp` menolaknya dan keluar; host hanya melaporkan "server tidak connect". **Hanya terpicu bila path repo mengandung spasi** (mis. `D:\Proyek QA\qa-playwright-kit`), itulah sebabnya mesin uji dengan path bersih tidak pernah melihatnya.

**Cek cepat** — jalankan langsung dan lihat apakah muncul `too many arguments`:

```bash
npx tsx tools/scripts/playwright-mcp-launch.ts < /dev/null
```

**Fix:** perbaikan sudah masuk (launcher tidak lagi lewat shell; entry paket lokal dijalankan langsung oleh Node). Update lalu restart server MCP:

```bash
npm run upgrade
hermes mcp test playwright        # harapkan: ✓ Connected + Tools discovered: 48
hermes mcp test playwright-test   # harapkan: ✓ Connected
```

**Bila masih gagal:** pesan error launcher kini mencetak `command:` yang dicoba — tempelkan baris itu saat eskalasi. Jika yang muncul `Playwright MCP launch failed` **tanpa** baris `command:`, berarti ada jalur spawn baru yang kembali memakai `shell: true` dengan argumen berisi path; laporkan ke maintainer.

**Catatan Linux/macOS:** jalur normal kini bebas shell, jadi tidak butuh `cmd.exe` (Windows) maupun `npx` di PATH — portabilitasnya justru naik.

---

### Error #8: `Cannot find module '@playwright/test'`

**Gejala:** Saat run test atau `qa:run`, error `MODULE_NOT_FOUND`.

**Root cause:** `node_modules` belum terinstall atau corrupt.

**Fix:**

```bash
rm -rf node_modules package-lock.json
npm install
npx playwright install --with-deps chromium
```

---

## 🟢 Operational Issues (Setelah Setup)

### Error #9: `artifacts/reports/custom-dashboard.html` Tidak Ada

**Gejala:** `start artifacts/reports/custom-dashboard.html` error "file not found".

**Root cause:** Folder `reports/` baru dibuat setelah test pertama / reporter dijalankan.

**Fix:**

```bash
# Jalankan test dulu (meskipun demo)
npm run test:demo

# Atau serve dashboard dari test-summary.json terakhir tanpa full e2e
npm run dashboard

# Buka dashboard (Ctrl+F5 setelah regenerate)
start artifacts/reports/custom-dashboard.html
# preview: artifacts/reports/preview/local.html
```

Anatomy / cara baca: [REPORT-GUIDE.md](REPORT-GUIDE.md).

---

### Error #10: Test Gagal Massal dengan `ERR_CONNECTION_REFUSED`

**Gejala:** Semua test fail di step `goto(BASE_URL)`.

**Root cause:** Aplikasi target tidak bisa diakses — down, salah URL, atau firewall block.

**Fix:**

1. Cek manual di browser: buka `BASE_URL` (lihat di `config/environments/local.env`)
2. Jika down → tunggu aplikasi up lagi
3. Jika salah URL → edit:

   ```bash
   npm run env:edit
   # Update BASE_URL, save, tutup editor
   ```

4. Jika firewall (umum di kantor) → hubungi IT untuk whitelist

---

### Error #11: Test Gagal Tapi `artifacts/test-results/` Tidak Ada `trace.zip`

**Gejala:** test fail lokal, ada screenshot + video, tapi tidak ada trace untuk dibuka di Trace Viewer.

**Root cause:** bukan bug — konfigurasi default `trace: 'on-first-retry'` + retries lokal = 0, jadi trace hanya direkam saat retry (praktis hanya di CI yang `retries: 2`). Gagal lokal = tidak ada retry = tidak ada trace.

**Fix:**

```bash
# Rekam trace untuk semua test pada run ini (bukan hanya retry):
npx playwright test tests/<feature>.spec.ts --trace on

# Debug satu test dengan Playwright Inspector:
npx playwright test tests/<feature>.spec.ts --debug

# Buka trace setelah run:
npx playwright show-trace artifacts/test-results/<test-folder>/trace.zip
```

---

## 🔧 Cara Mendapatkan Help Lebih Lanjut

**Sebelum tanya, kumpulkan info ini:**

```bash
node --version
npm --version
npx playwright --version
cat .mcp.json | head -20
ls -la config/environments/
```

Lalu tanya ke **Hermes Agent** di VS Code:

```
Saya dapat error ini saat setup:
[paste error message lengkap]

Environment saya:
- OS: [Windows 11 / macOS 14 / Ubuntu 22.04]
- Node: [output dari node --version]
- Sudah coba: [apa yang sudah Anda coba]

Tolong bantu diagnose.
```

Hermes bisa akses semua file di repo ini termasuk log, env, dan config.

---

## 🛟 Recovery — kerjaan hilang? Cek ini sebelum panik

| Situasi                                                     | Pulihkan                                                                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hasil upgrade masih staged dan ingin dibatalkan             | `git restore --staged --worktree .`                                                                                                                                              |
| File framework tertimpa upgrade padahal berisi editan lokal | Ambil dari snapshot pra-apply: `git checkout <sha-snapshot> -- <file>` — daftar snapshot: `git for-each-ref refs/qa-kit/upgrade-snapshots/` (diprint juga saat upgrade berjalan) |
| Butuh keadaan file sebelum commit tertentu                  | `git reflog` → temukan sha → `git checkout <sha> -- <file>`                                                                                                                      |
| File belum pernah di-commit lalu terhapus                   | Git tidak menyimpan yang belum di-commit — `git fsck --lost-found` hanya menolong bila pernah di-stage. Pelajaran: commit kecil dan sering                                       |
| Kerjaan QA (requirements/specs/tests) sudah ter-commit      | Aman — upgrade tidak pernah menyentuh file QA. Versi lama: `git checkout <sha-lama> -- requirements/ specs/ tests/`                                                              |

> **Polis asuransi terbaik:** commit kecil-sering + push rutin. Konten yang belum pernah jadi commit/stash tidak bisa dipulihkan git bila hilang.

---

## 🔁 Sudah kejadian `git pull` upstream manual — cek ini

`git pull` upstream manual dilarang protokol karena memotong snapshot, staged review, dan commit-lock engine. Kalau sudah terlanjur, biasanya **tidak ada yang rusak** — settle dengan ini:

1. `git status` — kerjaan QA masih ada? Commit aset QA-mu dulu sebagai commit tersendiri.
2. `grep syncedCommit .upgrade-base.json` — nilainya harus **base terbaru** (≥ commit upstream yang sudah kamu miliki). Kalau nilainya **mundur** (versi basi upstream yang menang saat resolve konflik): jangan edit manual — jalankan `npm run upgrade:check --json` lalu `npm run upgrade --json --commit`; engine menaikkan base sendiri dan perubahan lama yang ter-re-apply hanyalah no-op.
3. `git stash list` — pastikan kosong (tidak ada checkpoint yang nyangkut dari proses pull).
4. Ke depan: update framework **hanya** lewat `npm run upgrade --json --commit`. Pasang deny perintah destruktif di klien agent-mu: [AGENT-GIT-SAFETY.md](AGENT-GIT-SAFETY.md).

> **Jangan** pakai `git reset --hard ORIG_HEAD` untuk "membatalkan" pull selama ada file QA yang belum di-commit — itu menghabiskannya.

---

## 📞 Escalation ke Maintainer

**Lapor ke maintainer** hanya jika:

- Wizard masih crash setelah fix #1-#10
- Bug muncul setelah `npm run upgrade` (sertakan output `npm run upgrade:check --json`)
- Ingin tambah fitur baru ke wizard

Sertakan:

- Output `npm run setup:check`
- Output `npm run health:check`
- Versi Node, OS, dan Playwright (`npx playwright --version`)
- Step reproduksi error
