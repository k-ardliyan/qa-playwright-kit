# Agent Git Safety — pagar mekanis untuk sesi agent

Dokumen ini menjelaskan **apa yang sudah dilindungi engine secara struktural**
dan **apa yang masih bergantung pada lapisan klien agent** — plus cara memasang
lapisan itu. Ringkasannya: upgrade framework sudah aman secara struktural;
sisa risikonya ada pada perintah git destruktif yang tidak punya hook git.

## Yang sudah ditutup engine (tidak perlu apa-apa)

| Ancaman                           | Penangkal                                                        |
| --------------------------------- | ---------------------------------------------------------------- |
| Upgrade menimpa kerjaan lokal     | Universal three-way merge — konten lokal selalu jadi pihak merge |
| Keadaan pra-upgrade hilang        | Snapshot `refs/qa-kit/upgrade-snapshots/*` (pulih per file)      |
| Commit setengah jadi saat upgrade | Commit-lock + guard di `.husky/pre-commit`                       |
| Commit berisi marker konflik      | `check-conflict-markers --staged` di pre-commit                  |
| Sync bersih menggantung staged    | `npm run upgrade --commit`                                       |

## Yang TIDAK bisa diblokir oleh git hook mana pun

`git reset --hard`, `git clean -f`, `git checkout -- .`, `git restore --worktree`,
`git stash drop/clear`, dan `--no-verify` **tidak memicu hook git apa pun** —
git tidak menyediakan titik pencegahannya. Satu-satunya tempat yang bisa
memblockir adalah **klien agent** (hook sebelum tool shell dijalankan).

Solusinya: [`config/agent-hooks/deny-destructive-git.cjs`](../config/agent-hooks/deny-destructive-git.cjs)
— skrip hook siap-pakai yang menolak pola-pola itu. Cara pasang per klien:
[config/agent-hooks/README.md](../config/agent-hooks/README.md).

Filosofinya konsisten dengan commit-guard: **fail-open** kalau skripnya sendiri
error (tidak boleh membajak pekerjaan), tapi **fail-closed** untuk pola yang
dikenali (perintah destruktif ditolak dengan alasan eksplisit). Ini pertahanan
terhadap kecelakaan — bukan terhadap niat jahat; untuk niat jahat, jawabannya
adalah isolasi environment dan review.

## Disiplin yang tidak bisa digantikan tooling

1. **Commit kecil-sering** — konten yang belum pernah jadi commit/stash/snapshot
   tidak bisa dipulihkan git bila hilang. Pipeline checkpoint opt-in
   (`QA_PIPELINE_AUTO_COMMIT=1`) mengotomasi ini per fase.
2. **Push rutin** — salinan off-machine hanya ada kalau di-push.
3. **Jangan pull upstream manual** — update framework lewat `npm run upgrade`
   (AGENTS.md → "Update / upgrade framework"); playbook pemulihan kalau sudah
   kejadian: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) → "Sudah kejadian git pull manual".

## Rujukan

- Alur & jaminan upgrade: [UPGRADE-FLOW.md](UPGRADE-FLOW.md)
- Recovery kerjaan hilang: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Protokol agent: [AGENTS.md](../AGENTS.md)
