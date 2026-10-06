# Agent hooks — deny destructive git

Skrip di folder ini menambal lubang mekanis terakhir: `git reset --hard`,
`git clean -f`, `git checkout -- .`, dan `--no-verify` **tidak punya hook git**
yang bisa memblokirnya, sehingga satu-satunya titik pencegahan adalah klien
agent itu sendiri. Latar lengkap: [docs/AGENT-GIT-SAFETY.md](../../docs/AGENT-GIT-SAFETY.md).

## `deny-destructive-git.cjs`

Membaca JSON hook dari stdin, menolak (deny) pola destruktif di atas, membiarkan
yang lain lewat, dan **fail-open** kalau skripnya sendiri error — melindungi dari
kecelakaan, bukan dari niat jahat.

| Pola yang ditolak                                   | Alasan                                     |
| --------------------------------------------------- | ------------------------------------------ |
| `git reset --hard`                                  | Menghabiskan seluruh perubahan uncommitted |
| `git clean -f…`                                     | Menghapus file untracked permanen          |
| `git checkout -- <path>` / `git restore --worktree` | Membuang editan lokal tanpa konfirmasi     |
| `git stash clear` / `git stash drop`                | Menghapus checkpoint stash                 |
| `… --no-verify`                                     | Melewati commit-guard, marker gate, lint   |

## Pasang per klien

- **Claude Code** — gabungkan `claude-code-settings.example.json` ke
  `.claude/settings.json` project (path `$CLAUDE_PROJECT_DIR` otomatis tersedia).
- **ZCode** — skema hook sama (PreToolUse / Bash matcher); salin blok hook dari
  contoh di atas ke konfigurasi hooks workspace-mu, arahkan ke skrip `.cjs` ini.
- **Hermes** — gunakan gerbang `write_approval` / agent-guard bawaan versi
  Hermes-mu dengan daftar pola di atas (lihat dokumentasi Hermes untuk format
  terkininya).
- **Cursor / Codex / lainnya** — klien yang mendukung "command hook sebelum
  shell command" dapat memakai skrip yang sama; klien tanpa hook: andalkan
  protokol di AGENTS.md (pelaporan, bukan penegakan).

> Ingat: ini pertahanan terhadap **kecelakaan**. Keputusan update framework
> tetap lewat `npm run upgrade` (agent-first) — jangan pernah `git pull` /
> `git stash` manual (AGENTS.md → "Update / upgrade framework").
