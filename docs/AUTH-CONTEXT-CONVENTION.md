# Auth Context Convention

Dokumen ini mendefinisikan konvensi penyimpanan auth state per role untuk framework QA Playwright Kit ini.

> **Kelola kredensial (password, tambah/hapus role, encrypt):** lihat **[CREDENTIALS.md](CREDENTIALS.md)** — `npm run env:edit`.
>
> **Path auth setup (template core):** `tests/auth.setup.ts`  
> (discover semua role login-ready dari env; multi-role otomatis).
>
> **Root Playwright wiring (official):** project `setup` → `chromium` memakai `dependencies: ['setup']`.  
> Default `storageState` di project chromium **kosong** (unauthenticated). Spec terautentikasi **wajib** override:
>
> ```ts
> import { authStatePath } from '@/support/auth-paths';
> test.use({ storageState: authStatePath('finance') });
> // setara: `.auth/${process.env.APP_ENV || 'local'}/finance.json`
> ```
>
> Tanpa kredensial login-ready, setup menulis `.auth/{APP_ENV}/user.json` kosong agar suite tidak gagal (demo tetap hijau).

---

## Struktur Direktori

Auth state **scoped by `APP_ENV`** (satu-satunya selector environment):

```
.auth/
  {APP_ENV}/              e.g. local | dev | staging | production
    user.json             ← default account (pipeline mode "general")
    super-admin.json
    finance.json
    hrd.json
    admin.json
```

Legacy (hanya `local`): `.auth/user.json` masih dibaca; `migrateLegacyAuthFiles()` menyalin ke `.auth/local/` saat auth setup.

File berisi Playwright storage state (cookies + localStorage).

> `.auth/` sudah ada di `.gitignore` — jangan commit auth state ke repository.

---

## Naming Convention

| Role bisnis   | Storage state path                 | Keterangan                                    |
| ------------- | ---------------------------------- | --------------------------------------------- |
| `user`        | `.auth/{APP_ENV}/user.json`        | Default authenticated user (mode **general**) |
| `super-admin` | `.auth/{APP_ENV}/super-admin.json` | Super admin                                   |
| `finance`     | `.auth/{APP_ENV}/finance.json`     | Finance                                       |
| `hrd`         | `.auth/{APP_ENV}/hrd.json`         | HRD                                           |
| `admin`       | `.auth/{APP_ENV}/admin.json`       | Admin                                         |

**Jangan** buat role / file `general` — `general` = mode requirement tanpa Role scope; auth-nya = **`user`**.

Helper: `authStatePath('finance')` / `authStateWritePath('finance')` di `src/support/auth-paths.ts`.

---

## Cara menjalankan Auth Setup

**Disarankan:** biarkan discovery otomatis di `tests/auth.setup.ts` (setelah `env:edit` / wizard).

Setup mendaftarkan satu test `authenticate:<role>` per role yang **login-ready**  
(password + minimal satu EMAIL | USERNAME | PHONE). Login id: `LOGIN_ID_PREF` → email → username → phone.

```bash
npm run auth:setup
# OTP / CAPTCHA di browser:
npm run auth:setup:headed
# setara:
npx playwright test tests/auth.setup.ts --project=setup --workers=1
```

Regenerate template multi-role (opsional): `npm run env:edit` → _Regenerasi auth.setup.ts_  
(atau `setup:wizard` Phase 5). Core discovery tetap jalan tanpa regenerate.

---

## Assisted human challenge (OTP / CAPTCHA)

Session bootstrap boleh **dibantu manusia** (local only) lewat env:

| Mode              | Arti                                                       | Headless   | Terminal               |
| ----------------- | ---------------------------------------------------------- | ---------- | ---------------------- |
| `none` (default)  | Tidak ada assist                                           | ya         | —                      |
| `otp-browser`     | **OTP di browser** (disarankan)                            | **tidak**  | tidak untuk isi OTP UI |
| `otp-stdin`       | OTP diketik di terminal                                    | boleh      | **wajib TTY**          |
| `captcha-browser` | CAPTCHA di browser                                         | **tidak**  | **ditolak**            |
| `auto`            | Deteksi: CAPTCHA→browser; OTP→browser dulu, fallback stdin | tergantung | tergantung             |

```bash
# config/environments/{APP_ENV}.env
AUTH_CHALLENGE_MODE=otp-browser
HEADLESS=false
SLOW_MO=100
# AUTH_CHALLENGE_TIMEOUT_MS=180000
# AUTH_OTP_INPUT_SELECTOR=
# AUTH_OTP_SUBMIT_SELECTOR=
```

**Atur lewat UI (bukan hanya raw env):**

- `npm run setup:wizard` → Phase 5 (setelah form login)
- `npm run env:edit` → _Edit BASE_URL / browser / OTP-CAPTCHA_

**CI:** `AUTH_CHALLENGE_MODE` interaktif **dilarang** (fail fast).  
Skenario requirement OTP/CAPTCHA tetap ditandai `(@manual)` (skip di pipeline).  
Fitur ini hanya membantu **menyimpan sesi** `.auth/{APP_ENV}/role.json`.

Implementasi: `src/support/human-challenge.ts` dipanggil dari `tests/auth.setup.ts` setelah submit password.

---

## Multi-role credentials

Lihat [CREDENTIALS.md](CREDENTIALS.md) — skema seragam per role; multi N=1 mirror ke `TEST_USER` opsional.

---

## Related

| Dokumen                                            | Isi                                 |
| -------------------------------------------------- | ----------------------------------- |
| [CREDENTIALS.md](CREDENTIALS.md)                   | Keys, identifier opsional, env:edit |
| [GUIDE.md](GUIDE.md)                               | APP_ENV control plane               |
| [WRITING-REQUIREMENTS.md](WRITING-REQUIREMENTS.md) | Mode general vs role-aware          |
