# REQ-XXX: [Judul Fitur Singkat]

<!--
  CARA PAKAI TEMPLATE INI (v3.1 — format tabel):
  1. Salin file ini → requirements/nama-fitur.md (ganti "nama-fitur" dengan nama file Anda)
  2. Ganti semua teks [dalam kurung siku] dengan isi Anda
  3. Hapus blok komentar ini sebelum commit
  4. Validasi: npm run validate:requirement

  ATURAN TABEL:
  - Pisahkan beberapa item dalam satu sel dengan <br>
  - Escape karakter pipe di dalam sel dengan \|
  - Label kolom kiri WAJIB persis seperti contoh (parser membacanya)

  CATATAN: setiap field dan tag yang didokumentasikan di file ini BENAR-BENAR
  dibaca parser. Jangan menambah field yang tidak diproses engine.
-->

## Metadata

| Field        | Nilai                    |
| ------------ | ------------------------ |
| Tags         | `#smoke #regression #ui` |
| Prioritas    | `high`                   |
| Auth state   | `unauthenticated`        |
| Halaman awal | `/login`                 |
| Module       | `invoice`                |
| Feature      | `approve-invoice`        |
| Role scope   | `super-admin, finance`   |
| Default role | `finance`                |
| Risk level   | `high`                   |
| Data scope   | `seed:invoice.pending`   |

**Keterangan field Metadata:**

| Field             | Wajib?        | Keterangan                                                                                          |
| ----------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| Tags              | ✅ Ya         | Dipisahkan spasi. Dipakai filter test.                                                              |
| Prioritas         | ✅ Ya         | `high` / `medium` / `low`. Prioritas bisnis default untuk semua skenario.                           |
| Auth state        | ✅ Ya         | `unauthenticated` / `authenticated`. Butuh login atau tidak.                                        |
| Halaman awal      | ✅ Ya         | Path URL halaman pembuka scenario.                                                                  |
| Module            | ✅ **Wajib**  | Modul aplikasi. Dipakai untuk grouping laporan dan coverage.                                        |
| Feature           | ⚪ Disarankan | Fitur spesifik dalam modul. Validator memberi warning jika kosong (`metadata_feature_recommended`). |
| Role scope        | ⚪ Opsional   | Role bisnis yang terlibat. Isi jika fitur multi-role.                                               |
| Default role      | ⚪ Opsional   | Role default untuk single-role authenticated.                                                       |
| Risk level        | ⚪ Opsional   | Dampak jika fitur gagal di produksi. Dipakai Healer untuk prioritasi.                               |
| Data scope        | ⚪ Opsional   | Data khusus yang harus ada sebelum test bisa jalan (mis. `seed:invoice.pending`).                   |
| Environment scope | ⚪ Opsional   | Batasi requirement ke environment tertentu (mis. `staging, production`).                            |

## Access Matrix

> Wajib diisi jika fitur melibatkan role bisnis (`Role scope`).

| Role        | Access | Expectation                                      |
| ----------- | ------ | ------------------------------------------------ |
| super-admin | allow  | Bisa menyetujui dan menolak seluruh invoice      |
| finance     | allow  | Bisa menyetujui invoice yang berstatus pending   |
| hrd         | deny   | Tidak memiliki akses ke halaman approval finance |

## Kriteria Penerimaan

> Daftar 3-7 kondisi yang harus **terbukti** agar fitur selesai.
> Setiap kriteria WAJIB memiliki ID eksplisit (`AC-XX`) dan **observable**.

| ID    | Kriteria                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------- |
| AC-01 | Pengguna role finance dapat menyetujui invoice berstatus pending.                                       |
| AC-02 | Status invoice berubah menjadi "Approved" dan terlihat di tabel setelah disetujui.                      |
| AC-03 | Pengguna role yang tidak berhak (misal: HRD) mendapatkan penolakan akses saat membuka halaman approval. |

## Skenario Uji

> Setiap skenario = satu alur user dengan heading `### SC-XX: Nama Skenario (@type)`.
> Setiap skenario WAJIB memuat baris `Test ID`, `Covers`, `Langkah`, dan `Hasil yang Diharapkan`.
>
> **Tipe skenario:**
> - `(@success)` — happy path, alur normal berhasil
> - `(@failure)` — negative path, input salah, validasi gagal
> - `(@access-restriction)` — role tidak berhak, akses ditolak
> - `(@manual)` — tidak bisa diotomasi (CAPTCHA, SMS OTP fisik, biometric, dsb)
> - Capability tags tambahan: `(@network)`, `(@network-assert)`, `(@hybrid)`, `(@download)`, `(@upload)`, `(@file-content)`.
>
> **Input Provenance (Penting):**
> Gunakan prefix eksplisit untuk input data:
> - `seed:<entity>.<state>` (contoh: `seed:invoice.pending`)
> - `credential:<role>.<field>` (contoh: `credential:user.email`)
> - `fixture:<subpath>` (contoh: `fixture:pdf/sample.pdf`)
> - `literal:<value>` (contoh: `literal:INV-2026-001`)

### SC-01: Finance Menyetujui Invoice Pending (@success)

| Field                 | Nilai                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-INV-001`                                                                                                                                                               |
| Covers                | `AC-01`, `AC-02`                                                                                                                                                           |
| Role                  | `finance`                                                                                                                                                                  |
| Prioritas skenario    | `high`                                                                                                                                                                     |
| Layer terdampak       | `FE` `BE`                                                                                                                                                                  |
| Prekondisi            | Pengguna login sebagai `finance`, terdapat invoice berstatus pending.                                                                                                      |
| Input Data            | `invoiceId: seed:invoice.pending`<br>`note: literal:Approved for Q3 payout`                                                                                                |
| Langkah               | 1. Buka halaman detail invoice dari daftar `/finance/invoices`<br>2. Klik tombol "Setujui Invoice"<br>3. Masukkan catatan approval<br>4. Klik tombol "Konfirmasi Approval" |
| Hasil yang Diharapkan | - Muncul notifikasi sukses "Invoice berhasil disetujui"<br>- Status badge invoice berubah menjadi "Approved"<br>- Tombol "Setujui Invoice" tidak lagi ditampilkan          |

> Multi-tenant login: nilai tenant yang diketik di form memakai `credential:<role>.company`
> (dibaca dari `{ROLE}_COMPANY`), bukan `literal:`. Lihat `requirements/auth/login-multi-tenant.md`.

---

### SC-02: HRD Ditolak Mengakses Halaman Approval (@access-restriction)

| Field                 | Nilai                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-INV-002`                                                                                                                                  |
| Covers                | `AC-03`                                                                                                                                       |
| Role                  | `hrd`                                                                                                                                         |
| Prioritas skenario    | `medium`                                                                                                                                      |
| Layer terdampak       | `FE` `BE`                                                                                                                                     |
| Prekondisi            | Pengguna login sebagai `hrd`.                                                                                                                 |
| Input Data            | `targetUrl: literal:/finance/invoices`                                                                                                        |
| Langkah               | 1. Buka URL `/finance/invoices` secara langsung                                                                                               |
| Hasil yang Diharapkan | - Halaman menampilkan pesan "Akses Ditolak" (403 Forbidden) atau diredirect ke `/dashboard`<br>- Tabel data invoice tidak dirender ke browser |

---

### SC-03: Verifikasi SMS OTP Fisik (@manual)

| Field                 | Nilai                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-INV-003`                                                                                                          |
| Covers                | `AC-01`                                                                                                               |
| Prioritas skenario    | `low`                                                                                                                 |
| Prekondisi            | Approval bernilai tinggi memerlukan otorisasi 2FA SMS.                                                                |
| Input Data            | `otpCode: literal:dynamic-sms-code`                                                                                   |
| Langkah               | 1. Terima SMS OTP pada handset fisik<br>2. Masukkan kode 6-digit ke modal konfirmasi                                  |
| Hasil yang Diharapkan | - Transaksi disetujui — tidak dapat diotomasi karena memerlukan penerimaan SMS fisik pada perangkat seluler eksternal |

---

## ✅ Checklist Sebelum Simpan

- [ ] Judul `# REQ-XXX: ...` ada di baris pertama
- [ ] Tabel `## Metadata` terisi (Tags, Prioritas, Auth state, Halaman awal, Module, Feature)
- [ ] Jika `Role scope` diisi, tabel `## Access Matrix` disediakan
- [ ] Setiap item di `## Kriteria Penerimaan` berada di tabel `| ID | Kriteria |` dengan ID `AC-XX`
- [ ] Setiap skenario memiliki baris `| Test ID | \`TC-XXX-NNN\` |`
- [ ] Setiap skenario memiliki baris `| Covers | \`AC-XX\` |` yang merujuk ke AC yang sah
- [ ] Skenario multi-role memiliki baris `| Role | \`role-name\` |` (parser requirement membaca `Role:`)
- [ ] Input data menggunakan prefix provenance (`seed:`, `credential:`, `fixture:`, `literal:`)
- [ ] Skenario non-otomatis ditandai `(@manual)` dengan alasan di `Hasil yang Diharapkan`
- [ ] Beberapa item dalam satu sel dipisah `<br>`; karakter pipe di-escape `\|`
- [ ] File tervalidasi: `npm run validate:requirement`
