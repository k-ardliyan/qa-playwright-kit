# REQ-INV-001: Approval Invoice Finance

## Metadata

| Field        | Nilai                      |
| ------------ | -------------------------- |
| Tags         | `#finance #ui #regression` |
| Prioritas    | high                       |
| Auth state   | authenticated              |
| Halaman awal | `/finance/invoices`        |
| Module       | finance                    |
| Feature      | approve-invoice            |
| Role scope   | super-admin, finance, hrd  |
| Default role | finance                    |
| Risk level   | high                       |
| Data scope   | `seed:invoice.pending`     |

## Access Matrix

| Role        | Access | Expectation                                      |
| ----------- | ------ | ------------------------------------------------ |
| super-admin | allow  | Bisa menyetujui dan menolak seluruh invoice      |
| finance     | allow  | Bisa menyetujui invoice yang berstatus pending   |
| hrd         | deny   | Tidak memiliki akses ke halaman approval finance |

## Kriteria Penerimaan

| ID    | Kriteria                                                                                      |
| ----- | --------------------------------------------------------------------------------------------- |
| AC-01 | Pengguna role finance dapat menyetujui invoice berstatus pending.                             |
| AC-02 | Status invoice berubah menjadi "Approved" dan terlihat di tabel setelah disetujui.            |
| AC-03 | Pengguna role yang tidak berhak (HRD) mendapat penolakan akses saat membuka halaman approval. |

## Skenario Uji

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

## Checklist Sebelum Simpan

- [ ] Judul `# REQ-XXX: ...` ada di baris pertama
- [ ] Tabel `## Metadata` terisi (Tags, Prioritas, Auth state, Halaman awal, Module, Feature)
- [ ] Jika `Role scope` diisi, tabel `## Access Matrix` disediakan
- [ ] Tabel `## Kriteria Penerimaan` memiliki kolom `ID` dengan format `AC-XX`
- [ ] Setiap skenario memiliki baris `Test ID` dengan nilai `TC-XXX-NNN`
- [ ] Setiap skenario memiliki baris `Covers` yang merujuk AC yang sah
- [ ] Skenario multi-role memiliki baris `Role`
- [ ] Input data memakai prefix provenance (`seed:`, `credential:`, `fixture:`, `literal:`)
- [ ] Skenario non-otomatis ditandai `(@manual)` dengan alasan di `Hasil yang Diharapkan`
- [ ] File tervalidasi: `npm run validate:requirement`
