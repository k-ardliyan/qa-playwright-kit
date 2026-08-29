# REQ-NET-001: Demo Resource Submit — Live Network Assert

<!--
  SAMPLE capability: @network-assert (live observe).
  Bukan requirement real product — referensi format framework.
  Demo tokens: QA-KIT-NETWORK-OK
  Validasi: npm run validate:requirement
-->

## Metadata

- **Tags:** #api #ui #regression #network-assert
- **Prioritas:** high
- **Auth state:** unauthenticated
- **Halaman awal:** /demo/network-assert (fixture self-contained di demo)
- **Module:** demo
- **Feature:** network-assert
- **POM yang dibutuhkan:** —
- **Role scope:** general
- **Access expectation:** general: bisa submit demo form
- **Data scope:** POST /api/demo/submit — payload minimal: name, qty
- **Risk level:** medium

## Kriteria Penerimaan

- Setelah submit, FE mengirim POST ke endpoint demo dengan field yang diisi user
- Response backend (atau fulfill setara) menandai sukses dan UI menampilkan status sukses
- Field sensitif tidak di-assert sebagai exact secret di fixture kontrak

## Skenario Uji

### SC-01: Submit demo resource — live payload + response (@success @network-assert)

- **Test ID:** `TC-NET-001`
- **Prioritas skenario:** `high`
- **Layer terdampak:** `FE` `API`

**Prekondisi:** Halaman demo form submit tersedia (atau HTML fixture setara)

**Input Data:**

- method: POST
- urlIncludes: /api/demo/submit
- status: 200 or 201
- name: QA-KIT-NETWORK-OK
- qty: 2
- contract: tests/data/network/contracts/demo/submit-success.json
- request requiredKeys: name, qty
- response requiredKeys: ok, id

**Langkah:**

1. Buka form submit demo
2. Pastikan field name = QA-KIT-NETWORK-OK dan qty terisi
3. Klik tombol Submit
4. Tangkap network POST yang URL-nya mengandung `/api/demo/submit` (payload + response)
5. Assert kontrak partial + status UI

**Hasil yang Diharapkan:**

- Request method POST ke URL mengandung `/api/demo/submit`
- Request body memuat `name` = `QA-KIT-NETWORK-OK` dan key `qty`
- Request body tidak memuat key sensitif `password` / `token`
- Response status 200 atau 201
- Response body memuat `ok: true` dan key `id`
- UI menampilkan status sukses yang observable (mis. teks mengandung `ok:`)

---

### SC-02: API submit 500 menampilkan error UI (@failure @network)

- **Test ID:** `TC-NET-002`
- **Prioritas skenario:** `medium`
- **Layer terdampak:** `FE` `API`

**Prekondisi:** Form demo tersedia

**Input Data:**

- mock: POST \*\*/api/demo/submit → 500
- body: { "error": "Internal Server Error" }

**Langkah:**

1. Register network mock 500 untuk `**/api/demo/submit` (helper `mockServerError`)
2. Buka form dan klik Submit
3. Amati area error / status gagal
4. Cleanup routes (`unmockAll`)

**Hasil yang Diharapkan:**

- UI menampilkan indikasi error yang terlihat
- Tidak menampilkan status sukses seolah 2xx
