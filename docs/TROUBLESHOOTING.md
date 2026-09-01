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

Jika `health_check` / `npm run health:check` melaporkan **`auth_storage` warn** (`.auth/{APP_ENV}/` missing atau kosong), jalankan `npm run auth:setup` untuk environment aktif. Tanpa file storage state, test authenticated akan gagal di auth setup / empty session.

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
2. Ganti selector dengan selector aplikasi Anda. Contoh untuk React app:
   ```typescript
   await page.fill('[data-testid="email-input"]', email);
   await page.fill('[data-testid="password-input"]', password);
   await page.click('[data-testid="login-button"]');
   ```
3. **Atau minta Hermes Agent:**
   ```
   Tolong perbaiki src/support/auth.setup.ts untuk login page di https://staging.myapp.com/login.
   Pakai snapshot_page dulu untuk lihat selector yang ada.
   ```
4. Jalankan ulang: `npm run auth:setup` / `npm run auth:setup:headed`

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

### Error #9: `reports/custom-dashboard.html` Tidak Ada

**Gejala:** `start reports/custom-dashboard.html` error "file not found".

**Root cause:** Folder `reports/` baru dibuat setelah test pertama / reporter dijalankan.

**Fix:**

```bash
# Jalankan test dulu (meskipun demo)
npm run test:demo

# Atau serve dashboard dari test-summary.json terakhir tanpa full e2e
npm run dashboard

# Buka dashboard (Ctrl+F5 setelah regenerate)
start reports/custom-dashboard.html
# preview: reports/preview/local.html
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

## 📞 Escalation ke Maintainer

**Lapor ke maintainer** hanya jika:

- Wizard masih crash setelah fix #1-#10
- Bug muncul setelah update framework (`git pull upstream main`)
- Ingin tambah fitur baru ke wizard

Sertakan:

- Output `npm run setup:check`
- Output `npm run health:check`
- Versi Node, OS, dan Playwright (`npx playwright --version`)
- Step reproduksi error
