# REQ-AUTH-CAPTCHA: Login — captcha-browser — Target App

<!--
  Catalog AUTH_CHALLENGE_MODE=captcha-browser. Setup wizard menulis requirements/login.md dari mode yang dipilih.
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
- **Feature:** login-captcha-browser

## Kriteria Penerimaan

- **AC-01:** Form login menolak submit ketika field identifier (email/username/phone) kosong.
- **AC-02:** Form login menolak submit ketika field password kosong.
- **AC-03:** Form login menolak submit ketika identifier dan password kosong.
- **AC-04:** Form login menolak identifier yang hanya spasi (diperlakukan kosong).
- **AC-05:** Form login menolak identifier dengan format tidak valid (bukan email/username/phone yang diterima aplikasi).
- **AC-06:** Login gagal dengan user fiktif menampilkan pesan error observable, tetap di halaman login, dan akun role `user` tidak terkunci.
- **AC-07:** Login berhasil dengan kredensial valid me-redirect ke path `/dashboard` (assert pathname, bukan URL dengan `?redirect=`) dan session tersimpan di `.auth/{APP_ENV}/user.json`.
- **AC-08:** Setelah password, tantangan captcha-browser diselesaikan manusia; skenario ditandai (@manual) karena OTP/CAPTCHA tidak diotomasi di pipeline (AUTH_CHALLENGE_MODE hanya untuk auth:setup).
- **AC-09:** Form login menyediakan tombol/icon toggle show/hide password yang mengubah atribut type input antara password dan text.
- **AC-10:** Sistem secara otomatis memotong (trim) karakter spasi di awal dan akhir identifier pada saat submit sehingga login dengan kredensial valid tetap berhasil.
- **AC-11:** Form login dapat di-submit menggunakan penekanan tombol keyboard Enter ketika fokus berada pada input field.
- **AC-12:** Checkbox "Ingat Saya" (Remember Me) dapat di-toggle status checked dan unchecked-nya oleh pengguna.
- **AC-13:** Identifier email bersifat case-insensitive sehingga input kredensial valid berhuruf kapital tetap berhasil login ke `/dashboard`.
- **AC-14:** Tautan bantuan sekunder seperti "Lupa Kata Sandi?" dan "Daftar Akun" tampil di halaman login dengan URL target yang valid.

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

### SC-07: Verifikasi CAPTCHA di Browser (@manual)

- **Test ID:** `TC-LOGIN-007`
- **Covers:** `AC-07`, `AC-08`
- **Role:** `user`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna di `https://app.example.com/login`, kredensial valid, AUTH_CHALLENGE_MODE=captcha-browser.

**Input Data:**

- identifier: credential:user.email
- password: credential:user.password
- challengeMode: literal:captcha-browser

**Langkah:**

1. Buka halaman login
2. Isi field login (`email`, `username`, atau `user`)
3. Isi field password (`password`, `pass`, atau `kata sandi`)
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)
5. Selesaikan CAPTCHA di browser (terminal tidak bisa mengisi CAPTCHA)

**Hasil yang Diharapkan:**

- Setelah tantangan selesai, URL pathname mengandung `/dashboard` **DAN TIDAK** mengandung `/login`
- Form login tidak terlihat lagi
- CAPTCHA tidak bisa diisi dari terminal atau CI — skenario tetap (@manual). AUTH_CHALLENGE_MODE=captcha-browser hanya membantu `npm run auth:setup:headed` pause di browser sampai manusia selesai.

---

### SC-08: Toggle Visibilitas Password Show dan Hide (@ui)

- **Test ID:** `TC-LOGIN-008`
- **Covers:** `AC-09`
- **Role:** `user`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna berada di halaman `https://app.example.com/login`.

**Input Data:**

- password: literal:MySecretPassword123!

**Langkah:**

1. Buka halaman login
2. Isi field password dengan `MySecretPassword123!`
3. Periksa tipe input password sebelum toggle
4. Klik icon atau tombol show password
5. Periksa tipe input password setelah toggle aktif
6. Klik icon atau tombol hide password sekali lagi
7. Periksa tipe input password setelah toggle nonaktif

**Hasil yang Diharapkan:**

- Field password awalnya memiliki atribut `type="password"`
- Setelah tombol show diklik, atribut input berubah menjadi `type="text"` dan nilai password terlihat di UI
- Setelah tombol hide diklik kembali, atribut input kembali menjadi `type="password"`
- Teks nilai password yang telah diinput tidak terhapus atau berubah

---

### SC-09: Login Berhasil dengan Identifier Mengandung Spasi Awal dan Akhir (@success)

- **Test ID:** `TC-LOGIN-009`
- **Covers:** `AC-10`
- **Role:** `user`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE BE`

**Prekondisi:** Akun pengguna valid terdaftar di sistem.

**Input Data:**

- identifier: literal:  test.user@example.com  
- password: credential:user.password

**Langkah:**

1. Buka halaman login
2. Isi field login dengan email yang memiliki karakter spasi di awal dan akhir (`  test.user@example.com  `)
3. Isi field password dengan password valid
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)

**Hasil yang Diharapkan:**

- Sistem otomatis melakukan trim pada nilai identifier tanpa menampilkan error validasi spasi
- URL pathname diarahkan ke `/dashboard`
- Form login tidak terlihat lagi di halaman

---

### SC-10: Submit Form Login via Penekanan Tombol Keyboard Enter (@success)

- **Test ID:** `TC-LOGIN-010`
- **Covers:** `AC-11`
- **Role:** `user`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna di `https://app.example.com/login`, belum login.

**Input Data:**

- identifier: credential:user.email
- password: credential:user.password

**Langkah:**

1. Buka halaman login
2. Isi field login (`email`, `username`, atau `user`)
3. Isi field password (`password`, `pass`, atau `kata sandi`)
4. Tekan tombol `Enter` pada keyboard saat kursor masih aktif di field password tanpa mengklik tombol submit

**Hasil yang Diharapkan:**

- Form login ter-submit secara otomatis via event keyboard
- URL pathname berpindah ke `/dashboard` dan tidak lagi berada di `/login`
- Tidak ada pesan error yang tampil

---

### SC-11: Interaksi Checkbox Ingat Saya Remember Me (@ui)

- **Test ID:** `TC-LOGIN-011`
- **Covers:** `AC-12`
- **Role:** `user`
- **Prioritas skenario:** `low`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna berada di halaman `https://app.example.com/login`.

**Input Data:**

- rememberMe: literal:true

**Langkah:**

1. Buka halaman login
2. Periksa status awal checkbox "Ingat Saya" atau "Remember Me"
3. Klik checkbox "Ingat Saya" untuk mencentang
4. Periksa status checkbox setelah diklik
5. Klik kembali checkbox "Ingat Saya" untuk membatalkan centang
6. Periksa status akhir checkbox

**Hasil yang Diharapkan:**

- Checkbox "Ingat Saya" tampil di area form login
- Saat pertama diklik, elemen checkbox berstatus `checked` (tercentang)
- Saat diklik kedua kali, elemen checkbox kembali berstatus `unchecked` (tidak tercentang)
- Tidak memicu reload halaman atau validasi error

---

### SC-12: Login Berhasil dengan Identifier Huruf Kapital Case-Insensitive (@success)

- **Test ID:** `TC-LOGIN-012`
- **Covers:** `AC-13`
- **Role:** `user`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE BE`

**Prekondisi:** Akun pengguna terdaftar dengan email huruf kecil atau campuran.

**Input Data:**

- identifier: literal:TEST.USER@EXAMPLE.COM
- password: credential:user.password

**Langkah:**

1. Buka halaman login
2. Isi field login dengan email berhuruf kapital penuh (`TEST.USER@EXAMPLE.COM`)
3. Isi field password dengan password valid
4. Klik tombol submit (`Masuk`, `Login`, `Sign in`, atau `Log in`)

**Hasil yang Diharapkan:**

- Sistem mengenali email secara case-insensitive tanpa memunculkan error "User tidak ditemukan"
- URL pathname berhasil berpindah ke `/dashboard`
- Dashboard ter-render dengan session aktif

---

### SC-13: Verifikasi Keberadaan dan Validitas Tautan Lupa Password dan Registrasi (@ui)

- **Test ID:** `TC-LOGIN-013`
- **Covers:** `AC-14`
- **Role:** `user`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna berada di halaman `https://app.example.com/login`.

**Input Data:**

- forgotPasswordHref: literal:/forgot-password
- registerHref: literal:/register

**Langkah:**

1. Buka halaman login
2. Periksa keberadaan elemen tautan "Lupa Kata Sandi?" atau "Forgot Password?"
3. Periksa nilai atribut `href` pada tautan lupa kata sandi
4. Periksa keberadaan elemen tautan "Daftar" atau "Sign Up"
5. Periksa nilai atribut `href` pada tautan pendaftaran

**Hasil yang Diharapkan:**

- Tautan lupa kata sandi tampil di halaman login dan atribut `href` mengarah ke path lupa password (misal `/forgot-password` atau memicu modal reset)
- Tautan registrasi akun baru tampil di halaman login dan atribut `href` mengarah ke path registrasi (misal `/register` atau `/signup`)
- Kedua tautan terlihat jelas dan berstatus enabled

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
- AUTH_CHALLENGE_MODE=captcha-browser — bantu sesi via `npm run auth:setup` / `auth:setup:headed`; skenario tantangan tetap (@manual)

**3) Dashboard columns (jangan campur)**

- **Test Step** = teks langkah skenario verbatim (aksi UI). Dilarang menaruh nilai Input Data di judul `test.step`.
- **Input Data** = blok input skenario (`credential:` / `literal:` / `seed:` / `fixture:`) via `setTestMetadata.inputData`.
- **Expected** = hasil yang diharapkan verbatim. Pass: `captureActualResult` = string yang sama.

**4) Output pipeline**

- Plan: `specs/login-test-plan.md`
- Spec: `tests/login*.spec.ts`
- Report: `artifacts/reports/pipeline-report-*.md` + `artifacts/reports/custom-dashboard.html`
