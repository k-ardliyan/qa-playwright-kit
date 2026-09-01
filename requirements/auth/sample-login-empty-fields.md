# REQ-AUTH-002: Login — Validasi Field Kosong

> **SAMPLE format (Path B / POM)** — bukan setup awal project kamu.
>
> - **Setup awal real (per website):** `requirements/login.md` di-generate `setup` Phase 7 (Path A).
> - Locator berbeda tiap app → pipeline wajib `snapshot_page` dulu, baru Plan/Generate.
> - File ini hanya latihan format requirement + empty-field scenarios.

## Metadata

- **Tags:** #auth #ui #regression #sample
- **Prioritas:** medium
- **Auth state:** unauthenticated
- **Halaman awal:** /login
- **Module:** auth
- **Feature:** login
- **POM yang dibutuhkan:** loginPage <!-- Path B sample only; setup awal pakai Path A tanpa POM -->

## Kriteria Penerimaan

- **AC-01:** Form login menolak submit ketika field username/email kosong.
- **AC-02:** Form login menolak submit ketika field password kosong.
- **AC-03:** Pesan validasi tampil di dekat field yang kosong.
- **AC-04:** CAPTCHA aktif di halaman login diverifikasi secara manual.

## Skenario Uji

### SC-01: Submit dengan Username Kosong (@failure)

- **Test ID:** `TC-AUTH-EXT-001`
- **Covers:** `AC-01`, `AC-03`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna berada di halaman login, belum login

**Input Data:**

- username: (kosong)
- password: ValidPass123!

**Langkah:**

1. Buka halaman login
2. Biarkan field username/email kosong
3. Isi field password dengan nilai valid
4. Klik tombol login

**Hasil yang Diharapkan:**

- Pengguna tetap di halaman login (URL mengandung `/login`)
- Pesan validasi terkait username/email tampil di layar

---

### SC-02: Submit dengan Password Kosong (@failure)

- **Test ID:** `TC-AUTH-EXT-002`
- **Covers:** `AC-02`, `AC-03`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna berada di halaman login, belum login

**Input Data:**

- username: qa.test@example.com
- password: (kosong)

**Langkah:**

1. Buka halaman login
2. Isi field username/email dengan kredensial valid
3. Biarkan field password kosong
4. Klik tombol login

**Hasil yang Diharapkan:**

- Pengguna tetap di halaman login (URL mengandung `/login`)
- Pesan validasi terkait password tampil di layar

---

### SC-03: Submit dengan Username dan Password Kosong (@failure)

- **Test ID:** `TC-AUTH-EXT-003`
- **Covers:** `AC-01`, `AC-02`, `AC-03`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna berada di halaman login, belum login

**Input Data:**

- username: (kosong)
- password: (kosong)

**Langkah:**

1. Buka halaman login
2. Biarkan field username/email kosong
3. Biarkan field password kosong
4. Klik tombol login

**Hasil yang Diharapkan:**

- Pengguna tetap di halaman login (URL mengandung `/login`)
- Pesan validasi untuk username/email tampil di layar
- Pesan validasi untuk password tampil di layar

---

### SC-04: Verifikasi CAPTCHA pada Login (@manual)

- **Test ID:** `TC-AUTH-EXT-004`
- **Covers:** `AC-04`
- **Prioritas skenario:** `low`
- **Layer terdampak:** `FE`

**Prekondisi:** CAPTCHA aktif di halaman login

**Langkah:**

1. Buka halaman login
2. Isi kredensial valid
3. Selesaikan CAPTCHA secara manual

**Hasil yang Diharapkan:**

- Login berhasil hanya setelah CAPTCHA benar — verifikasi manual diperlukan karena CAPTCHA tidak
  dapat diotomasi
