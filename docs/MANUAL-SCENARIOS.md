# Panduan Skenario `@manual`

Panduan ini untuk QA yang ingin tahu kapan dan bagaimana menandai skenario sebagai `(@manual)`.

---

## Apa itu Skenario `@manual`?

Skenario yang ditandai `(@manual)` di judul `### SC-XX: ...` berarti tidak bisa diotomasi dengan Playwright. Pipeline AI tetap mengenali dan memprosesnya, tapi Generator akan menghasilkan `test.skip(true, 'Manual: <alasan>')` — bukan test yang bisa dijalankan.

```markdown
### SC-04: Login dengan Google OAuth (@manual)
```

---

## Tipe Skenario — Konteks Lebih Luas

`(@manual)` adalah salah satu dari empat tipe skenario resmi:

| Tag                     | Artinya                                     | Di-generate sebagai              |
| ----------------------- | ------------------------------------------- | -------------------------------- |
| `(@success)`            | Happy path — alur normal berhasil           | Test penuh                       |
| `(@failure)`            | Negative path — input salah, validasi gagal | Test dengan assertion error      |
| `(@access-restriction)` | Role tidak berhak, akses ditolak            | Test yang assert penolakan akses |
| `(@manual)`             | Tidak bisa diotomasi                        | `test.skip` dengan alasan        |

Jika tidak diberi tag, skenario dianggap `(@success)` secara default.

> Catatan: parser requirement mengembalikan `scenarioType: 'general'` untuk skenario tanpa tag tipe — bukan `'success'` (lihat `parse-requirement-scenarios.ts`).

---

## Kapan Pakai `(@manual)`?

Tandai `(@manual)` kalau skenario membutuhkan salah satu dari ini:

| Situasi                | Contoh                              | Kenapa Manual                              |
| ---------------------- | ----------------------------------- | ------------------------------------------ |
| CAPTCHA / reCAPTCHA    | Login form pakai reCAPTCHA          | Tidak bisa diotomasi tanpa bypass (ilegal) |
| OTP / SMS verification | Login dengan SMS OTP                | Butuh akses ke HP asli                     |
| Email verification     | Konfirmasi signup via email link    | Butuh inbox asli                           |
| Payment gateway        | Charge kartu kredit                 | Butuh kartu test spesifik + 3DS callback   |
| Biometric              | Login sidik jari / Face ID          | Tidak bisa disimulasi di CI                |
| PDF **layout** visual  | Cek spasi, alignment, tipografi PDF | Butuh verifikasi mata manusia              |
| Hardware interaction   | Scan barcode, print struk           | Tidak ada di environment CI                |
| Real-world timing      | Tunggu 24 jam untuk expiry test     | Tidak feasible di CI                       |

---

## Kapan TIDAK Pakai `(@manual)`?

Jangan pakai `(@manual)` hanya karena "ribet" — biasanya bisa diotomasi dengan effort tambahan.

- Login biasa → tinggal cari selector + isi form
- Klik tombol + lihat alert → `page.on('dialog')` bisa handle
- **Upload file** → **bukan manual**. Pakai fixture-first: `setInputFiles()` / `uploadFixture()` / `uploadViaChooser()` dari `@/support/pw` dengan path di `tests/data/`. Tag skenario `(@upload)`. **Jangan** pause headed untuk OS file picker.
- **Download file** → `downloadAndSave()` + envelope assert (`assertDownloadedEnvelope`). Tag `(@download)`.
- **PDF teks / Excel struktur** → **bisa diotomasi** dengan `@file-content`: `assertPdfContains` / `extractPdfText` / `assertExcelHeaders` / `readExcelSummary`. Token/needle **milik skenario** (dari Hasil yang Diharapkan) — bukan skema domain tetap.
- **Cek payload/response API setelah klik submit** → **bukan manual**. Tag `(@network-assert)` + `waitAndAssertApi` / contract partial. Mock error API = `(@network)`, bukan live assert.
- Drag-and-drop → `page.dragAndDrop()` bisa handle

### File / PDF / Excel — manual vs automatable

| Kebutuhan                                           | Tag                 | Manual?          | Cara otomasi                                                 |
| --------------------------------------------------- | ------------------- | ---------------- | ------------------------------------------------------------ |
| Upload lampiran / import                            | `(@upload)`         | **Tidak**        | Fixture di `tests/data/` + `uploadFixture` / `setInputFiles` |
| Download export                                     | `(@download)`       | **Tidak**        | `downloadAndSave` + `assertDownloadedEnvelope`               |
| Isi teks PDF (token, nomor, label dari requirement) | `(@file-content)`   | **Tidak**        | `assertPdfContains(path, needlesFromScenario)`               |
| Header/kolom Excel dari requirement                 | `(@file-content)`   | **Tidak**        | `assertExcelHeaders(path, headersFromScenario)`              |
| Live payload + response setelah aksi UI             | `(@network-assert)` | **Tidak**        | `waitAndAssertApi` / partial contract (keys dari skenario)   |
| Mock HTTP 500 / offline untuk error UX              | `(@network)`        | **Tidak**        | `mockServerError` / `mockAbort`                              |
| Layout visual PDF (spasi, alignment, warna)         | `(@manual)`         | **Ya**           | Review mata manusia; bukan `assertPdfContains`               |
| OS file-picker pause (headed)                       | —                   | **Anti-pattern** | Selalu fixture-first; tidak ada pause pipeline               |

**Prinsip:** fixture-first + local-first. MCP tools (`inspect_file`, `extract_pdf_text`, `read_excel_summary`, `list_test_fixtures`, `browser_network_requests`) untuk **inspect-time** saja; test yang di-commit tetap assert lewat helper `@/support/pw`.

Kalau ragu, tanya maintainer framework dulu sebelum tandai `(@manual)`.

---

## Cara Tandai `(@manual)`

### Step 1: Tambah tag di judul skenario

```markdown
### SC-04: Login dengan Google OAuth (@manual)
```

### Step 2: Jelaskan alasan di bagian Hasil

```markdown
### SC-04: Login dengan Google OAuth (@manual)

**Prekondisi:** Pengguna di halaman login, Google OAuth aktif

**Langkah:**

1. Buka halaman login
2. Klik tombol "Login dengan Google"
3. Ikuti flow OAuth Google

**Hasil:**

- Login berhasil dan user diarahkan ke dashboard — tidak bisa diotomasi
  karena butuh akses akun Google nyata dan OAuth consent screen
```

Validator akan memberi warning jika `@manual` tidak punya alasan di bagian Hasil.

---

## Cara Cek Skenario `@manual` yang Pending

```bash
npm run manual:check
```

Output menampilkan semua skenario `(@manual)` di **seluruh tree** `requirements/**` (nested domain folders), skip file `_*.md` dan `README.md`, beserta alasannya.

---

## Do's and Don'ts

**Lakukan:**

- Tulis alasan yang jelas di bagian Hasil — bukan hanya "manual"
- Review skenario `(@manual)` secara berkala — banyak yang bisa diotomasi setelah tools berkembang
- Pertimbangkan `(@access-restriction)` untuk skenario "role tidak berhak akses" — itu bisa diotomasi

**Hindari:**

- Tandai `(@manual)` untuk hal yang sebenarnya bisa diotomasi Playwright
- Tambah `(@manual)` tanpa alasan jelas di Hasil — validator akan warning
- Salah gunakan `(@manual)` padahal seharusnya `(@failure)` atau `(@access-restriction)`

---

## Kapan Eskalasi ke Maintainer Framework

Tanya Framework Maintainer kalau:

- Tidak yakin apakah skenario bisa diotomasi
- Butuh setup khusus (simulator OTP, sandbox payment gateway)
- Ingin convert skenario `(@manual)` jadi automatable tapi butuh library baru

---

## Lihat Juga

- [requirements/_TEMPLATE.md](../requirements/_TEMPLATE.md) — format skenario lengkap
- [requirements/README.md](../requirements/README.md) — panduan tipe skenario dan role-aware
- [docs/WRITING-REQUIREMENTS.md](WRITING-REQUIREMENTS.md) — cara menulis requirement
- [docs/GUIDE.md](GUIDE.md) — panduan QA utama
