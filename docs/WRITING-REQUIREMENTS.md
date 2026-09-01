# Menulis Requirement

Simpan file fitur di folder [`requirements/`](../requirements/), sejajar dengan [`_TEMPLATE.md`](../requirements/_TEMPLATE.md).

Setup mesin dan pipeline: [GUIDE.md](GUIDE.md)

---

## Path A vs Path B: Kapan Pakai POM?

**Path A (default — tanpa POM):** Fitur baru, skenario sederhana, QA pemula. Generator pakai inline locators dari catalog → test langsung jalan. Tidak perlu buat POM sama sekali.

**Path B (reusable — dengan POM):** Fitur dipakai >2 spec, role-aware, atau butuh maintainability jangka panjang. QA jalankan `snapshot_page` → `generate_page_object` → edit scaffold → simpan di `tests/pages/` dan register di `tests/fixtures.ts` → tambah field "POM yang dibutuhkan" di requirement.

Untuk QA pemula: **mulai dari Path A**. POM adalah optimasi, bukan keharusan.

---

## Alur kerja

1. Duplikat [`_TEMPLATE.md`](../requirements/_TEMPLATE.md) → `requirements/nama-fitur.md`.
2. Isi Metadata, Access Matrix (jika multi-role), Kriteria Penerimaan (dengan `AC-XX`), dan Skenario Uji (dengan `Covers` dan `Test ID`).
3. (Opsional) Rapikan catatan kasar via ChatGPT/Gemini — lihat section **Prompt untuk AI eksternal** di bawah.
4. Validasi: `npm run validate:requirement`
5. Koreksi ringan di editor jika perlu.
6. Pipeline AI di IDE: pakai section **Prompt Siap Pakai** di [GUIDE.md](GUIDE.md).

---

## Checklist sebelum commit

- [ ] `npm run validate:requirement` lulus (tanpa error)
- [ ] Judul `# REQ-XXX: ...` ada di baris pertama
- [ ] Section `## Metadata` terisi (Tags, Prioritas, Auth state, Halaman awal, Module, Feature)
- [ ] **`- **Module:** <nama-modul>`** diisi — wajib untuk machine contract & report grouping
- [ ] **`- **Feature:** <nama-fitur>`** diisi — disarankan untuk pemetaan spesifik (validator hanya warning jika kosong)
- [ ] Setiap item di `## Kriteria Penerimaan` memiliki ID eksplisit: `- **AC-01:** [Deskripsi]`
- [ ] Setiap skenario memiliki `- **Test ID:** \`TC-MODUL-NNN\``
- [ ] Setiap skenario memiliki `- **Covers:** \`AC-01\`, \`AC-02\``
- [ ] Skenario multi-role memiliki `- **Role:** \`role-name\`` (parser requirement membaca `Role:`, bukan `Actor:`)
- [ ] Input Data menggunakan format provenance eksplisit (`seed:...`, `credential:...`, `fixture:...`, `literal:...`)
- [ ] Hasil bersifat observable (URL, teks, status badge — bukan "berjalan baik")
- [ ] Skenario non-otomatis ditandai `(@manual)` di judul dengan alasan di Hasil yang Diharapkan
- [ ] Jika multi-role, sediakan tabel `## Access Matrix`
- [ ] (Disarankan) setiap skenario isi `- **Layer terdampak:** FE` / `BE` / `DB` / `API`


---

## Tipe Skenario

Tambahkan tag di judul `### SC-XX:` untuk membedakan tipe:

| Tag                     | Artinya                                        |
| ----------------------- | ---------------------------------------------- |
| `(@success)`            | Happy path — alur normal berhasil              |
| `(@failure)`            | Negative path — input salah, validasi gagal    |
| `(@access-restriction)` | Role tidak berhak, akses ditolak               |
| `(@manual)`             | Tidak bisa diotomasi (CAPTCHA, OTP, biometric) |

Capability tags (opsional, digabung di judul SC):

| Tag                     | Artinya                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `(@download)`           | Download file — `downloadAndSave`                                          |
| `(@upload)`             | Upload fixture-first — `uploadFixture` / `setInputFiles` (bukan OS picker) |
| `(@file-content)`       | Assert isi PDF/Excel — needles dari **Hasil** skenario                     |
| `(@network)`            | Mock HTTP                                                                  |
| `(@network-assert)`     | Live payload + response (`waitAndAssertApi` / partial contract)            |
| `(@hybrid)`             | Seed API + assert UI                                                       |
| `(@aria)` / `(@visual)` | Snapshot a11y / screenshot                                                 |

Upload **bukan** `@manual`. PDF **teks** = `@file-content`; PDF **layout** visual = `@manual`. Lihat [MANUAL-SCENARIOS.md](MANUAL-SCENARIOS.md). Live network payload/response = `@network-assert` (bukan `@manual`, bukan overload `@network` mock).

Jika tidak diberi tag tipe, skenario dianggap `(@success)` secara default.

> Catatan: parser requirement (`parse-requirement-scenarios.ts`) mengembalikan `scenarioType: 'general'` untuk skenario tanpa tag tipe — bukan `'success'`. `general` diperlakukan sebagai alur sukses biasa dengan role credential `user`.

---

## Metadata Opsional untuk Role-Aware Testing

Tambahkan field berikut jika fitur berbeda per role bisnis:

```markdown
- **Role scope:** super-admin, finance
- **Access expectation:** super-admin: bisa approve dan reject; finance: bisa approve; hrd: tidak bisa mengakses
- **Risk level:** high
```

Validator akan memberi warning jika:

- `Auth state: authenticated` tapi tidak ada `Role scope` (mungkin perlu ditambahkan)
- `Role scope` diisi tapi `Access expectation` kosong
- Requirement menyebut kata gagal/error/ditolak tapi tidak ada skenario `(@failure)`

Lihat panduan lengkap: [AUTH-CONTEXT-CONVENTION.md](AUTH-CONTEXT-CONVENTION.md)

### Mode general vs role-aware

- **general** = tidak ada `Role scope`; auth default = role kredensial **`user`** (`TEST_USER_*`), **bukan** role bernama `general`
- **role-aware** = ada `Role scope`; satu spek/auth per role bisnis (`finance`, `hrd`, …)
- `Role scope` memuat nama bisnis saja — jangan tulis `general` di daftar role

---

## Contoh & Referensi

| File                                                                    | Untuk apa                                           |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| [`requirements/_TEMPLATE.md`](../requirements/_TEMPLATE.md)             | Template utama yang Anda salin                      |
| [`requirements/_GOOD_EXAMPLE.md`](../requirements/_GOOD_EXAMPLE.md)     | Contoh requirement BAIK — target kualitas           |
| [`requirements/_BAD_EXAMPLE.md`](../requirements/_BAD_EXAMPLE.md)       | Contoh requirement BURUK — apa yang harus dihindari |
| [`requirements/auth/login-none.md`](../requirements/auth/login-none.md) | Catalog login mode `none` — empty-field + success   |

---

## Format label (parser)

| Indonesia         | Alias Inggris (opsional)                                |
| ----------------- | ------------------------------------------------------- |
| `**Langkah:**`    | `**Steps:**`, `**Step:**`                               |
| `**Hasil:**`      | `**Expected Result:**`, `**Expected:**`, `**Outcome:**` |
| `**Prekondisi:**` | `**Precondition:**`, `**Given:**`                       |

---

## Prompt untuk AI Eksternal (ChatGPT / Gemini)

Gunakan ini untuk mengubah catatan kasar atau tiket menjadi requirement siap pakai.

```
Tolong ubah catatan berikut menjadi requirement QA dalam format Markdown.

FORMAT YANG HARUS DIIKUTI:
# REQ-XXX: [Judul Fitur]

## Metadata
- **Tags:** #<tag1> #<tag2>
- **Prioritas:** high / medium / low
- **Auth state:** unauthenticated / authenticated
- **Halaman awal:** /path-halaman
- **POM yang dibutuhkan:** namaPage (opsional)
- **Role scope:** role1, role2 (HANYA jika fitur berbeda per role)
- **Access expectation:** role1: bisa X; role2: tidak bisa X (HANYA jika Role scope diisi)

## Kriteria Penerimaan
- [kondisi observable 1]
- [kondisi observable 2]

## Skenario Uji

### SC-01: [Nama Skenario] (@success)
**Prekondisi:** [kondisi awal]
**Langkah:**
1. [langkah 1]
2. [langkah 2]
**Hasil:**
- [hasil observable — URL, teks, elemen visible]

### SC-02: [Nama Skenario] (@failure)
**Prekondisi:** [kondisi awal]
**Langkah:**
1. [langkah 1]
**Hasil:**
- [pesan error atau kondisi gagal yang observable]

ATURAN PENTING:
- Hasil HARUS observable: URL, teks visible, elemen tampil/hilang
- JANGAN tulis "sistem bekerja dengan baik" — itu tidak observable
- Tandai (@manual) di judul skenario yang butuh CAPTCHA / OTP / biometric
- Setiap skenario harus punya Langkah dan Hasil

CATATAN SAYA:
[paste catatan Anda di sini]
```

### Langkah setelah AI selesai

1. Salin Markdown hasil AI ke `requirements/nama-fitur.md`.
2. Cek format dengan section **Format label (parser)** di atas.
3. Jalankan `npm run validate:requirement`.
4. Di IDE (Cursor/Kiro/Claude), pakai prompt pipeline dari section **Prompt Siap Pakai** di [GUIDE.md](GUIDE.md).

---

## Troubleshooting validasi

| Rule                           | Perbaikan                                                        |
| ------------------------------ | ---------------------------------------------------------------- |
| `title_required`               | Tambah `# REQ-01: Judul`                                         |
| `scenario_structure`           | Cek bold `**Langkah:**` dan `**Hasil:**` per skenario `###`      |
| `observable_result`            | Hasil harus URL/teks/visibility, bukan "berjalan baik"           |
| `role_scope_recommended`       | Jika authenticated + multi-role, tambah `Role scope` di Metadata |
| `access_expectation_missing`   | Tambah `Access expectation` jika `Role scope` sudah diisi        |
| `failure_scenario_recommended` | Tambah skenario `(@failure)` jika ada kata error/gagal/ditolak   |

Detail: [GUIDE — troubleshooting validate_requirement](GUIDE.md#troubleshooting-validate-requirement)

---

## Standar Penulisan Tabel Markdown

Untuk menjaga konsistensi dan kemudahan baca baik oleh manusia, GitHub preview, maupun AI Agent, gunakan panduan standar berikut:

### 1. Struktur Dasar Wajib
Gunakan pipe (`|`) di awal dan akhir setiap baris serta baris separator (`---`):

```md
| Header 1 | Header 2 | Header 3 |
| -------- | -------- | -------- |
| Data 1   | Data 2   | Data 3   |
```

### 2. Alignment Kolom
Gunakan titik dua (`:`) pada baris separator untuk mengatur perataan:

```md
| Field    | Jumlah   | Status   | Keterangan |
| :------- | -------: | :------: | ---------- |
| `testId` | 25       | Passed   | Rata kiri  |
| `auth`   | 10       | Failed   | Rata kanan |
```
- `:---` → Rata kiri (default)
- `---:` → Rata kanan (angka / metrik)
- `:---:` → Rata tengah (status / boolean / tag)

### 3. Escape Karakter Pipe (`|`)
Jika isi sel mengandung karakter pipe, wajib di-escape dengan backslash:
```md
| Input | Expected |
| ----- | -------- |
| User  | Admin \| Operator |
```

### 4. Line Break dalam Satu Sel
Gunakan tag `<br>` untuk baris baru di dalam sel yang sama:
```md
| Skenario | Langkah |
| -------- | ------- |
| SC-01    | 1. Buka halaman<br>2. Isi form<br>3. Klik submit |
```

### 5. Hindari Colspan / Rowspan
Markdown/GFM standar **tidak mendukung** `colspan` atau `rowspan`. Jika butuh struktur bertingkat kompleks, gunakan HTML `<table>` murni atau pecah menjadi sub-tabel/prose.

