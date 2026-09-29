# REQ-AUTH-001: Login — Akun Valid ke Dashboard

> **Contoh requirement yang BAIK (v3.0 — format tabel)** — digunakan sebagai referensi untuk menulis requirement baru.
> File ini divalidasi `compile_requirement` dan `validate_requirement` dengan status success dan 0 warning.

## Metadata

| Field        | Nilai                        |
| ------------ | ---------------------------- |
| Tags         | #auth #ui #smoke #regression |
| Prioritas    | high                         |
| Auth state   | unauthenticated              |
| Halaman awal | /login                       |
| Module       | auth                         |
| Feature      | login-valid                  |

## Kriteria Penerimaan

| ID    | Kriteria                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| AC-01 | Pengguna dapat login dengan email dan password valid dan diredirect ke `/dashboard` dalam waktu < 3 detik.   |
| AC-02 | Setelah login berhasil, header dashboard menampilkan greeting dengan nama user dan session cookie tersimpan. |
| AC-03 | Login gagal dengan kredensial invalid menampilkan pesan error tanpa membocorkan eksistensi akun.             |
| AC-04 | Form login menolak submit ketika field email kosong.                                                         |
| AC-05 | Form login mengunci akun sementara setelah 5 kali gagal berturut-turut.                                      |
| AC-06 | Login pihak ketiga dengan Google OAuth diverifikasi secara manual.                                           |

## Skenario Uji

### SC-01: Login Berhasil dengan Email dan Password Valid (@success)

| Field                 | Nilai                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-AUTH-001`                                                                                                                                                                                        |
| Covers                | `AC-01`, `AC-02`                                                                                                                                                                                     |
| Prioritas skenario    | `high`                                                                                                                                                                                               |
| Layer terdampak       | `FE` `BE`                                                                                                                                                                                            |
| Prekondisi            | Pengguna berada di halaman `/login`, akun terdaftar dengan password valid, user belum login.                                                                                                         |
| Input Data            | `email: credential:user.email`<br>`password: credential:user.password`                                                                                                                               |
| Langkah               | 1. Ketik email valid di field Email<br>2. Ketik password valid di field Password<br>3. Klik tombol "Masuk"                                                                                           |
| Hasil yang Diharapkan | - URL browser berubah ke `/dashboard`<br>- Header dashboard menampilkan teks "Selamat datang"<br>- Tombol "Logout" terlihat di pojok kanan atas header<br>- Cookie `session_id` tersimpan di browser |

---

### SC-02: Login Gagal dengan Password Salah (@failure)

| Field                 | Nilai                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-AUTH-002`                                                                                                                                                              |
| Covers                | `AC-03`                                                                                                                                                                    |
| Prioritas skenario    | `high`                                                                                                                                                                     |
| Layer terdampak       | `FE` `BE`                                                                                                                                                                  |
| Prekondisi            | Pengguna berada di `/login`, akun terdaftar, password yang dimasukkan salah.                                                                                               |
| Input Data            | `email: credential:user.email`<br>`password: literal:WrongPassword123!`                                                                                                    |
| Langkah               | 1. Ketik email di field Email<br>2. Ketik password salah di field Password<br>3. Klik tombol "Masuk"                                                                       |
| Hasil yang Diharapkan | - URL tetap di `/login`<br>- Muncul pesan error merah di bawah form: "Email atau password salah"<br>- Field password dikosongkan kembali<br>- Tombol "Masuk" kembali aktif |

---

### SC-03: Submit dengan Email Kosong (@failure)

| Field                 | Nilai                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-AUTH-003`                                                                                                                      |
| Covers                | `AC-04`                                                                                                                            |
| Prioritas skenario    | `medium`                                                                                                                           |
| Layer terdampak       | `FE`                                                                                                                               |
| Prekondisi            | Pengguna di `/login`, field Email kosong.                                                                                          |
| Input Data            | `email: literal:`<br>`password: credential:user.password`                                                                          |
| Langkah               | 1. Biarkan field Email kosong<br>2. Ketik password di field Password<br>3. Klik tombol "Masuk"                                     |
| Hasil yang Diharapkan | - Submit form ditolak dan validasi muncul di field Email<br>- URL tetap di `/login`<br>- Tidak ada request otentikasi yang dikirim |

---

### SC-04: Akun Terkunci Setelah 5 Kali Gagal (@failure)

| Field                 | Nilai                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test ID               | `TC-AUTH-004`                                                                                                                                          |
| Covers                | `AC-05`                                                                                                                                                |
| Prioritas skenario    | `medium`                                                                                                                                               |
| Layer terdampak       | `FE` `BE`                                                                                                                                              |
| Prekondisi            | Pengguna di `/login`, akun sudah mengalami 4 kali kegagalan login sebelumnya.                                                                          |
| Input Data            | `email: credential:user.email`<br>`password: literal:WrongPassword123!`                                                                                |
| Langkah               | 1. Ketik email di field Email<br>2. Ketik password salah di field Password<br>3. Klik tombol "Masuk"                                                   |
| Hasil yang Diharapkan | - URL tetap di `/login`<br>- Muncul pesan error "Akun terkunci karena 5 kali gagal. Coba lagi dalam 15 menit."<br>- Form login dinonaktifkan sementara |

---

### SC-05: Login dengan Google OAuth (@manual)

| Field                 | Nilai                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-AUTH-005`                                                                                                                                                           |
| Covers                | `AC-06`                                                                                                                                                                 |
| Prioritas skenario    | `low`                                                                                                                                                                   |
| Prekondisi            | Pengguna di `/login`, memiliki akun Google aktif.                                                                                                                       |
| Input Data            | `provider: literal:google`                                                                                                                                              |
| Langkah               | 1. Klik tombol "Login dengan Google"<br>2. Pilih akun Google di popup otorisasi eksternal<br>3. Setujui izin akses aplikasi                                             |
| Hasil yang Diharapkan | - Sesi login terbuat dan diredirect ke `/dashboard` — verifikasi manual diperlukan karena interaksi popup OAuth dan verifikasi Google eksternal tidak diotomasi dari CI |
