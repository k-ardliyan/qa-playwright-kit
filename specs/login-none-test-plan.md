# PLAN-AUTH-NONE: Test Plan for Login — none — Target App

## Metadata

- **Source requirement:** `requirements/auth/login-none.md`
- **Source requirement hash:** `20c9649ee2ca0cbea9459c16800593a001b66c096af47cb32fd579b55b681ebe`
- **Module:** `auth`
- **Feature:** `login-none`
- **Seed:** `credential:user.email`, `credential:user.password`

## Catalog Evidence

- **Page:** `home` | `artifacts/selector-catalog/login-none/home.json`

## Scenarios

### SC-01: Submit dengan Identifier Kosong (@automated)

- **Test ID:** `TC-LOGIN-001`
- **Covers:** `AC-01`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Navigate to /login
- Click submit button without filling identifier

**Assertions:**

- [requirement] Validation message menandai field identifier kosong

**Locator Intent:**

- button[type="submit"]

**Artifact Expectations:**

- screenshot on failure

**Cleanup:**

- none

**Unknowns:**

- none

### SC-02: Submit dengan Password Kosong (@automated)

- **Test ID:** `TC-LOGIN-002`
- **Covers:** `AC-02`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Fill identifier only
- Click submit

**Assertions:**

- [requirement] Validation message menandai field password kosong

**Locator Intent:**

- input[type="password"]
- button[type="submit"]

**Cleanup:**

- none

**Unknowns:**

- none

### SC-03: Submit dengan Identifier dan Password Kosong (@automated)

- **Test ID:** `TC-LOGIN-003`
- **Covers:** `AC-03`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Click submit on empty form

**Assertions:**

- [requirement] Form menolak submit; tetap di /login

**Cleanup:**

- none

**Unknowns:**

- none

### SC-04: Submit dengan Identifier Hanya Spasi (@automated)

- **Test ID:** `TC-LOGIN-004`
- **Covers:** `AC-04`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Fill identifier with spaces only
- Click submit

**Assertions:**

- [requirement] Diperlakukan kosong; form menolak submit

**Cleanup:**

- none

**Unknowns:**

- none

### SC-05: Submit dengan Identifier Format Tidak Valid (@automated)

- **Test ID:** `TC-LOGIN-005`
- **Covers:** `AC-05`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Fill identifier with invalid format
- Click submit

**Assertions:**

- [requirement] Form menolak identifier format tidak valid

**Cleanup:**

- none

**Unknowns:**

- none

### SC-06: Login Gagal dengan User Fiktif (@automated)

- **Test ID:** `TC-LOGIN-006`
- **Covers:** `AC-06`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Fill identifier with non-existent user
- Fill any password
- Click submit

**Assertions:**

- [requirement] Pesan error observable, tetap di /login

**Cleanup:**

- none

**Unknowns:**

- none

### SC-07: Login Berhasil dengan Kredensial Valid (@automated)

- **Test ID:** `TC-LOGIN-007`
- **Covers:** `AC-07`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Data Setup:**

- credential:user.email
- credential:user.password

**Actions:**

- Navigate to /login
- Fill valid credentials
- Click submit

**Assertions:**

- [requirement] URL pathname mengandung /dashboard dan tidak mengandung /login
- [live-verification] Form login tidak terlihat lagi

**Locator Intent:**

- input[type="email"]
- button[type="submit"]

**Cleanup:**

- none

**Unknowns:**

- none

### SC-08: Toggle Visibilitas Password Show dan Hide (@automated)

- **Test ID:** `TC-LOGIN-008`
- **Covers:** `AC-08`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Click toggle show/hide password
- Verify input type attribute changes

**Assertions:**

- [requirement] Atribut type input berubah antara password dan text

**Cleanup:**

- none

**Unknowns:**

- none

### SC-09: Login Berhasil dengan Identifier Mengandung Spasi Awal dan Akhir (@automated)

- **Test ID:** `TC-LOGIN-009`
- **Covers:** `AC-09`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Fill identifier padded with spaces
- Fill valid password
- Click submit

**Assertions:**

- [requirement] Login tetap berhasil (identifier di-trim)

**Cleanup:**

- none

**Unknowns:**

- none

### SC-10: Submit Form Login via Penekanan Tombol Keyboard Enter (@automated)

- **Test ID:** `TC-LOGIN-010`
- **Covers:** `AC-10`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Fill valid credentials
- Press Enter on input

**Assertions:**

- [requirement] Form ter-submit; redirect ke /dashboard

**Cleanup:**

- none

**Unknowns:**

- none

### SC-11: Interaksi Checkbox Ingat Saya Remember Me (@automated)

- **Test ID:** `TC-LOGIN-011`
- **Covers:** `AC-11`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Toggle remember-me checkbox twice

**Assertions:**

- [requirement] Checkbox dapat diubah checked/unchecked

**Cleanup:**

- none

**Unknowns:**

- none

### SC-12: Login Berhasil dengan Identifier Huruf Kapital Case-Insensitive (@automated)

- **Test ID:** `TC-LOGIN-012`
- **Covers:** `AC-12`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Fill identifier in uppercase
- Fill valid password
- Submit

**Assertions:**

- [requirement] Login berhasil ke /dashboard (case-insensitive)

**Cleanup:**

- none

**Unknowns:**

- none

### SC-13: Verifikasi Keberadaan dan Validitas Tautan Lupa Password dan Registrasi (@automated)

- **Test ID:** `TC-LOGIN-013`
- **Covers:** `AC-13`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Inspect secondary links on login page

**Assertions:**

- [requirement] Link "Lupa Kata Sandi?" dan "Daftar Akun" tampil dengan href valid

**Cleanup:**

- none

**Unknowns:**

- none

### SC-14: Akses Halaman Protected Tanpa Login Mengarahkan ke Login (@automated)

- **Test ID:** `TC-LOGIN-014`
- **Covers:** `AC-14`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Open protected page without session

**Assertions:**

- [requirement] Diarahkan ke /login tanpa konten protected

**Cleanup:**

- none

**Unknowns:**

- none

### SC-15: Sesi Tetap Aktif Setelah Reload Halaman (@automated)

- **Test ID:** `TC-LOGIN-015`
- **Covers:** `AC-15`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Data Setup:**

- Login sukses terlebih dahulu

**Actions:**

- Reload /dashboard

**Assertions:**

- [requirement] Pengguna tetap login di /dashboard

**Cleanup:**

- none

**Unknowns:**

- none

### SC-16: Navigasi Back Browser Setelah Login Tidak Mengakhiri Sesi (@automated)

- **Test ID:** `TC-LOGIN-016`
- **Covers:** `AC-16`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Login, navigate, go back

**Assertions:**

- [requirement] Sesi tetap aktif; tidak diminta login ulang

**Cleanup:**

- none

**Unknowns:**

- none

### SC-17: Klik Ganda Tombol Submit Tidak Memproses Login Dua Kali (@automated)

- **Test ID:** `TC-LOGIN-017`
- **Covers:** `AC-17`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Double-click submit button

**Assertions:**

- [requirement] Tombol disabled/loading; hanya satu proses auth

**Cleanup:**

- none

**Unknowns:**

- none

### SC-18: Identifier Berisi Karakter HTML dan Script Tidak Dieksekusi (@automated)

- **Test ID:** `TC-LOGIN-018`
- **Covers:** `AC-18`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Fill identifier with HTML/script payload
- Submit

**Assertions:**

- [requirement] Payload dirender sebagai teks, tidak dieksekusi, submit ditolak

**Cleanup:**

- none

**Unknowns:**

- none

### SC-19: Logout Mengakhiri Sesi dan Melindungi Halaman Kembali (@automated)

- **Test ID:** `TC-LOGIN-019`
- **Covers:** `AC-19`
- **Actor:** `user`
- **Auth Context:** `user`
- **Execution Mode:** `automated`

**Actions:**

- Login, logout, akses protected page

**Assertions:**

- [requirement] Sesi berakhir; diarahkan ke /login

**Cleanup:**

- none

**Unknowns:**

- none
