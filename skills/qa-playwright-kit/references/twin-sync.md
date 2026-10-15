# Twin & Sync — Dua Sisi Kode yang Saling Terkunci

> Repo ini punya **dua mekanisme duplikasi** antara `src/` (framework core) dan `tools/mcp/` (paket MCP yang tidak bisa mengimpor TS root). Mengedit sisi yang salah = kegagalan diam-diam saat gate. Baca ini sebelum menyentuh `src/contracts/**`, `src/shared/mcp/**`, `src/shared/evidence/**`, atau `tools/mcp/src/utils/**`.

## 1. AUTO-SYNCED pairs (byte-exact) — 18 pasangan

Sumber kebenaran ada di `tools/scripts/sync-mcp-generated.ts` (`MCP_GENERATED_PAIRS`). Setiap file tujuan dibangun ulang dari sumbernya — **JANGAN PERNAH mengedit file tujuan secara manual**.

**Aturan emas:** edit file di `src/` → jalankan `npm run sync:mcp-generated` → commit keduanya. Banner `AUTO-SYNCED from <path>` di kepala file tujuan menunjuk sumbernya.

Kelompok pasangan (verifikasi dengan `npm run sync:mcp-generated:check`):

| Sumber (edit di sini)                    | Tujuan (generated, jangan edit)                           |
| ---------------------------------------- | --------------------------------------------------------- |
| `src/contracts/*.ts` (9 file kontrak)    | `tools/mcp/src/contracts/*.ts`                            |
| `src/support/pw/file-content-core.ts`    | `tools/mcp/src/utils/file-content-core.ts`                |
| `src/shared/mcp/auth-probe.ts`           | `tools/mcp/src/utils/auth-probe.ts`                       |
| `src/shared/mcp/auth-discovery.ts`       | `tools/mcp/src/utils/auth-discovery-core.ts` (nama beda!) |
| `src/shared/mcp/failed-grep.ts`          | `tools/mcp/src/utils/failed-grep.ts`                      |
| `src/shared/mcp/seed-registry-core.ts`   | `tools/mcp/src/utils/seed-registry-core.ts`               |
| `src/shared/utils/role-credentials.ts`   | `tools/mcp/src/utils/role-credentials.ts`                 |
| `src/shared/workspace-paths.ts`          | `tools/mcp/src/utils/workspace-paths.ts`                  |
| `src/support/traceability/test-index.ts` | `tools/mcp/src/utils/test-index.ts`                       |
| `src/utils/logger.ts`                    | `tools/mcp/src/utils/logger.ts`                           |

Gate yang menegakkan: `sync:mcp-generated:check` (di dalam `quality:check-rules`) dan rule ARCH-SYNC-001 di `tools/validators/validate-architecture.ts`. File berbanner AUTO-SYNCED yang tidak terdaftar di pasangan juga ditolak.

## 2. MANUAL twins (parity semantic) — 4 pasangan

Terdaftar di `tools/scripts/twin-parity-check.ts` (`MANUAL_TWIN_PAIRS`). Ini fork yang disengaja — MCP-nya subset, nama fungsi bisa berbeda (mis. `classifyFailureFromEvidence` di src vs `classifyFailureError` di MCP; itu LONGGAK yang disengaja). Yang dicek: export penting, konstanta, dan string kontrak harus ada di kedua sisi.

| Pasangan             | Sumber                                      | Twin MCP                                    |
| -------------------- | ------------------------------------------- | ------------------------------------------- |
| `test-notes`         | `src/agents/reporting/test-notes.ts`        | `tools/mcp/src/utils/test-notes.ts`         |
| `run-context`        | `src/agents/reporting/run-context.ts`       | `tools/mcp/src/utils/run-context.ts`        |
| `analysis-gate`      | `src/agents/reporting/analysis-gate.ts`     | `tools/mcp/src/utils/analysis-gate.ts`      |
| `failure-classifier` | `src/shared/evidence/failure-classifier.ts` | `tools/mcp/src/utils/failure-classifier.ts` |

**Aturan:** mengubah kontrak salah satu sisi → tulis perubahan yang setara di sisi lain dalam commit yang sama → `npm run check:twin-parity` sampai hijau.

## Gejala pelanggaran & pemulihan

| Gejala                                            | Penyebab                              | Pemulihan                            |
| ------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| `sync:mcp-generated:check` merah                  | Sisi src diedit, sync belum jalan     | `npm run sync:mcp-generated`         |
| `check:twin-parity` merah                         | Satu sisi twin diubah sendirian       | Samakan kontrak di kedua sisi        |
| `ARCH-SYNC-001` di `validate:architecture`        | File berbanner tidak terdaftar        | Daftarkan pasangan atau hapus banner |
| Perubahan MCP tidak muncul saat server dijalankan | Lupa `npm run mcp:build` setelah sync | `npm run mcp:build`                  |
