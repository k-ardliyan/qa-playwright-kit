# REQ-AUTH-OTP-STDIN: Login — otp-stdin — Target App

<!--
  Catalog AUTH_CHALLENGE_MODE=otp-stdin. Setup wizard menulis requirements/login.md dari mode yang dipilih.
  Locator berbeda per website: Generator WAJIB snapshot_page dulu, lalu live-verify selector.
  Jangan tulis password/secret di file ini.
  OTP/CAPTCHA di requirement tetap (@manual). AUTH_CHALLENGE_MODE hanya membantu npm run auth:setup.
-->

## Metadata

- **Tags:** #auth #ui #smoke #login
- **Prioritas:** high
- **Auth state:** unauthenticated
- **Halaman awal:** /login
- **Module:** auth
- **Feature:** login-otp-stdin

## Kriteria Penerimaan

- **AC-01:** Form login menolak submit ketika field identifier (email/username/phone) kosong.
- **AC-02:** Form login menolak submit ketika field password kosong.
- **AC-03:** Form login menolak submit ketika identifier dan password kosong.
- **AC-04:** Form login menolak identifier yang hanya spasi (diperlakukan kosong).
- **AC-05:** Form login menolak identifier dengan format tidak valid (bukan email/username/phone yang diterima aplikasi).
- **AC-06:** Login gagal dengan user fiktif menampilkan pesan error observable, tetap di halaman login, dan akun role `user` tidak terkunci.
- **AC-07:** Login berhasil dengan kredensial valid me-redirect ke path `/dashboard` (assert pathname, bukan URL dengan `?redirect=`) dan session tersimpan di `.auth/{APP_ENV}/user.json`.
- **AC-08:** Setelah password, tantangan otp-stdin diselesaikan manusia; skenario ditandai (@manual) karena OTP/CAPTCHA tidak diotomasi di pipeline (AUTH_CHALLENGE_MODE hanya untuk auth:setup).

## Skenario Uji

### SC-01: Submit dengan Identifier Kosong (@failure)

- **Test ID:** `TC-LOGIN-001`
- **Covers:** `AC-01`
- **Role:** `user`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna di `https://app.example.com/login`, belum login.

**Input Data:**

- identifier: literal:
- password: credential:user.password

**Langkah:**

1. Buka halaman login
2. Biarkan field login kosong
3. Isi field password (`password`, `pass`, atau `kata sandi`)
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)

**Hasil yang Diharapkan:**

- URL tetap mengandung `/login` (tidak redirect ke `/dashboard`)
- Pesan validasi tampil di dekat field identifier
- Request otentikasi tidak dikirim
- Tombol submit kembali enabled (tidak stuck loading)

---

### SC-02: Submit dengan Password Kosong (@failure)

- **Test ID:** `TC-LOGIN-002`
- **Covers:** `AC-02`
- **Role:** `user`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna di `https://app.example.com/login`, belum login.

**Input Data:**

- identifier: credential:user.email
- password: literal:

**Langkah:**

1. Buka halaman login
2. Isi field login (`email`, `username`, atau `user`)
3. Biarkan field password kosong
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)

**Hasil yang Diharapkan:**

- URL tetap mengandung `/login` (tidak redirect ke `/dashboard`)
- Pesan validasi tampil di dekat field password
- Request otentikasi tidak dikirim
- Tombol submit kembali enabled (tidak stuck loading)

---

### SC-03: Submit dengan Identifier dan Password Kosong (@failure)

- **Test ID:** `TC-LOGIN-003`
- **Covers:** `AC-03`
- **Role:** `user`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna di `https://app.example.com/login`, belum login.

**Input Data:**

- identifier: literal:
- password: literal:

**Langkah:**

1. Buka halaman login
2. Biarkan field login kosong
3. Biarkan field password kosong
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)

**Hasil yang Diharapkan:**

- URL tetap mengandung `/login` (tidak redirect ke `/dashboard`)
- Pesan validasi tampil di dekat field identifier
- Pesan validasi tampil di dekat field password
- Request otentikasi tidak dikirim

---

### SC-04: Submit dengan Identifier Hanya Spasi (@failure)

- **Test ID:** `TC-LOGIN-004`
- **Covers:** `AC-04`
- **Role:** `user`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna di `https://app.example.com/login`, belum login.

**Input Data:**

- identifier: literal:   
- password: credential:user.password

**Langkah:**

1. Buka halaman login
2. Isi field login dengan karakter spasi saja (nilai di Input Data)
3. Isi field password (`password`, `pass`, atau `kata sandi`)
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)

**Hasil yang Diharapkan:**

- URL tetap mengandung `/login` (tidak redirect ke `/dashboard`)
- Pesan validasi tampil di dekat field identifier (spasi diperlakukan kosong)
- Request otentikasi tidak dikirim

---

### SC-05: Submit dengan Identifier Format Tidak Valid (@failure)

- **Test ID:** `TC-LOGIN-005`
- **Covers:** `AC-05`
- **Role:** `user`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna di `https://app.example.com/login`, belum login. Identifier fiktif, bukan akun real.

**Input Data:**

- identifier: literal:bukan-email-atau-phone
- password: credential:user.password

**Langkah:**

1. Buka halaman login
2. Isi field login (`email`, `username`, atau `user`)
3. Isi field password (`password`, `pass`, atau `kata sandi`)
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)

**Hasil yang Diharapkan:**

- URL tetap mengandung `/login` (tidak redirect ke `/dashboard`)
- Pesan validasi format tampil di dekat field identifier
- Request otentikasi tidak dikirim, atau ditolak di UI tanpa redirect

---

### SC-06: Login Gagal dengan User Fiktif (@failure)

- **Test ID:** `TC-LOGIN-006`
- **Covers:** `AC-06`
- **Role:** `user`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE BE`

**Prekondisi:** Aplikasi berjalan di `https://app.example.com`. Akun `qa.invalid.user.not.exists` **tidak ada** di sistem (user fiktif — jangan pakai password salah pada akun real).

**Input Data:**

- identifier: literal:qa.invalid.user.not.exists
- password: literal:WrongPasswordInvalid!

**Langkah:**

1. Buka halaman login
2. Isi field login (`email`, `username`, atau `user`)
3. Isi field password (`password`, `pass`, atau `kata sandi`)
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)

**Hasil yang Diharapkan:**

- URL tetap mengandung `/login` (tidak redirect ke `/dashboard`)
- Pesan error yang observable tampil di halaman (mis. "Email atau password salah")
- Tombol submit kembali enabled (tidak stuck loading)
- Akun role `user` **tidak terkunci** — user fiktif di luar scope lockout

---

### SC-07: Verifikasi OTP di Terminal (@manual)

- **Test ID:** `TC-LOGIN-007`
- **Covers:** `AC-07`, `AC-08`
- **Role:** `user`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna di `https://app.example.com/login`, kredensial valid, AUTH_CHALLENGE_MODE=otp-stdin.

**Input Data:**

- identifier: credential:user.email
- password: credential:user.password
- challengeMode: literal:otp-stdin

**Langkah:**

1. Buka halaman login
2. Isi field login (`email`, `username`, atau `user`)
3. Isi field password (`password`, `pass`, atau `kata sandi`)
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)
5. Ketik kode OTP di terminal saat diminta (halaman browser tetap terbuka)

**Hasil yang Diharapkan:**

- Setelah tantangan selesai, URL pathname mengandung `/dashboard` **DAN TIDAK** mengandung `/login`
- Form login tidak terlihat lagi
- Kode OTP diketik manusia di terminal — tidak diotomasi di pipeline. AUTH_CHALLENGE_MODE=otp-stdin hanya membantu `npm run auth:setup` (TTY wajib) menyimpan sesi.

---

## Catatan Pipeline (wajib diikuti Hermes)

**1) Capture locator catalog dulu (per website)**

Setiap app punya form/label berbeda. Jangan hardcode selector generik.

- Panggil `snapshot_page` (qa-playwright-kit):
  - url: `https://app.example.com/login`
  - featureName: `auth`
  - pageName: `login`
- Catalog: `selector-catalog/auth/login.{json,aria.yml}`
- Generator pakai locator dari catalog + live verify (playwright-cli / browser_* MCP)
- Path A (default): inline locator dari catalog — **tanpa POM**
- Path B (opsional nanti): `generate_page_object` + register fixture

**2) Role, env, challenge**

- Akun kredensial default: role **`user`** (`TEST_USER_*`) — dipakai mode pipeline **general**
- Role aktif di requirement ini: `user` (roles: user)
- Multi-role: tambah via `npm run env:edit` + metadata Role scope (jangan buat role bernama `general`)
- Auth file: `.auth/{APP_ENV}/<role>.json` (helper: `authStatePath('<role>')`)
- Kredensial hanya dari env (`TEST_USER_*` / `{ROLE}_*`) — jangan hardcode secret
- Selector environment: **APP_ENV** saja (`npm run env:status` / `env:use`)
- AUTH_CHALLENGE_MODE=otp-stdin — bantu sesi via `npm run auth:setup` / `auth:setup:headed`; skenario tantangan tetap (@manual)

**3) Dashboard columns (jangan campur)**

- **Test Step** = teks langkah skenario verbatim (aksi UI). Dilarang menaruh nilai Input Data di judul `test.step`.
- **Input Data** = blok input skenario (`credential:` / `literal:` / `seed:` / `fixture:`) via `setTestMetadata.inputData`.
- **Expected** = hasil yang diharapkan verbatim. Pass: `captureActualResult` = string yang sama.

**4) Output pipeline**

- Plan: `specs/login-test-plan.md`
- Spec: `tests/login*.spec.ts`
- Report: `artifacts/reports/pipeline-report-*.md` + `artifacts/reports/custom-dashboard.html`
