# Setelah Pipeline Pertama

Panduan ini untuk QA yang baru saja menjalankan pipeline pertama lewat
Hermes Agent setelah `setup:wizard` selesai.

## Artefak yang harus muncul

Setelah pipeline Plan → Generate → Execute → Heal → Report selesai:

| Artefak                                   | Wajib | Keterangan                                                                                                                                                    |
| ----------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specs/login-test-plan.md`                | ✅     | Test plan dari Planner                                                                                                                                        |
| `tests/login*.spec.ts`                    | ✅     | Spec Playwright dari Generator (Path A inline locators)                                                                                                       |
| `reports/pipeline-report-<runId>.md`      | ✅     | Ringkasan eksekusi + unresolved failures (ditulis ke `reports/` — tidak di-mirror ke `artifacts/`)                                                            |
| `artifacts/reports/custom-dashboard.html` | ✅     | Dashboard triage (Table/Accordion, SOURCE, Evidence card) — ditulis Reporter; dibuka otomatis oleh `qa-run --open-dashboard` (skip via `--no-open-dashboard`) |
| `artifacts/reports/test-summary.json`     | ✅     | Data mentah untuk tooling / agent (mirror dari `reports/test-summary.json`)                                                                                   |
| `artifacts/reports/archive/<runId>/`      | ✅     | Snapshot report — buka untuk approval                                                                                                                         |

**Dashboard terbuka otomatis** lewat `npm run qa:run` (default ON).
Skip dengan `--no-open-dashboard` atau buka manual via OS file manager.

## Kalau Gagal — Baca failureSource

Hermes mengklasifikasikan setiap unresolved failure ke salah satu sumber.
Di **custom dashboard**, kolom **SOURCE** menampilkan Cause + decision (Do) + blurb; hover untuk arti lengkap.

| `failureSource` | Artinya                              | Decision hint (UI) | Tindakan                                     |
| --------------- | ------------------------------------ | ------------------ | -------------------------------------------- |
| `app`           | Aplikasi yang salah (product bug)    | FILE BUG           | 🐛 buat defect ticket, pertahankan test      |
| `requirement`   | Requirement ambigu atau kontradiktif | REVISE REQUIREMENT | 📝 perbaiki file, ulangi dari Plan           |
| `test`          | Test code / locator salah            | FIX TEST           | 🔧 perbaiki `tests/`, re-run scoped          |
| `env`           | Env / auth / seed missing            | FIX ENVIRONMENT    | 🔧 cek `.auth/`, `env:edit`, `auth.setup.ts` |
| `ai_generation` | Generator salah pilih strategi       | FIX TEST/GENERATOR | 🔧 perbaiki input generator / hint / POM     |
| `unknown`       | Belum jelas                          | TRIAGE             | Investigasi trace/screenshot dulu            |

Detail UI dashboard: [REPORT-GUIDE.md](REPORT-GUIDE.md).

## 6 Keputusan QA

| Keputusan                 | Kapan                                              |
| ------------------------- | -------------------------------------------------- |
| ✅ **APPROVE**             | Semua pass. `archive_report` → baseline.           |
| 🐛 **FILE BUG**           | Ada `failureSource: 'app'`                         |
| 📝 **REVISE REQUIREMENT** | Ada `failureSource: 'requirement'`                 |
| 🔧 **FIX TEST/GENERATOR** | Ada `failureSource: 'test'` atau `'ai_generation'` |
| 🔧 **FIX ENVIRONMENT**    | Ada `failureSource: 'env'`                         |
| 🚫 **MARK BLOCKED**       | Tidak bisa resolve sekarang. Archive trace.        |

## Gejala Umum dan Fix Cepat

### ❌ "Dashboard redirect ke `/login` setelah login"

App menyimpan session di **localStorage** (bukan cookies). Pastikan `.auth/<role>.json` punya
`origins[0].localStorage` tidak kosong. File size harus > 100 bytes setelah auth.setup.

**Fix:**

```bash
npm run env:edit            # pastikan credentials benar
npm run auth:setup
# OTP/CAPTCHA: npm run auth:setup:headed
```

### ❌ "Test pass tapi dashboard `/login?redirect=%2Fdashboard`"

`expect(page).toHaveURL(/\/dashboard/)` false positive — pathname tetap `/login`.

**Fix di spec:** assert pathname, bukan URL:

```typescript
await expect.poll(() => new URL(page.url()).pathname).toContain('/dashboard');
```

### ❌ "Smoke test fail tapi `qa:run --dry-run` hijau"

`npm run test:smoke` menjalankan `--grep @smoke` (global). Tag `@smoke` hampir tidak ada di
spec yang di-generate. **Jalankan pipeline penuh di Hermes**, jangan pakai smoke untuk verifikasi.

### ❌ "Auth file 36 bytes (kosong)"

Template `auth.setup.ts` lama men-overwrite session valid dengan empty state. Sudah difix di
generator Juli 2026. **Re-run:**

```bash
npm run auth:setup
```

### ❌ "Hermes bilang prompt di-paste tapi tidak ada yang terjadi"

Pastikan paste ke **Hermes Agent**, bukan ke chat biasa. Status harus
menunjukkan `MCP ● 3 servers`.

## Setelah Pipeline Pertama OK

```bash
# Tambah role baru / ganti password
npm run env:edit

# Refresh session setelah ganti kredensial
npm run auth:setup
# OTP/CAPTCHA: npm run auth:setup:headed

# Tulis requirement fitur berikutnya
cp requirements/_TEMPLATE.md requirements/fitur-baru.md
# Edit → validate → prompt Hermes

# Lihat seluruh docs entry points
cat docs/CHEATSHEET.md
```

## Referensi Cepat

| Kebutuhan                  | Buka                              |
| -------------------------- | --------------------------------- |
| Command ringkas            | `docs/CHEATSHEET.md`              |
| Setup mesin (first-time)   | `docs/GETTING-STARTED.md`         |
| Format requirement         | `docs/WRITING-REQUIREMENTS.md`    |
| Panduan pipeline lengkap   | `docs/GUIDE.md`                   |
| Role-aware testing         | `docs/AUTH-CONTEXT-CONVENTION.md` |
| Format laporan / dashboard | `docs/REPORT-GUIDE.md`            |
| Troubleshooting umum       | `docs/TROUBLESHOOTING.md`         |
