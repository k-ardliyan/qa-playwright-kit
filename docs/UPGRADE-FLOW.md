# Alur Upgrade Framework (v2)

Dokumen ini memvisualkan cara kerja `npm run upgrade` versi 2 (universal merge,
committed base, safety snapshot, `--commit`, commit-lock). Prinsipnya satu
kalimat: **QA tidak pernah perlu commit WIP-nya untuk bisa upgrade, dan tidak ada
keadaan lokal yang bisa hilang diam-diam** — engine yang menyelamatkan, hook yang
menahan, commit yang mendurasi.

Protokol lengkap untuk chat agent: [AGENTS.md](../AGENTS.md) → "Update / upgrade
framework". Panduan pemulihan kalau ada yang terasa hilang: bagian **🛟 Recovery**
di [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## 1. Siapa mengerjakan apa (protokol agent-first)

QA non-coder menjalankan upgrade lewat chat agent. Keputusan commit hanya ada
dua: **bersih → otomatis**, **konflik → tidak pernah otomatis**.

```mermaid
flowchart TD
    A["QA: tolong update framework"] --> B["Agent: npm run upgrade:check --json"]
    B --> C{"status?"}
    C -->|"up-to-date"| D["Laporkan: sudah versi terbaru — selesai"]
    C -->|"ok / conflicts / blocked"| E["Agent jelaskan ke QA dalam bahasa awam: file apa berubah, konflik apa, nextAction"]
    E --> F{"QA setuju lanjut?"}
    F -->|"tidak"| G["Stop — tidak ada file yang disentuh"]
    F -->|"ya"| H["Agent: npm run upgrade --json --commit"]
    H --> I{"status?"}
    I -->|"ok (bersih)"| J["Commit provenance dibuat otomatis (trailer Upstream-Sync) — selesai"]
    I -->|"up-to-date"| D
    I -->|"conflicts"| K["BERHENTI — bantu QA resolve tiap file bermarker lalu git add; commit manual (tidak pernah auto-commit)"]
    I -->|"blocked"| L["Laporkan nextAction + rollback + snapshot; eskalasi maintainer bila perlu"]
```

---

## 2. Alur engine saat `npm run upgrade`

Perhatikan tiga pilar keamanan di tengah alur: **lock** (tidak ada dua mutasi
bersamaan, commit lain ditolak hook), **snapshot** (keadaan pra-mutasi selalu
pulih), dan **universal merge** (tidak ada overwrite buta).

```mermaid
flowchart TD
    S["Repo adalah git repository?"] -->|"tidak"| ERR["UpgradeError: minta maintainer siapkan repo"]
    S -->|"ya"| LOCK["Kunci artifacts/.upgrade-lock.json (pid) — pre-commit menolak commit lain"]
    LOCK --> FETCH["git fetch upstream (default: repo template ini)"]
    FETCH --> BASE["Tentukan base: .upgrade-base.json committed → .upgrade-state.json legacy → null"]
    BASE --> DIFF["git diff base..FETCH_HEAD -- FRAMEWORK_PATHS"]
    DIFF --> EMPTY{"Tidak ada file zona yang berubah?"}
    EMPTY -->|"ya"| UPTODATE["status up-to-date — release lock, selesai"]
    EMPTY -->|"tidak"| ADV["base null? Cetak advisory: commit lokal yang menyentuh zona (tidak memblokir)"]
    ADV --> PREVIEW["Preview dry-run: rencana apply, konflik, safe-delete"]
    PREVIEW --> SNAP["Snapshot konten terkini file zona yang dirty (tracked + untracked) ke refs/qa-kit/upgrade-snapshots/*"]
    SNAP --> APPLY["applyZoneDiff — universal three-way merge (lihat bagian 3)"]
    APPLY --> DEPS["npm install · setup:check · sinkron skills/MCP · auth:verify (semua warn-only)"]
    DEPS --> WRITE["Simpan .upgrade-base.json + .upgrade-state.json → git add base"]
    WRITE --> CONFL{"Ada konflik?"}
    CONFL -->|"ya"| RESOLVE["File bermarker TIDAK di-stage — status conflicts, nextAction resolve-conflicts (release lock)"]
    CONFL -->|"tidak + --commit"| AUTO["Commit provenance: chore: sync framework zone + Upstream-Sync trailer — nextAction nothing"]
    CONFL -->|"tidak tanpa --commit"| STAGED["Hasil STAGED — nextAction review-and-commit (rollback: git restore --staged --worktree .)"]
```

---

## 3. Keputusan per file (universal three-way merge)

Base merge = base tercatat ?? HEAD — jadi **setiap kasus punya jalur**, tanpa
hard-block dan tanpa overwrite buta. File QA di luar `FRAMEWORK_PATHS`
(requirements, specs, tests buatan QA) tidak pernah muncul di sini.

```mermaid
flowchart TD
    F["File zona berubah di upstream"] --> M{"auth.setup.ts + marker // CUSTOM_AUTH_FLOW?"}
    M -->|"ya"| SKIP["Dilewati (preserved) — kustomisasi QA utuh"]
    M -->|"tidak"| EX{"File ada di worktree?"}
    EX -->|"tidak (baru / terhapus lokal)"| CO["checkout FETCH_HEAD — plain add"]
    EX -->|"ya"| BC{"Base punya versi file ini?"}
    BC -->|"tidak (untracked lokal, upstream menambah)"| AA["Merge add/add (base kosong) — beda isi: konflik bermarker, kedua konten utuh"]
    BC -->|"ya"| EQ{"Konten lokal == base?"}
    EQ -->|"ya (QA tak menyentuh)"| CO2["checkout FETCH_HEAD — overwrite aman"]
    EQ -->|"tidak (QA mengubah, committed atau belum)"| BIN{"Konten binary (PNG/PDF)?"}
    BIN -->|"ya"| BC2["Konflik binary — byte utuh, tidak pernah di-line-merge"]
    BIN -->|"tidak"| MF["git merge-file ours base theirs"]
    MF -->|"clean"| W["Tulis hasil + git add — ter-merge"]
    MF -->|"konflik isi"| WM["Tulis bermarker — TIDAK di-stage, QA/agent yang resolve"]
    MF -->|"gagal merge"| CF["Konflik content — tidak menulis apa pun"]
```

**File yang dihapus upstream:** dihapus juga (`git rm`) hanya bila konten lokal
masih sama dengan base **dan** file itu memang pernah ada di riwayat upstream —
file buatan QA yang kebetulan berada di dalam zona **tidak pernah** ikut
terhapus. File yang sudah dimodifikasi QA → **kept** (dilaporkan, dibiarkan).

---

## 4. Commit guard (hook pre-commit)

Selama upgrade memegang lock, commit lain ditahan mekanis — agent tidak bisa
membekukan keadaan setengah jadi, kecuali commit itu milik upgrade sendiri.

```mermaid
flowchart LR
    C["git commit"] --> H{"Lock upgrade hidup?"}
    H -->|"tidak"| OK["Lanjut: lint-staged + validate"]
    H -->|"ya + env QA_KIT_UPGRADE_COMMIT=1"| OK
    H -->|"ya, pid masih hidup"| DENY["TOLAK (exit 1): tunggu upgrade selesai, ikuti nextAction"]
    H -->|"ya, pid sudah mati"| CLEAR["Lock basi → auto-clear → lanjut"]
```

---

## 5. Jaminan keamanan — peta cepat

| Yang dijamin                                  | Mekanisme                                                    | Dipin oleh                  |
| --------------------------------------------- | ------------------------------------------------------------ | --------------------------- |
| WIP QA tidak perlu di-commit untuk upgrade    | Universal merge; dirty worktree tidak pernah memblokir       | harness `framework-upgrade` |
| Konten lokal tidak hilang diam-diam           | Merge tiga-arah + snapshot pra-apply + advisory commit lokal | `npm run test:upgrade`      |
| File QA di dalam zona tidak ikut terhapus     | Tiebreaker riwayat upstream (`upstreamHistoryHasFile`)       | harness                     |
| Hasil sync tidak menggantung staged           | `--commit` otomatis saat bersih (konflik tidak pernah)       | harness                     |
| Tidak ada commit liar di tengah upgrade       | Lock + pre-commit guard (fail-open bila guard error)         | harness                     |
| Base akurat di setiap clone/laptop            | `.upgrade-base.json` committed (pola Copier/cruft)           | harness                     |
| Marker `// CUSTOM_AUTH_FLOW` selalu dihormati | `shouldPreserveGeneratedFile` — line-anchored                | harness                     |

Semua jaminan di atas dipin `npm run test:upgrade` (38 checks, bagian dari
`quality:check-rules`) — perubahan masa depan yang merusaknya membuat gate
merah dulu, bukan QA yang kena.
