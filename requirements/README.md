# Requirements

Folder ini untuk **file requirement fitur** yang dibaca Planner / pipeline Hermes.

## Penamaan penting

| File                                   | Arti                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login.md`                             | **REAL** — ditulis otomatis oleh `npm run setup` dari `AUTH_CHALLENGE_MODE` + URL/role wizard. Gitignored (per project).                                                |
| `auth/login-<mode>.md`                 | Catalog 1:1 dengan challenge wizard: `none`, `auto`, `otp-browser`, `otp-stdin`, `captcha-browser`. Turunkan ke website kamu via setup, jangan edit sebagai target app. |
| `_TEMPLATE.md`                         | Template kosong untuk fitur baru.                                                                                                                                       |
| `_GOOD_EXAMPLE.md` / `_BAD_EXAMPLE.md` | Referensi gaya penulisan (bukan pipeline setup).                                                                                                                        |

Locator **berbeda per website**. Pipeline setup awal wajib:

1. `npm run setup` → menulis `requirements/login.md` + print prompt Hermes
2. `snapshot_page` → `artifacts/selector-catalog/auth/login.json`
3. Plan → Generate (Path A: inline locator dari catalog)
4. Execute → Heal → Report

## Cara pakai (setup awal)

```bash
npm run setup
# wizard menulis requirements/login.md sesuai mode challenge
# (none / auto / otp-browser / otp-stdin / captcha-browser)
# lalu print prompt siap-paste ke Hermes

# OTP/CAPTCHA: simpan sesi dulu
npm run auth:setup          # otp-stdin / none
npm run auth:setup:headed   # otp-browser / captcha-browser / auto
```

Catalog mode (bukan file target app):

- [`login-none.md`](auth/login-none.md) — tanpa OTP/CAPTCHA
- [`login-auto.md`](auth/login-auto.md) — deteksi otomatis
- [`login-otp-browser.md`](auth/login-otp-browser.md) — OTP di browser
- [`login-otp-stdin.md`](auth/login-otp-stdin.md) — OTP di terminal
- [`login-captcha-browser.md`](auth/login-captcha-browser.md) — CAPTCHA di browser

Skenario OTP/CAPTCHA tetap `(@manual)`. `AUTH_CHALLENGE_MODE` hanya membantu `auth:setup` menyimpan sesi.

## Cara pakai (fitur baru)

1. Salin [`_TEMPLATE.md`](_TEMPLATE.md) → `nama-fitur.md`
2. Isi metadata wajib + skenario
3. Validasi: `npm run validate:requirement`
4. Pipeline Hermes

## Mode penulisan

### General (default / setup awal)

```markdown
- **Tags:** #auth #ui #smoke
- **Prioritas:** high
- **Auth state:** unauthenticated
- **Halaman awal:** /login

# tanpa POM yang dibutuhkan
```

### Role-aware / Path B (opsional)

```markdown
- **Role scope:** finance, super-admin
- **Access expectation:** finance: bisa approve; hrd: tidak bisa
- **POM yang dibutuhkan:** invoicePage
```
