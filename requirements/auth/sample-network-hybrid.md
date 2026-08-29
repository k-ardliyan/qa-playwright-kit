# REQ-API-001: Invoice List — Network Failure & Hybrid Seed

<!--
  SAMPLE capability tags: @network + @hybrid + @aria (opsional).
  Bukan requirement real project — hanya referensi format.
  Generator: emit helper @/support/pw.
  Validasi: npm run validate:requirement
-->

## Metadata

- **Tags:** #api #ui #regression #network #hybrid
- **Prioritas:** high
- **Auth state:** authenticated
- **Halaman awal:** /finance/invoices
- **Module:** invoice
- **Feature:** invoice-list
- **POM yang dibutuhkan:** invoicePage
- **Role scope:** finance
- **Access expectation:** finance: bisa melihat daftar invoice; hrd: tidak dibahas di requirement ini
- **Data scope:** seed data via API POST /api/invoices (payload minimal: amount, status=draft)
- **Risk level:** high

## Kriteria Penerimaan

- Daftar invoice menampilkan baris hasil seed API
- Ketika API list mengembalikan HTTP 500, UI menampilkan pesan error yang observable
- Struktur landmark utama daftar tetap konsisten (ARIA)

## Skenario Uji

### SC-01: Seed invoice via API lalu tampil di UI (@success @hybrid)

- **Test ID:** `TC-API-001`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `API` `FE`

**Prekondisi:** Session finance valid (`.auth/finance.json`)

**Input Data:**

- amount: 150000
- status: draft
- endpoint: POST /api/invoices

**Langkah:**

1. Seed invoice baru via API (`request` / `apiSeed`) dengan amount 150000 status draft
2. Buka halaman `/finance/invoices`
3. Cari baris invoice yang baru di-seed (by amount atau id response)

**Hasil yang Diharapkan:**

- Response seed API status 2xx
- Baris invoice terkait terlihat di tabel daftar
- Cleanup: hapus resource via API setelah assert (apiCleanup)

---

### SC-02: API list 500 menampilkan error UI (@failure @network)

- **Test ID:** `TC-API-002`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE` `API`

**Prekondisi:** Session finance valid

**Input Data:**

- mock: GET \*\*/api/invoices → 500
- body: { "error": "Internal Server Error" }

**Langkah:**

1. Register network mock 500 untuk `**/api/invoices**` (helper `mockServerError`)
2. Buka halaman `/finance/invoices`
3. Amati area error / toast / empty-error state
4. Cleanup routes (`unmockAll`)

**Hasil yang Diharapkan:**

- UI menampilkan pesan error yang terlihat (teks mengandung "error" / "gagal" / setara yang ada di app)
- Tidak menampilkan baris invoice seolah sukses

---

### SC-03: Struktur ARIA main list stabil (@success @aria)

- **Test ID:** `TC-API-003`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE`

**Prekondisi:** Catalog `artifacts/selector-catalog/finance/invoices.aria.yml` tersedia (jalankan `snapshot_page` dulu) ATAU gunakan baseline inline kecil

**Langkah:**

1. Buka `/finance/invoices` (dengan data mock sukses atau seed minimal)
2. Assert ARIA snapshot pada landmark `main` / region daftar

**Hasil yang Diharapkan:**

- `toMatchAriaSnapshot` / `expectAriaMatchesCatalog` lulus terhadap baseline catalog atau YAML inline
