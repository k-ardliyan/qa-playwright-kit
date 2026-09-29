# Emulasi media, pencarian hemat token & perekaman flow (Playwright MCP 0.0.82+)

Tool `@playwright/mcp` yang dipakai saat **Explore** — bukan di dalam spec.

## 0. `browser_find` — cari elemen tanpa snapshot penuh (0.0.83+)

Mengembalikan **hanya node snapshot yang cocok** plus beberapa baris konteks di sekitarnya (seperti snippet pencarian), masing-masing di bawah path-nya dari root tree — jauh lebih hemat token daripada `browser_snapshot` saat hanya perlu menemukan elemen dan `ref`-nya.

- `text` — substring case-insensitive, ATAU `regex` (pilih salah satu, jangan keduanya).
- `filename` (0.0.83+) — tulis hasil ke file alih-alih mengembalikannya di response. Path relatif diselesaikan terhadap workspace root. Pakai saat hasilnya besar.

Alur hemat: `browser_find({ text: 'Simpan' })` → ambil `ref` dari hasil → `browser_click`. Naik ke `browser_snapshot` hanya kalau `browser_find` tidak menemukan apa pun.

> **Catatan 0.0.83:** snapshot kini mengutip accessible name yang terlihat seperti regex, mis. `"/home/"`. Assertion spec yang memakai string itu apa adanya bisa meleset — gunakan `getByRole('link', { name: '/home/' })` (Playwright menangani escaping), bukan string snapshot mentah.

## 1. `browser_emulate_media` — verifikasi tema / print tanpa relaunch

Ganti media feature di sesi yang sedang jalan; parameter yang tidak diisi dibiarkan, `null` menghapus override.

| Parameter       | Nilai               | Kapan dipakai                                        |
| --------------- | ------------------- | ---------------------------------------------------- |
| `colorScheme`   | `light` \| `dark`   | Requirement "mode gelap", kontras teks, badge status |
| `reducedMotion` | `reduce`            | Requirement aksesibilitas / animasi                  |
| `forcedColors`  | `active`            | High-contrast mode Windows                           |
| `contrast`      | `more` \| `less`    | Kontras tambahan                                     |
| `media`         | `screen` \| `print` | Layout cetak (invoice, label, berita acara)          |

Alur: navigasi → `browser_emulate_media({ colorScheme: 'dark' })` → `browser_snapshot` / `browser_take_screenshot` → assert visual → `browser_emulate_media({ colorScheme: null })` untuk kembali.

**Batasnya:** tool ini mengubah preferensi CSS (`prefers-color-scheme`). Kalau aplikasi menyimpan tema di `localStorage` / cookie / profil user, override CSS saja **tidak** mengubah tema — set state aplikasinya dulu, baru emulasi.

**Yang TIDAK boleh dilakukan:** jangan pakai `browser_emulate_media` sebagai pengganti assertion di dalam spec. Spec tetap memakai `page.emulateMedia({ colorScheme: 'dark' })` Playwright API — tool MCP hanya untuk eksplorasi & pembuktian di sesi live.

## 2. `browser_start_recording` / `browser_stop_recording` — draft spec dari walkthrough

QA mendemonstrasikan flow manual, server mengembalikan aksi sebagai kode Playwright.

1. `browser_start_recording`
2. QA menjalankan flow di browser (atau agent mengeksekusi langkahnya)
3. `browser_stop_recording` → dapat potongan kode

Hasilnya **bahan mentah**, bukan spec siap pakai: tidak ada `test.step()`, `setTestMetadata()`, `captureActualResult()`, dan locator-nya bisa CSS mentah. Wajib diolah lewat [generator-step-titles.md](../generator-step-titles.md) sebelum masuk `tests/`.

## 3. Tool yang TIDAK ada di MCP (jangan dipanggil)

`browser_reload`, `browser_check`, `browser_uncheck`, `browser_keydown`, `browser_keyup`, `browser_press_sequentially`, `browser_navigate_forward`, `browser_console_clear`, `browser_network_clear`, `browser_webmcp_list` ada di bundle server tapi **`skillOnly`** — tidak pernah diekspos lewat MCP. Memanggilnya menghasilkan `unknown tool`. Gunakan `browser_navigate` untuk reload, `browser_press_key` untuk Enter, dan `browser_tabs` untuk navigasi antar tab.

> Verifikasi: probe `tools/list` per set `--caps` terhadap `@playwright/mcp` 0.0.83 (72 tool terekspos — sama dengan 0.0.82).
