Load when writing, reviewing, or recording AI insights (record_ai_note, healer/reporter notes, run insights) or explaining the AI NOTES column and AI Run Insights panel.

---

# AI Insight Format & Guardrails

AI insights complement `Expected`, `Actual`, `Status`, and `failureSource` — they never replace structured test data. Two delivery surfaces:

- **Per-test insight** → `record_ai_note` (scope `test`, default) → AI NOTES column of that row.
- **Run-level insight** → `record_ai_note` with `scope: "run"` → AI Run Insights panel on the overview page. Use for cross-scenario patterns (hot modules/roles, repeated error patterns, flaky sets, weak-assertion clusters, flow comparisons).

## Canonical format

Prefer the structured fields (`kind`, `observation`, `evidence`, `impact`, `recommendation`, `priority`, `confidence`, `nextAction`, `status`); the tool renders them in this fixed layout. A plain `message` is acceptable for one-liners.

```text
[<source>] Jenis: <kind> | Status: <observed|inferred|recommendation> | Prioritas: <high|medium|low> | Confidence: <high|medium|low>
Observasi: apa yang benar-benar terlihat dari test
Bukti: scenario, step, trace, screenshot, network, URL terakhir
Dampak: pengaruh terhadap user, bisnis, atau test suite
Rekomendasi: tindakan konkret
Next Action: langkah berikutnya untuk QA
```

Content language: **Indonesian**. Keep each note 1–6 lines; QA/programmer must be able to act on it without re-reading the trace.

## Jenis taxonomy

| Jenis          | Kapan dipakai                                                      |
| -------------- | ------------------------------------------------------------------ |
| `root-cause`   | Penyebab kegagalan + saran perbaikan teknis                        |
| `stability`    | Flaky, retry, durasi lambat, timing/synchronization                |
| `test-quality` | Assertion lemah, false-green risk, coverage assertion, data statis |
| `ui-ux`        | Label, feedback, empty/loading state, konsistensi antar modul      |
| `flow`         | Urutan langkah, persistensi input, Back/Cancel, redirect, shortcut |
| `data`         | Seed data, isolasi antar role, data sisa, data boundary            |
| `security`     | Exposisi credential/token, permission handling                     |
| `coverage`     | Negative path / boundary yang belum diuji, skipped massal          |
| `trend`        | Pola lintas skenario (run-level): modul/role panas, regresi        |

## Insight untuk scenario passed (bukan hanya failure)

Test passed ≠ aplikasi optimal. Insight yang bernilai pada scenario passed:

- **UI/UX**: feedback setelah aksi (toast/loading/redirect), konsistensi elemen, field/langkah yang terasa tidak perlu, empty/success state.
- **Flow**: langkah yang bisa dipersingkat, input yang bisa dipakai ulang antar langkah, konsistensi Back/Cancel/Submit, perbandingan Flow A vs Flow B (lebih pendek, lebih sedikit error-prone, feedback lebih jelas — rekomendasikan mana yang layak jadi standar).
- **Hasil bisnis**: side effect (notifikasi, audit trail, update tabel), data konsisten setelah refresh, operasi repeat tidak membuat duplikat.
- **Kualitas test**: assertion lemah, verifikasi yang belum dilakukan, potensi flaky (animasi/debounce/polling).
- **Data/environment**: seed realistis, data sisa antar test, isolasi akses antar role.
- **Rekomendasi**: boundary/negative case tambahan, exploratory follow-up.

Deterministic signals already baked by the reporter (do not duplicate): flaky retry, run-relative slow duration, missing `expect` assertion (false-green), metadata gaps, hot module/role, repeated error fingerprints. Agent insight adds the *why* and the *what to do*.

## Insight untuk scenario failed

Structure the failure story: ringkasan kegagalan (aksi pengguna, expected vs actual, langkah pemicu, konsisten vs intermittent) → klasifikasi (`failureSource` tetap machine-readable; narasi menjelaskannya) → root cause → saran perbaikan teknis DAN saran perbaikan produk → prioritas + next action konkret (re-run, re-auth, fix test, fix requirement, file bug, tambah seed).

## Guardrails (wajib — sebagian di-enforce oleh tool, bukan hanya dokumen)

- Pisahkan **fakta yang diamati** dari **rekomendasi** — setiap insight membawa `status`: `observed`, `inferred`, atau `recommendation`.
- Jangan menyebut UX buruk jika UI/UX tidak benar-benar diinspeksi; jangan klaim accessibility jika keyboard/screen reader/viewport terkait belum diuji.
- Test passed bukan bukti aplikasi sepenuhnya benar.
- Jangan mengarang actual result; jangan meringkas error hingga bukti hilang.
- Jangan langsung mengklasifikasi bug aplikasi tanpa memeriksa test, requirement, dan environment.
- **Secret redaction (enforced):** `record_ai_note` dan semua jalur tulis note otomatis me-redact Bearer token, JWT, `password=/token=/api_key=`, cookie, dan AWS key sebelum disimpan. Jangan bergantung pada ini — jangan pernah menulis credential di catatan.
- **Deduplication (enforced):** insight identik (source + teks ternormalisasi sama) tidak disimpan dua kali; tool mengembalikan `deduplicated: true` — jangan retry berulang.
- **Provenance (enforced):** saat MCP server berjalan dengan profile tunggal (healer/reporter/generator), `source` dari payload harus cocok dengan profile — badge tidak bisa dipalsukan.
- **Kontrak runId:** tanpa `runId`, insight menempel ke **pending pipeline run** saat pipeline aktif (marker dibuat saat pipeline start / `pipeline_status` pada state `running`; id-nya diekspos sebagai `pipelineRunId` di `pipeline_status` & `get_test_summary`), lalu ke **latest run** (canonical `run-YYYYMMDD-HHmmss-SSS`, tersedia sebagai `archiveRunId`). Catatan bersifat per-run: run baru memulai sidecar bersih; run terarsip memelihara catatannya permanen.
- **Affected metadata (scope=run):** sertakan `affectedTests` / `affectedModules` / `affectedRoles` agar QA bisa menelusuri insight ke sumbernya.
- **Analyze contract:** Reporter wajib menyertakan blok `analysis` (`completed`, `runInsightsRecorded`, `passedScenariosReviewed`, `skippedForInsufficientEvidence`) di JSON `PipelineReport` — bukti sub-fase Analyze berjalan. Archive metadata dan consumers expose `analysisVerdict` + `analysisVerified`; `APPROVE` hanya boleh saat verdict `complete` dan verified.
- Berikan `confidence: low` saat QA perlu memvalidasi manual.
- Deterministic signals (badge `auto`) berasal dari aturan reporter — bukan reasoning LLM; agent insight menambahkan *why* dan *what to do*.
