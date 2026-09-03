# Kredensial & Multi-Role

> **Satu halaman** untuk ganti password, tambah/hapus role, dan refresh session login.  
> Setup awal? Jalankan `npm run setup` — lihat [GUIDE.md](GUIDE.md).

---

## Environment dulu, baru BASE_URL

`BASE_URL` **bukan** global project — isinya di `config/environments/{APP_ENV}.env` dan **boleh beda per env**.

| Urutan benar                               | Contoh                            |
| ------------------------------------------ | --------------------------------- |
| 1. Pilih / pin `APP_ENV`                   | `staging`                         |
| 2. Isi `BASE_URL` + kredensial di file itu | `config/environments/staging.env` |

Wizard: pilih **APP_ENV**, lalu **BASE_URL untuk env itu**.  
Env lain: `npm run env:use:staging` (atau `env:use:dev` / `env:use:local`) lalu `npm run env:edit` (jangan mengasumsikan URL sama).

---

## Naming Convention (sumber kebenaran)

Setiap role memakai **skema yang sama**:

| Key                 | Wajib?           | Keterangan                       |
| ------------------- | ---------------- | -------------------------------- |
| `{P}_PASSWORD`      | Ya (untuk login) | Secret                           |
| `{P}_EMAIL`         | Opsional         | Identitas email                  |
| `{P}_USERNAME`      | Opsional         | Identitas username               |
| `{P}_PHONE`         | Opsional         | Identitas telepon                |
| `{P}_LOGIN_ID_PREF` | Opsional         | `email` \| `username` \| `phone` |

Prefix `{P}`: role `user` → `TEST_USER`; role `finance` → `FINANCE`; `super-admin` → `SUPER_ADMIN`.

| Role                     | Prefix                 | Auth file                          |
| ------------------------ | ---------------------- | ---------------------------------- |
| `user` (default account) | `TEST_USER_*`          | `.auth/{APP_ENV}/user.json`        |
| `finance`                | `FINANCE_*`            | `.auth/{APP_ENV}/finance.json`     |
| `super-admin`            | `SUPER_ADMIN_*`        | `.auth/{APP_ENV}/super-admin.json` |
| `<role>` kebab           | `{ROLE_UPPER_SNAKE}_*` | `.auth/{APP_ENV}/<role>.json`      |

**Jangan** buat role bernama `general` — itu **mode pipeline**, bukan akun.

Validasi nama role: huruf kecil, angka, tanda hubung (`finance`, `super-admin`, `user`).

---

## Identifier opsional (aturan)

1. **Password wajib** untuk role yang akan login.
2. **Isi minimal satu** dari: email, username, atau telepon.
3. **Boleh isi semua** — tidak error.
4. Jika lebih dari satu terisi, sistem memilih: **email → username → phone**, kecuali `LOGIN_ID_PREF` di-set.
5. Pref menunjuk field kosong → fall through ke urutan default.

| Isi env                     | Yang dipakai login    |
| --------------------------- | --------------------- |
| email saja                  | email                 |
| username + phone            | username              |
| email + phone, `PREF=phone` | phone                 |
| password saja               | **tidak login-ready** |

---

## Single vs multi vs **general**

| Konsep                         | Arti                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Single-role**                | Hanya role `user` (`TEST_USER_*`)                                                                 |
| **Multi-role**                 | Beberapa role di file env yang sama (`user` + `finance` + …)                                      |
| **Mode general** (requirement) | Tidak ada `Role scope` — skenario non-RBAC; auth default = **`user`**, bukan role bernama general |
| **Mode role-aware**            | Ada `Role scope` — satu spek/auth per role bisnis                                                 |

### Multi tapi hanya isi 1 role

- Nama `user` → diperlakukan seperti single-role.
- Nama lain (mis. `finance`) → wizard menawar **mirror ke `TEST_USER`** agar mode general / auth default tetap jalan (disarankan Ya).
- Multi ≥2 tanpa `user` → diminta mirror/tambah default user.

---

## Setup awal (wizard)

```bash
npm install
npm run setup
```

Wizard **generate** `config/environments/{APP_ENV}.env` sebagai file data yang bersih: hanya key yang aktif, dikelompokkan per section, tanpa komentar placeholder (`.env.example` tetap jadi dokumentasi lengkap). Lalu **auto-encrypt secret saja** (`*_PASSWORD` / `*_SECRET` / `*_TOKEN`); URL, flag, email/username/phone tetap plaintext — boleh diedit di file. `npm run env:edit` pakai helper encrypt yang sama, plus aksi **Rapikan file** untuk rebuild file lama ke format bersih.

---

## Ganti password / tambah role: `npm run env:edit`

```bash
npm run env:status                # APP_ENV + roles readiness
npm run env:use:dev               # pin environment
npm run env:edit                  # menu (file = active APP_ENV)
npm run env:edit:list
```

| Kebutuhan                         | Aksi                                      |
| --------------------------------- | ----------------------------------------- |
| Ganti password / identitas        | **Edit kredensial role**                  |
| Tambah role                       | **Tambah role** (bukan nama `general`)    |
| Hapus role                        | **Hapus role**                            |
| Ganti URL / browser / OTP-CAPTCHA | **Edit BASE_URL / browser / OTP-CAPTCHA** |
| Simpan                            | **Simpan & encrypt**                      |
| Regenerasi auth setup             | **Regenerasi src/support/auth.setup.ts**  |

Auth session: `.auth/{APP_ENV}/<role>.json`.

OTP/CAPTCHA **session assist** (bukan full auto skenario): `AUTH_CHALLENGE_MODE` — lihat [AUTH-CONTEXT-CONVENTION.md](AUTH-CONTEXT-CONVENTION.md).

---

## Refresh session

```bash
npm run auth:setup
# headed (OTP browser / CAPTCHA):
npm run auth:setup:headed
```

---

## Enkripsi

`npm run setup` **wajib** mengenkripsi secret setelah write. Bukan semua key:

| Dienkripsi                                     | Tetap plaintext (edit file OK)                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `*_PASSWORD`, `*_SECRET`, `*_TOKEN`, `API_KEY` | `BASE_URL`, `HEADLESS`, `AUTH_CHALLENGE_MODE`, `*_EMAIL` / `*_USERNAME` / `*_PHONE`, `PLAYWRIGHT_CONFIG` |

Kunci dekripsi: `~/.dotenvx-keys/qa-playwright-kit/.env.keys` (tidak ikut Git).

Ganti password: `npm run env:edit` (bukan edit baris `encrypted:…`).

```bash
npm run env:edit   # menu → Simpan & encrypt (secret keys only)
```

| Item       | Lokasi                                           |
| ---------- | ------------------------------------------------ |
| Env file   | `config/environments/{APP_ENV}.env` (gitignored) |
| Ciphertext | `KEY=encrypted:…` — normal                       |
| Kunci      | `~/.dotenvx-keys/qa-playwright-kit/.env.keys`    |

Lihat [TROUBLESHOOTING.md](TROUBLESHOOTING.md) Error #5.

---

## Related

| Dokumen                                                  | Isi                        |
| -------------------------------------------------------- | -------------------------- |
| [GUIDE.md](GUIDE.md)                                     | Panduan setup & pipeline   |
| [AUTH-CONTEXT-CONVENTION.md](AUTH-CONTEXT-CONVENTION.md) | Auth state per role        |
| [WRITING-REQUIREMENTS.md](WRITING-REQUIREMENTS.md)       | Mode general vs role-aware |
| [CHEATSHEET.md](CHEATSHEET.md)                           | Command ringkas            |
