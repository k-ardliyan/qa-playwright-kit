# Contributing to QA Playwright Kit

Terima kasih sudah tertarik berkontribusi. Dokumen ini menjelaskan cara
menyiapkan lingkungan, apa yang diharapkan dari sebuah perubahan, dan ke mana
harus mengirimkannya.

## Sebelum mulai

- **Bug atau ide fitur** → buka issue dulu supaya bisa didiskusikan sebelum
  menulis kode. Perubahan besar tanpa diskusi berisiko ditolak.
- **Perbaikan kecil** (typo, dokumentasi, test yang gagal) → langsung kirim PR,
  tidak perlu issue.
- **Kerentanan keamanan** → jangan buka issue publik; lihat bagian Keamanan di
  bawah.

## Menyiapkan lingkungan

Prasyarat: **Node.js >= 20.19.0** (lihat `engines` di `package.json`).

```bash
git clone https://github.com/k-ardliyan/qa-playwright-kit.git
cd qa-playwright-kit
npm install
npm run setup      # wizard: env, role, dan prompt Hermes
```

`npm run setup` menulis `config/environments/{APP_ENV}.env` dan mengenkripsi
secret key lewat dotenvx. File env tidak pernah di-commit.

### Sinkron dengan upstream (fork QA)

Bagi fork yang menarik update zona framework dari upstream: jangan `git pull` /
`git stash` manual — pakai `npm run upgrade` (three-way merge terhadap base
tercatat, hasil staged tanpa commit). Preview dulu dengan
`npm run upgrade:check --json`; bila muncul konflik, resolve tiap file bermarker
lalu `git add` — jangan auto-commit. Protokol lengkap untuk chat agent ada di
[`AGENTS.md`](AGENTS.md) → "Update / upgrade framework".

## Alur kontribusi

1. Buat branch dari `main` dengan prefix yang jelas:
   - `feat/...` — fitur baru
   - `fix/...` — perbaikan bug
   - `docs/...` — dokumentasi
   - `refactor/...` — perubahan struktur tanpa perubahan perilaku
   - `test/...` — test saja
2. Kerjakan perubahan, tambahkan test untuk perilaku baru.
3. Jalankan gate lengkap **sebelum** push:

   ```bash
   npm run test:quality
   ```

   Gate ini menjalankan format check, lint, typecheck, validasi arsitektur,
   coverage map, twin-sync check, property test, unit test, dashboard-browser
   suite, dan file-content/network-assert suite. PR tidak akan lolos CI kalau
   gate ini merah.
4. Update dokumentasi yang relevan — termasuk `CHANGELOG.md` (format
   [Keep a Changelog](https://keepachangelog.com/)) bila perubahan itu
   memengaruhi pengguna.
5. Buka pull request ke `main` dan jelaskan **apa** yang berubah serta **kenapa**.

## Konvensi commit

Riwayat repo ini memakai [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <ringkasan imperatif>
```

Type yang dipakai: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.
Scope opsional, contoh nyata dari riwayat: `parsers`, `studio`, `wizard`,
`ci`, `skills`, `mcp`, `engine`.

Contoh:

```
fix(studio): emit backslash-free client script so the page loads
feat(parsers): add shared dual-mode markdown label reader
docs(skills): close the drift between the runbook and the engine
```

Tulis ringkasan dalam bentuk imperatif (`add`, bukan `added`), dan jelaskan
**kenapa** di badan commit bila alasannya tidak jelas dari diff.

## Batas arsitektur (penting)

Repo ini memisahkan kode dengan batas yang ditegakkan `npm run validate:architecture`:

| Area                    | Pemilik                | Aturan                                                                        |
| ----------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `src/**`                | Maintainer framework   | Engine internal. Healer/Generator dilarang mengubahnya untuk meluluskan test. |
| `tools/**`, `config/**` | Maintainer framework   | Tooling & konfigurasi internal.                                               |
| `tests/**`              | QA & automation author | Spec, page object, fixture — area kerja normal.                               |
| `requirements/**`       | QA author              | Requirement markdown (format tabel, lihat `requirements/_TEMPLATE.md`).       |
| `specs/**`              | Planner output         | Test plan markdown.                                                           |

Kalau test gagal karena **bug di aplikasi target**, jangan melemahkan
assertion. Tandai dengan `test.fixme(true, '<alasan>')` dan laporkan.

## Gaya kode

- **Format & lint otomatis** — Biome menangani keduanya; jalankan
  `npm run format` / `npm run lint`. Pre-commit hook (Husky + lint-staged)
  sudah menjalankannya untuk file yang berubah.
- **TypeScript** — `npm run typecheck` harus bersih; hindari `any` bila tipe
  yang tepat tersedia.
- **Bahasa** — kode, komentar, dan commit message dalam bahasa Inggris.
  Dokumentasi pengguna boleh bahasa Indonesia (repo ini bilingual).
- **Test baru** — sertakan bila menambah perilaku. Fixture test harus
  **inline atau di dalam repo**, jangan bergantung pada file dokumentasi.

## Keamanan

Jangan pernah membuka issue publik untuk kerentanan keamanan. Laporkan secara
privat ke **hi@ka4.dev** dengan subjek `[SECURITY] <ringkasan singkat>`.

Sertakan: langkah reproduksi, dampak yang mungkin, dan versi/commit yang
terdampak. Anda akan menerima konfirmasi penerimaan, dan kredit akan diberikan
di catatan rilis bila Anda menginginkannya.

> Maintainer: aktifkan GitHub Private Vulnerability Reporting
> (`Settings → Code security → Private vulnerability reporting`) agar pelapor
> punya jalur privat langsung dari halaman repo. Selama fitur itu nonaktif,
> email di atas adalah satu-satunya jalur privat.

Yang termasuk kerentanan: kebocoran kredensial, bypass sandbox path, eksekusi
perintah tanpa validasi, dan injeksi lewat requirement/plan markdown.

## Lisensi

Dengan berkontribusi, Anda setuju bahwa kontribusi Anda dilisensikan di bawah
[MIT License](LICENSE) yang sama dengan proyek ini.
