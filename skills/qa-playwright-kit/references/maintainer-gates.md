# Maintainer Gates — Menjalankan & Menafsirkan Quality Gates

> Untuk agent yang mengubah kode framework (`src/`, `tools/`, `config/`, `.github/agents/`, `skills/`). Semua perintah dijalankan dari repo root. Baca juga [qa-vs-maintainer.md](qa-vs-maintainer.md) untuk batas siapa boleh mengubah apa.

## Peta gate

| Perintah                           | Yang dijalankan                                                                                                                                                  | Kapan dipakai                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `npm run quality:check-code`       | format:check (biome + markdown) → lint → `tsc --noEmit` → `mcp:typecheck` → `xss:scan`                                                                           | Setelah mengubah kode apa pun                 |
| `npm run quality:check-rules`      | Chain ~20 langkah: architecture/ephemeral/coverage validator, sync, twin-parity, contract tests, unit, property, dashboard-browser, file-content, network-assert | Setelah perubahan struktural / sebelum commit |
| `npm run validate:architecture`    | Semua rule ARCH-\* termasuk **ARCH-017 doc-path drift**                                                                                                          | Setelah rename file/folder atau edit dokumen  |
| `npm run sync:mcp-generated`       | Menyalin SoT (`src/contracts/**`, core bersama) ke `tools/mcp/src/**` dengan banner AUTO-SYNCED                                                                  | Setelah mengedit file sumber pasangan sync    |
| `npm run sync:mcp-generated:check` | Verifikasi 18 pasangan byte-identical (tanpa menulis)                                                                                                            | Cepat setelah `git pull`/sync                 |
| `npm run check:twin-parity`        | 4 pasangan manual twin (test-notes, run-context, analysis-gate, failure-classifier)                                                                              | Setelah mengedit salah satu twin              |
| `npm run setup:check`              | Memvalidasi setup DAN men-sinkronkan mirror `.agents/skills/` ← `skills/`                                                                                        | Setelah mengedit file di `skills/`            |
| `npm run test:unit`                | ~1049 test via `config/playwright/unit.ts`                                                                                                                       | Verifikasi perilaku                           |
| `npm run test:property`            | 26 file property (fast-check) — termasuk test render dashboard end-to-end                                                                                        | Wajib setelah memindahkan file apa pun        |
| `npm run test:dashboard-browser`   | 76 test browser dashboard (port 4567)                                                                                                                            | Setelah mengubah dashboard/reporter           |
| `npm run mcp:build`                | Build server MCP (`tools/mcp/dist/index-mcp.js`)                                                                                                                 | Setelah mengubah `tools/mcp/src/**`           |

## ⚠️ Jebakan 1: `quality:check-rules` bisa exit 0 meski ada test gagal

Chain ini **tidak selalu** meneruskan kegagalan lane terakhir. Sudah teramati: 6 dashboard-browser test gagal di dalam chain, exit code tetap 0.

**Cara benar membaca hasilnya:**

1. Jangan pernah percaya exit code saja — **baca tail output**.
2. Cari baris `X failed` / `X passed` untuk tiap suite; catat yang gagal.
3. Jalankan ulang suite yang gagal **secara terisolasi** untuk memastikan.
4. `test:dashboard-browser` khususnya punya flakiness lintas-spawn (port 4567): kegagalan yang berpindah-pindah antar test pada kode identik = flaky; ulangi run penuh sebelum menyimpulkan regresi.

## ⚠️ Jebakan 2: test statis tidak melihat path runtime `__dirname`

`tsc`, lint, dan unit test lolos padahal dashboard merender `<style>` kosong — hanya **`test:property`** (test render end-to-end) yang menangkap. Setelah memindahkan file apa pun yang membaca file tetangga: grep file itu untuk `__dirname` dan jalankan `npm run test:property`.

## ARCH-017 — path dokumen harus ada

Validator memindai dokumen hidup (`docs/`, `skills/`, `.github/`, `src/`, `tools/`, `config/`, plus AGENTS.md/README.md/CONTRIBUTING.md) untuk path framework yang dikutip (`src/…`, `tools/…`, `config/…`, `.github/…`, `skills/…`, termasuk suffiks `:line`) dan **gagal bila file itu tidak ada**. Workspace QA (`requirements/`, `specs/`, `tests/`, `artifacts/`) dikecualikan karena di-generate per-run. Artinya: setelah rename, referensi dokumen yang tertinggal **tertangkap gate** — jalankan `validate:architecture` sebelum commit.

## Mirror skills: `.agents/skills/` harus identik dengan `skills/`

`npm run check:skills-mirror` membandingkan byte-per-byte. Gate merah **bukan** berarti copy manual: jalankan `npm run setup:check` (yang men-sinkronkan), lalu ulangi gate.

## Urutan verifikasi yang aman (cheat sheet)

```bash
npm run quality:check-code        # cepat (~1 menit)
npm run validate:architecture     # cepat
npm run test:property             # menangkap korupsi render
npm run quality:check-rules       # penuh — BACA TAIL OUTPUT
npm run mcp:build && npm run health:check   # bila sentuh tools/mcp
```
