# Kredensial & Multi-Role

> **Satu halaman** untuk ganti password, tambah/hapus role, dan refresh session login.  
> Setup awal? Mulai dari [GETTING-STARTED.md](GETTING-STARTED.md) (`npm run setup`).

---

## Environment dulu, baru BASE_URL

`BASE_URL` **bukan** global project — isinya di `config/environments/{APP_ENV}.env` dan **boleh beda per env**.

| Urutan benar                               | Contoh                            |
| ------------------------------------------ | --------------------------------- |
| 1. Pilih / pin `APP_ENV`                   | `staging`                         |
| 2. Isi `BASE_URL` + kredensial di file itu | `config/environments/staging.env` |

Wizard Phase 1: **project name → APP_ENV → BASE_URL untuk env itu**.  
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

Phase 1: pilih **APP_ENV**, lalu **BASE_URL untuk env itu**.  
Phase 2: kredensial ke file env yang sama. Nilai di `config/environments/{APP_ENV}.env` bisa dienkripsi via `npm run env:edit` (re-encrypt) — **itu normal**.

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
| Regenerasi auth setup             | **Regenerasi tests/auth.setup.ts**        |

Auth session: `.auth/{APP_ENV}/<role>.json` (legacy `.auth/<role>.json` masih dibaca untuk `local`).

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
| [GETTING-STARTED.md](GETTING-STARTED.md)                 | Setup pertama              |
| [AUTH-CONTEXT-CONVENTION.md](AUTH-CONTEXT-CONVENTION.md) | Auth state per role        |
| [WRITING-REQUIREMENTS.md](WRITING-REQUIREMENTS.md)       | Mode general vs role-aware |
| [GUIDE.md](GUIDE.md)                                     | Pipeline harian            |
