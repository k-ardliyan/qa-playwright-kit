/**
 * AUTO-SYNCED from src/contracts/diagnostic-catalog.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

/**
 * Diagnostic catalog — lay-language explanation + remediation per DiagnosticCode.
 *
 * Single source of truth consumed by:
 *  - `createDiagnostic()` (auto-attaches `suggestion` when the emitter omits one)
 *  - the MCP `explain_diagnostic` tool (lookup + lay explanation)
 *
 * Indonesian for the QA-facing explanation; commands keep repo paths so the
 * agent can act without grepping. Synced to tools/mcp/src/contracts/ — edit
 * THIS file, then run `npm run sync:mcp-generated`.
 *
 * @module contracts/diagnostic-catalog
 */

export interface DiagnosticCatalogEntry {
  /** Lay-language explanation (Indonesian) — what this code means for QA. */
  readonly lay: string;
  /** Concrete remediation the agent can execute now. */
  readonly suggestion: string;
}

export const DIAGNOSTIC_CATALOG: Record<string, DiagnosticCatalogEntry> = {
  // ─── Requirement (REQ_*) ────────────────────────────────────────────────
  REQ_ACCESS_MATRIX_CONFLICT: {
    lay: 'Dua skenario menuntut akses yang bertentangan untuk role yang sama.',
    suggestion:
      'Samakan Access expectation antar skenario untuk role itu, atau pisahkan menjadi dua role di Metadata.',
  },
  REQ_CAPABILITY_CONTRACT_INCOMPLETE: {
    lay: 'Skenario memakai capability tag (@network, @upload, dst.) tanpa data pendukung yang wajib.',
    suggestion:
      'Lengkapi kolom yang disyaratkan tag itu (mis. @network butuh endpoint di Network Expectations) sesuai skills/qa-playwright-kit/references/scenario-tags.md.',
  },
  REQ_MALFORMED: {
    lay: 'Format requirement tidak bisa diparse.',
    suggestion:
      'Bandingkan dengan requirements/_TEMPLATE.md dan perbaiki struktur tabel/blok yang rusak.',
  },
  REQ_EMPTY_SCENARIOS: {
    lay: 'Requirement tidak punya skenario sama sekali.',
    suggestion: 'Tambahkan minimal satu blok ### SC-01 dengan Langkah dan Hasil yang diharapkan.',
  },
  REQ_NO_OBSERVABLE_RESULT: {
    lay: 'Ada skenario tanpa hasil yang bisa diamati.',
    suggestion:
      'Tulis Hasil yang diharapkan yang terlihat di UI (pesan, status, data) — bukan asumsi internal sistem.',
  },
  REQ_LEGACY_AC_BULLET: {
    lay: 'Acceptance criteria ditulis sebagai bullet legacy.',
    suggestion: 'Konversi ke bentuk tabel | Label | value | sesuai requirements/_TEMPLATE.md.',
  },
  REQ_LEGACY_ROLE_PROSE: {
    lay: 'Role scope ditulis sebagai prosa bebas.',
    suggestion: 'Pindahkan ke baris Metadata `| Role scope | ... |` agar bisa diparse role-aware.',
  },
  REQ_LEGACY_POM_METADATA: {
    lay: 'Metadata masih memakai kolom POM lama.',
    suggestion: 'Hapus kolom POM dari Metadata — Page Object bersifat opsional di framework ini.',
  },

  // ─── Test plan (PLAN_*) ─────────────────────────────────────────────────
  PLAN_SCENARIO_MISSING: {
    lay: 'Ada skenario requirement yang hilang dari plan dan tidak dicatat sebagai gap.',
    suggestion:
      'Tambahkan skenario ke plan, atau catat di ## Coverage Gaps dengan alasan yang jelas.',
  },
  PLAN_AC_UNCOVERED: {
    lay: 'Ada acceptance criterion requirement yang tidak tercover plan.',
    suggestion:
      'Petakan AC ke skenario (kolom Covers) atau catat di ## Coverage Gaps berikut alasannya.',
  },
  PLAN_UNKNOWN_AC: {
    lay: 'Plan mengklaim mencakup AC yang tidak ada di requirement.',
    suggestion: 'Perbaiki id AC di kolom Covers agar cocok dengan requirement.',
  },
  PLAN_ROLE_DRIFT: {
    lay: 'Actor skenario di plan berbeda dari requirement.',
    suggestion:
      'Samakan kolom Actor dengan requirement, atau revisi requirement bila memang berubah.',
  },
  PLAN_AUTH_DRIFT: {
    lay: 'Auth context skenario berbeda dari requirement.',
    suggestion:
      'Samakan Auth Context (role/storageState) dengan requirement — auth hanya boleh dari authStatePath(role).',
  },
  PLAN_EXPECTATION_DRIFT: {
    lay: 'Ekspektasi plan menyimpang dari requirement.',
    suggestion:
      'Kembalikan Assertion ke hasil yang ditulis requirement; jangan mengarang ekspektasi baru.',
  },
  PLAN_UNREVIEWED_ASSUMPTION: {
    lay: 'Ada assertion ber-provenance planner-assumption yang belum direview.',
    suggestion:
      'Review asumsi itu: konfirmasi via live verification atau ganti provenance; asumsi tak terkonfirmasi tidak boleh menggerakkan assertion runnable.',
  },
  PLAN_UNKNOWN_PROVENANCE: {
    lay: 'Assertion memakai provenance yang tidak dikenal.',
    suggestion:
      'Gunakan salah satu: requirement, live-verification, framework-derived, planner-assumption.',
  },
  PLAN_STALE_REQUIREMENT: {
    lay: 'Requirement berubah setelah plan dibuat.',
    suggestion: 'Recompile plan via compile_test_plan agar hash requirement segar.',
  },
  PLAN_STALE: {
    lay: 'Plan kedaluwarsa terhadap kontrak saat ini.',
    suggestion: 'Jalankan compile_test_plan ulang lalu validate_plan.',
  },
  PLAN_EPHEMERAL_REF: {
    lay: 'Plan memuat locator ephemeral (tw-XXXX) yang tidak stabil.',
    suggestion:
      'Ganti dengan semantic locator (getByRole/getByLabel) atau hasil selector-catalog; ref MCP tidak boleh dipersist.',
  },
  PLAN_EPHEMERAL_REF_DETECTED: {
    lay: 'Plan memuat locator ephemeral (tw-XXXX) di actions/locator intent.',
    suggestion:
      'Ganti dengan semantic locator (getByRole/getByLabel) atau hasil selector-catalog; ref MCP tidak boleh dipersist.',
  },
  PLAN_EVIDENCE_MISSING: {
    lay: 'Skenario automated tidak punya bukti halaman di selector catalog.',
    suggestion:
      'Jalankan snapshot_page untuk halamannya dulu, atau turunkan skenario ke ## Coverage Gaps.',
  },
  PLAN_EVIDENCE_EMPTY: {
    lay: 'Entri catalog evidence kosong.',
    suggestion: 'Isi halaman yang dibuktikan di ## Catalog Evidence atau jalankan snapshot_page.',
  },
  PLAN_EVIDENCE_UNVERIFIED: {
    lay: 'Entri catalog evidence belum terverifikasi (elementCount 0 / peringatan auth).',
    suggestion: 'Jalankan ulang snapshot_page sampai elementCount > 0 tanpa peringatan auth.',
  },
  PLAN_EVIDENCE_MAJORITY_GAP: {
    lay: 'Mayoritas skenario automated tanpa bukti — plan menebak massal.',
    suggestion:
      'Jalankan snapshot_page/discover_pages untuk halaman terkait sebelum merencanakan; skenario tanpa bukti wajib masuk ## Coverage Gaps.',
  },
  PLAN_EVIDENCE_UNAVAILABLE: {
    lay: 'Plan mengklaim bukti katalog yang tidak ada di disk.',
    suggestion:
      'Perbaiki path di ## Catalog Evidence agar cocok dengan artifacts/selector-catalog/<feature>/ yang benar-benar ada.',
  },
  PLAN_EVIDENCE_MODE_INVALID: {
    lay: 'Evidence Mode bukan ui-e2e/hybrid-ui.',
    suggestion:
      'Gunakan ui-e2e (default) atau hybrid-ui dengan tag @hybrid + seed terdaftar + cleanup aman.',
  },
  PLAN_REQUIREMENT_PATH_MISMATCH: {
    lay: 'Path requirement eksplisit berbeda dari header plan.',
    suggestion: 'Samakan header requirement plan dengan path yang dipakai memanggil validate_plan.',
  },
  PLAN_MANUAL_CONVERTED_WITHOUT_REASON: {
    lay: 'Skenario @manual di requirement diubah jadi automated tanpa alasan.',
    suggestion:
      'Buktikan kemampuan otomasi (live verification) atau biarkan skenario tetap manual/blocked.',
  },
  PLAN_NOT_IMPLEMENTED_NO_GAP: {
    lay: 'Skenario not-implemented tidak dicatat sebagai coverage gap.',
    suggestion:
      'Tambahkan skenario itu ke ## Coverage Gaps supaya utang kerjanya terlihat, bukan tersembunyi.',
  },
  PLAN_LOCATOR_INTENT_MISSING: {
    lay: 'Skenario automated tanpa Locator Intent.',
    suggestion:
      'Isi kolom Locator Intent dari selector catalog halamannya (snapshot_page bila belum ada).',
  },
  PLAN_SEED_UNPROVISIONED: {
    lay: 'Plan memakai seed yang tidak terprovision di registry.',
    suggestion:
      'Daftarkan producer di config/qa-kit.seeds.json (salin dari .example) atau pilih seed lain via list_seeds.',
  },
  PLAN_SEED_UNKNOWN: {
    lay: 'Plan merujuk seed yang tidak terdaftar.',
    suggestion:
      'Cek daftar valid via qa-playwright-kit:list_seeds lalu perbaiki nama seed di plan.',
  },
  PLAN_SEED_NOT_EXECUTABLE: {
    lay: 'Seed dipakai tanpa producer yang bisa dijalankan.',
    suggestion:
      'Lengkapi blok create (endpoint/payload) di config/qa-kit.seeds.json atau ubah Evidence Mode ke ui-e2e.',
  },
  PLAN_DOCTRINE_STALE: {
    lay: 'Plan distempel doctrine versi lama.',
    suggestion: 'Recompile plan via compile_test_plan agar distempel doctrine/v2 terbaru.',
  },
  PLAN_HYBRID_RULES: {
    lay: 'Skenario hybrid-ui melanggar aturan (tag/seed/cleanup).',
    suggestion:
      'Pastikan tag @hybrid ada, seed terdaftar dan executable, serta test memiliki browser action + UI assertion + cleanup test-owned.',
  },
  PLAN_DATA_OPERATION_UNCOVERED: {
    lay: 'Data operation tidak tercakup skenario mana pun.',
    suggestion:
      'Petakan operation ke skenario (kolom Data Operation) atau catat di ## Coverage Gaps.',
  },
  PLAN_RELATION_UNCONFIRMED: {
    lay: 'Relasi masih assumption tapi dipakai untuk assertion runnable.',
    suggestion:
      'Konfirmasi relasi via live verification (confidence: confirmed) atau jadikan assertion itu non-runnable.',
  },
  PLAN_RELATION_SEED_UNPROVISIONED: {
    lay: 'Relasi butuh seed yang belum terprovision.',
    suggestion: 'Daftarkan producer seed-nya di config/qa-kit.seeds.json sebelum plan dirilis.',
  },

  // ─── Staleness & traceability ───────────────────────────────────────────
  SPEC_STALE: {
    lay: 'Spec tidak sinkron dengan plan/requirement terbaru.',
    suggestion: 'Regenerate spec via Generate stage, atau update plan-nya dulu.',
  },
  TEST_STALE: {
    lay: 'Test tidak sinkron dengan kontrak saat ini.',
    suggestion: 'Jalankan ulang Generate untuk file test tersebut.',
  },
  PIPELINE_STATE_STALE: {
    lay: 'State pipeline lama tidak cocok dengan kondisi sekarang.',
    suggestion: 'Panggil qa-playwright-kit:pipeline_status untuk orientasi ulang sebelum resume.',
  },
  GENERATED_TEST_MODIFIED: {
    lay: 'File test hasil generate diubah manual.',
    suggestion:
      'Perubahan manual hilang saat regenerate — pindahkan ke plan atau Page Object, atau terima risiko ini.',
  },
  CATALOG_DRIFT: {
    lay: 'Selector catalog berubah sejak evidence diambil.',
    suggestion: 'Jalankan ulang snapshot_page untuk halaman yang berubah.',
  },
  TRACEABILITY_STALE: {
    lay: 'Grafik traceability kedaluwarsa.',
    suggestion: 'Panggil ulang qa-playwright-kit:trace_requirement setelah run selesai.',
  },
  TRACE_HEURISTIC_LINK_USED: {
    lay: 'Linkage memakai heuristik, bukan id eksplisit.',
    suggestion:
      'Tambahkan setTestMetadata (testId/scenarioId) eksplisit di spec agar linkage deterministik.',
  },

  // ─── Workspace & environment ────────────────────────────────────────────
  WORKSPACE_PATH_DRIFT: {
    lay: 'Struktur workspace tidak sesuai manifest.',
    suggestion: 'Periksa config/qa-kit.workspace.json dan kembalikan path ke nilai kanonik.',
  },
  CONTRACT_VERSION_UNSUPPORTED: {
    lay: 'Versi kontrak tidak didukung.',
    suggestion: 'Naikkan schemaVersion ke nilai yang didukung (lihat src/contracts/versions.ts).',
  },
  TOOL_DEPRECATED: {
    lay: 'Tool sudah usang.',
    suggestion: 'Gunakan tool penggantinya (lihat deskripsi tool di registry).',
  },
  INVALID_INPUT: {
    lay: 'Argumen tool tidak valid.',
    suggestion: 'Baca deskripsi tool dan perbaiki parameter sesuai skemanya.',
  },
  CONTRACT_VIOLATION: {
    lay: 'Keluaran melanggar kontrak qa.mcp-result/v1.',
    suggestion: 'Laporkan sebagai bug framework beserta kode dan payload-nya.',
  },
  NOT_FOUND: {
    lay: 'File atau entri yang diminta tidak ada.',
    suggestion: 'Verifikasi path/identifier; untuk run artifacts, jalankan pipeline dulu.',
  },
  ENVIRONMENT_ERROR: {
    lay: 'Lingkungan tidak siap (env/auth/tooling).',
    suggestion: 'Jalankan npm run health:check lalu perbaiki item merah yang dilaporkannya.',
  },
  TOOL_INTERNAL: {
    lay: 'Error internal tool.',
    suggestion: 'Ulangi sekali; bila persist, laporkan dengan pesan error lengkap.',
  },

  // ─── Workflow & pipeline stages ─────────────────────────────────────────
  EXPLORE_REQUIRED: {
    lay: 'Belum ada bukti eksplorasi untuk requirement ini.',
    suggestion: 'Jalankan snapshot_page/discover_pages untuk halaman target sebelum lanjut.',
  },
  EXPLORE_TRANSITION: {
    lay: 'Transisi state dari Explore tidak sah.',
    suggestion: 'Panggil pipeline_status untuk melihat state sebenarnya, lalu resume.',
  },
  MODEL_FAILED: {
    lay: 'Stage Model gagal menyiapkan plan.',
    suggestion: 'Pastikan specs/<feature>-test-plan.md ada dan valid, lalu resume.',
  },
  MODEL_TRANSITION: {
    lay: 'Transisi state dari Model tidak sah.',
    suggestion: 'Panggil pipeline_status untuk orientasi, lalu resume dengan runId yang benar.',
  },
  CHALLENGE_BLOCKED: {
    lay: 'Gate Challenge menolak plan.',
    suggestion: 'Baca diagnostics di hasil validate_plan; perbaiki kode PLAN_* yang muncul.',
  },
  CHALLENGE_FAILED: {
    lay: 'Adapter Challenge error.',
    suggestion: 'Ulangi stage challenge; bila persist, periksa plan dengan compile_test_plan.',
  },
  CHALLENGE_TRANSITION: {
    lay: 'Transisi state dari Challenge tidak sah.',
    suggestion: 'Panggil pipeline_status, lalu resume.',
  },
  GENERATE_BLOCKED: {
    lay: 'Generate tidak boleh jalan (precondition belum lulus).',
    suggestion: 'Selesaikan Challenge dulu — plan harus lulus gate sebelum spec ditulis.',
  },
  GENERATE_FAILED: {
    lay: 'Generator gagal.',
    suggestion: 'Tulis/perbaiki spec manual sesuai .github/agents/generator.agent.md lalu resume.',
  },
  GENERATE_TRANSITION: {
    lay: 'Transisi state dari Generate tidak sah.',
    suggestion: 'Panggil pipeline_status, lalu resume.',
  },
  VALIDATE_BLOCKED: {
    lay: 'Validate tidak bisa dijalankan.',
    suggestion:
      'Pastikan spec hasil generate ada di path kanonik tests/<feature>[-<role>].spec.ts.',
  },
  VALIDATE_FAILED: {
    lay: 'Adapter Validate error.',
    suggestion: 'Ulangi stage validate; periksa results dir di artifacts/test-results/.',
  },
  VALIDATE_TRANSITION: {
    lay: 'Transisi state dari Validate tidak sah.',
    suggestion: 'Panggil pipeline_status untuk melihat state, lalu resume.',
  },
  LOOP_LIMIT_REACHED: {
    lay: 'Batas 3 re-entry pass untuk target loop yang sama tercapai.',
    suggestion:
      'Klasifikasikan failureSource secara jujur (app/test/env/requirement) dan lakukan keputusan QA — jangan loop lagi.',
  },
  RESUME_NOT_SEMANTIC: {
    lay: 'Run lama bukan semantic-v1 sehingga tidak bisa di-resume.',
    suggestion: 'Mulai run baru via workflow_run dengan requirementPath yang sama.',
  },
  RESUME_STALE_REQUIREMENT: {
    lay: 'Requirement berubah sejak run dijeda.',
    suggestion: 'Mulai run baru — hash requirement sudah tidak cocok dengan state.',
  },
  WORKFLOW_PAUSED: {
    lay: 'Run dijeda menunggu pekerjaan eksternal.',
    suggestion: 'Baca result.handoff (handoffType/resumeCommand) untuk melanjutkan.',
  },
  WORKFLOW_BLOCKED: {
    lay: 'Run terblokir gate atau precondition.',
    suggestion: 'Baca errors[0].code di respons, lalu ikuti suggestion kodenya.',
  },

  // ─── Analysis / archive gate ────────────────────────────────────────────
  ANALYSIS_INCOMPLETE: {
    lay: 'Sub-fase Analyze belum selesai.',
    suggestion:
      'Panggil record_ai_note (source: "reporter", scope: "run") minimal sekali sebelum archive APPROVE.',
  },
  ANALYSIS_UNVERIFIABLE: {
    lay: 'Bukti Analyze tidak bisa diverifikasi dari sidecar.',
    suggestion:
      'Pastikan insight tersimpan di artifacts/reports/test-notes.json dengan runId yang cocok.',
  },
  ANALYSIS_EVIDENCE_MISMATCH: {
    lay: 'Jumlah insight yang diklaim tidak cocok dengan sidecar.',
    suggestion:
      'Selaraskan analysis.runInsightsRecorded dengan isi sidecar, atau tambah insight yang kurang.',
  },

  // ─── Sync / drift ───────────────────────────────────────────────────────
  ARCH_SYNC_001_MCP_GENERATED_DRIFT: {
    lay: 'Salinan generated di tools/mcp tidak sama dengan sumbernya.',
    suggestion:
      'Jalankan npm run sync:mcp-generated (jangan edit file berbanner AUTO-SYNCED manual).',
  },
  ARCH_017_DOC_PATH_DRIFT: {
    lay: 'Dokumen mengutip path framework yang tidak ada.',
    suggestion:
      'Perbaiki path di dokumen, atau buat file-nya; jalankan validate:architecture ulang.',
  },
};

/** Lay explanation + suggestion untuk sebuah kode; undefined bila tak terdaftar. */
export function lookupDiagnosticCatalog(code: string): DiagnosticCatalogEntry | undefined {
  return DIAGNOSTIC_CATALOG[code];
}

/** Catalog sebagai daftar (untuk lookup fuzzy/explainer tool). */
export const DIAGNOSTIC_CATALOG_ENTRIES: Array<DiagnosticCatalogEntry & { code: string }> =
  Object.entries(DIAGNOSTIC_CATALOG).map(([code, entry]) => ({ code, ...entry }));
