# REQ-XXX: [Judul Fitur Singkat]

<!--
  CARA PAKAI TEMPLATE INI (v2.0):
  1. Salin file ini → requirements/nama-fitur.md (ganti "nama-fitur" dengan nama file Anda)
  2. Ganti semua teks [dalam kurung siku] dengan isi Anda
  3. Hapus blok komentar ini sebelum commit
  4. Validasi: npm run validate:requirement -- requirements/nama-fitur.md

  CONTOH REQUIREMENT YANG BAIK:
  Lihat requirements/_GOOD_EXAMPLE.md

  CONTOH REQUIREMENT YANG BURUK (untuk perbandingan):
  Lihat requirements/_BAD_EXAMPLE.md
-->

## Metadata

| Field               | Wajib?       | Contoh nilai                                 | Keterangan                                                                                                |
| ------------------- | ------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Tags`              | ✅ Ya         | `#smoke #regression #ui`                     | Pisahkan dengan spasi. Dipakai filter test.                                                               |
| `Prioritas`         | ✅ Ya         | `high` / `medium` / `low`                    | Prioritas bisnis default untuk semua skenario.                                                            |
| `Auth state`        | ✅ Ya         | `unauthenticated` / `authenticated`          | Butuh login atau tidak.                                                                                   |
| `Halaman awal`      | ✅ Ya         | `/login`                                     | Path URL halaman pembuka scenario.                                                                        |
| `Module`            | ✅ **Wajib**  | `invoice` / `auth` / `account`               | Modul aplikasi yang ditest. Dipakai untuk grouping laporan dan coverage.                                  |
| `Feature`           | ⚪ Disarankan | `login` / `buat-invoice` / `approve-invoice` | Fitur spesifik dalam modul. Validator hanya memberi warning jika kosong (`metadata_feature_recommended`). |
| `Role scope`        | ⚪ Opsional   | `super-admin, finance`                       | Role bisnis yang terlibat. Isi jika fitur multi-role.                                                     |
| `Default role`      | ⚪ Opsional   | `finance`                                    | Role default untuk single-role authenticated.                                                             |
| `Risk level`        | ⚪ Opsional   | `high` / `medium` / `low`                    | Dampak jika fitur ini gagal di produksi. Dipakai Healer untuk prioritasi.                                 |
| `Environment scope` | ⚪ Opsional   | `staging` / `production` / `all`             | Environment mana yang relevan untuk requirement ini.                                                      |
| `Data scope`        | ⚪ Opsional   | `seed:invoice.pending`                       | Data khusus yang harus ada sebelum test bisa jalan.                                                       |

**Contoh Metadata:**

```markdown
- **Tags:** #finance #ui #regression
- **Prioritas:** high
- **Auth state:** authenticated
- **Halaman awal:** /finance/invoices
- **Module:** finance
- **Feature:** approve-invoice
- **Role scope:** super-admin, finance, hrd
- **Default role:** finance
- **Risk:** high
```

## Access Matrix

> Wajib diisi jika fitur melibatkan role bisnis (`Role scope`).

| Role        | Access | Expectation                                      |
| ----------- | ------ | ------------------------------------------------ |
| super-admin | allow  | Bisa menyetujui dan menolak seluruh invoice      |
| finance     | allow  | Bisa menyetujui invoice yang berstatus pending   |
| hrd         | deny   | Tidak memiliki akses ke halaman approval finance |

## Kriteria Penerimaan

> Daftar 3-7 kondisi yang harus **terbukti** agar fitur selesai.
> Setiap kriteria WAJIB memiliki ID eksplisit (`- **AC-XX:**`) dan **observable**.

- **AC-01:** Pengguna role finance dapat menyetujui invoice berstatus pending.
- **AC-02:** Status invoice berubah menjadi "Approved" dan terlihat di tabel setelah disetujui.
- **AC-03:** Pengguna role yang tidak berhak (misal: HRD) mendapatkan penolakan akses saat membuka halaman approval.

## Skenario Uji

> Setiap skenario = satu alur user dengan heading `### SC-XX: Nama Skenario (@type)`.
> Setiap skenario WAJIB mencantumkan `- **Test ID:**`, `- **Covers:**`, `**Langkah:**`, dan `**Hasil yang Diharapkan:**`.
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

- **Test ID:** `TC-INV-001`
- **Covers:** `AC-01`, `AC-02`
- **Role:** `finance`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE` `BE`

**Prekondisi:** Pengguna login sebagai `finance`, terdapat invoice berstatus pending.

**Input Data:**

- invoiceId: seed:invoice.pending
- note: literal:Approved for Q3 payout

**Langkah:**

1. Buka halaman detail invoice dari daftar `/finance/invoices`
2. Klik tombol "Setujui Invoice"
3. Masukkan catatan approval
4. Klik tombol "Konfirmasi Approval"

**Hasil yang Diharapkan:**

- Muncul notifikasi sukses "Invoice berhasil disetujui"
- Status badge invoice berubah menjadi "Approved"
- Tombol "Setujui Invoice" tidak lagi ditampilkan

---

### SC-02: HRD Ditolak Mengakses Halaman Approval (@access-restriction)

- **Test ID:** `TC-INV-002`
- **Covers:** `AC-03`
- **Role:** `hrd`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE` `BE`

**Prekondisi:** Pengguna login sebagai `hrd`.

**Input Data:**

- targetUrl: literal:/finance/invoices

**Langkah:**

1. Buka URL `/finance/invoices` secara langsung

**Hasil yang Diharapkan:**

- Halaman menampilkan pesan "Akses Ditolak" (403 Forbidden) atau diredirect ke `/dashboard`
- Tabel data invoice tidak dirender ke browser

---

### SC-03: Verifikasi SMS OTP Fisik (@manual)

- **Test ID:** `TC-INV-003`
- **Covers:** `AC-01`
- **Prioritas skenario:** `low`

**Prekondisi:** Approval bernilai tinggi memerlukan otorisasi 2FA SMS.

**Input Data:**

- otpCode: literal:dynamic-sms-code

**Langkah:**

1. Terima SMS OTP pada handset fisik
2. Masukkan kode 6-digit ke modal konfirmasi

**Hasil yang Diharapkan:**

- Transaksi disetujui — tidak dapat diotomasi karena memerlukan penerimaan SMS fisik pada perangkat seluler eksternal

---

## ✅ Checklist Sebelum Simpan

- [ ] Judul `# REQ-XXX: ...` ada di baris pertama
- [ ] Section `## Metadata` terisi (Tags, Prioritas, Auth state, Halaman awal, Module, Feature)
- [ ] Jika `Role scope` diisi, tabel `## Access Matrix` disediakan
- [ ] Setiap item di `## Kriteria Penerimaan` memiliki format `- **AC-XX:** [deskripsi]`
- [ ] Setiap skenario memiliki `- **Test ID:** \`TC-XXX-NNN\``
- [ ] Setiap skenario memiliki `- **Covers:** \`AC-XX\`` yang merujuk ke AC yang sah
- [ ] Skenario multi-role memiliki `- **Role:** \`role-name\`` (parser requirement membaca `Role:`, bukan `Actor:`)
- [ ] Input data menggunakan prefix provenance (`seed:`, `credential:`, `fixture:`, `literal:`)
- [ ] Skenario non-otomatis ditandai `(@manual)` dengan alasan di Hasil yang Diharapkan
- [ ] File tervalidasi: `npm run validate:requirement -- requirements/nama-fitur.md`
