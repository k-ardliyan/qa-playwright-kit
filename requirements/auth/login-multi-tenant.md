# REQ-AUTH-MT: Login Multi-Tenant (Company Code / Tenant Link)

<!--
  Catalog login multi-tenant — turunkan ke website kamu lewat `npm run setup` + snapshot_page.
  Locator berbeda per website: Generator WAJIB snapshot dulu, lalu live-verify selector.
  Jangan tulis password/secret di file ini.

  ⚠ STATUS: TEMPLATE — semua locator di bawah ASUMSI, belum diverifikasi ke aplikasi nyata.
  Sebelum Generate: jalankan `snapshot_page` untuk halaman login target, lalu ganti setiap
  langkah "Ketik ... di field X" dengan locator hasil snapshot. Spec yang di-generate dari
  file ini tanpa snapshot TIDAK boleh dianggap lolos verifikasi.
-->

## Metadata

- **Tags:** #auth #multi-tenant #regression
- **Prioritas:** high
- **Auth state:** unauthenticated
- **Halaman awal:** /login
- **Module:** auth
- **Feature:** login-multi-tenant
- **Risk:** high

## Kriteria Penerimaan

- **AC-01:** Login berhasil ketika tenant ditentukan lewat link (subdomain/path/query) dan sesi tersimpan untuk role tersebut.
- **AC-02:** Login berhasil ketika kode company diketik di form sebelum kredensial.
- **AC-03:** Kode company salah ditolak dengan pesan error observable; pengguna tetap di halaman login.
- **AC-04:** Kode company kosong pada form yang mewajibkannya ditolak (submit tidak diproses).
- **AC-05:** Sesi tenant A tidak dapat menampilkan data tenant B (isolasi lintas tenant).
- **AC-06:** Tenant aktif tetap sama setelah reload halaman (sesi terikat tenant).

## Skenario Uji

### SC-01: Login Berhasil via Tenant Link Subdomain (@success)

- **Test ID:** `TC-AUTH-MT-001`
- **Covers:** `AC-01`
- **Role:** `finance`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE` `BE`

**Prekondisi:** Role `finance` dikonfigurasi dengan `FINANCE_LOGIN_URL_PATH` absolut ke host tenant (mis. `https://acme.app.com/login`).

**Input Data:**

- email: credential:finance.email
- password: credential:finance.password

**Langkah:**

1. Buka halaman login role finance
2. Ketik email di field Email
3. Ketik password di field Password
4. Klik tombol "Masuk"

**Hasil yang Diharapkan:**

- URL berpindah ke halaman sukses tenant tersebut
- Nama/logo company tenant tampil di header aplikasi

---

### SC-02: Login Berhasil dengan Kode Company Diketik (@success)

- **Test ID:** `TC-AUTH-MT-002`
- **Covers:** `AC-02`
- **Role:** `finance`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE` `BE`

**Prekondisi:** Role `finance` dikonfigurasi dengan `FINANCE_COMPANY` dan halaman login memiliki field company/tenant.

**Input Data:**

- companyCode: credential:finance.company
- email: credential:finance.email
- password: credential:finance.password

**Langkah:**

1. Buka halaman login
2. Ketik kode company di field Company/Tenant
3. Ketik email di field Email
4. Ketik password di field Password
5. Klik tombol "Masuk"

**Hasil yang Diharapkan:**

- Login berhasil dan diarahkan ke halaman sukses
- Nama company pada halaman setelah login sama dengan kode company yang diketik

---

### SC-03: Kode Company Salah Ditolak (@failure)

- **Test ID:** `TC-AUTH-MT-003`
- **Covers:** `AC-03`
- **Role:** `finance`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE` `BE`

**Prekondisi:** Pengguna di halaman login yang memiliki field company/tenant.

**Input Data:**

- companyCode: literal:company-tidak-ada
- email: credential:finance.email
- password: credential:finance.password

**Langkah:**

1. Buka halaman login
2. Ketik kode company yang tidak terdaftar
3. Ketik email dan password yang valid
4. Klik tombol "Masuk"

**Hasil yang Diharapkan:**

- Muncul pesan error observable di halaman login
- URL tetap di halaman login dan sesi tidak dibuat

---

### SC-04: Kode Company Kosong Ditolak (@failure)

- **Test ID:** `TC-AUTH-MT-004`
- **Covers:** `AC-04`
- **Role:** `finance`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Field company/tenant bersifat wajib pada halaman login.

**Input Data:**

- companyCode: literal:
- email: credential:finance.email
- password: credential:finance.password

**Langkah:**

1. Buka halaman login
2. Biarkan field company/tenant kosong
3. Ketik email dan password
4. Klik tombol "Masuk"

**Hasil yang Diharapkan:**

- Submit tidak diproses; pesan validasi "wajib diisi" tampil di field company
- URL tetap di halaman login

---

### SC-05: Data Tenant Lain Tidak Terlihat (@access-restriction)

- **Test ID:** `TC-AUTH-MT-005`
- **Covers:** `AC-05`
- **Role:** `finance`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `BE`

**Prekondisi:** Pengguna login pada tenant A; terdapat data milik tenant B pada environment yang sama.

**Input Data:**

- targetUrl: literal:/dashboard
- foreignTenantMarker: literal:entitas-milik-tenant-B

**Langkah:**

1. Login pada tenant A
2. Buka halaman daftar data utama
3. Cari nama entitas yang hanya dimiliki tenant B

**Hasil yang Diharapkan:**

- Data tenant B tidak muncul di daftar
- Pencarian langsung ke URL data tenant B ditolak (403 atau redirect)

---

### SC-06: Tenant Aktif Bertahan Setelah Reload (@success)

- **Test ID:** `TC-AUTH-MT-006`
- **Covers:** `AC-06`
- **Role:** `finance`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Pengguna sudah login pada satu tenant.

**Input Data:**

- tenantName: credential:finance.company

**Langkah:**

1. Login pada tenant terkonfigurasi
2. Reload halaman
3. Periksa nama/logo company di header

**Hasil yang Diharapkan:**

- Nama company tetap sama setelah reload
- Pengguna tetap berada di halaman tenant, tidak diminta login ulang

---
