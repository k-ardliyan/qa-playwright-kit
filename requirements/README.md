# Requirements

Folder ini untuk **file requirement fitur** yang dibaca Planner / pipeline Hermes.

## Penamaan penting

| File                                   | Arti                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `login.md`                             | **REAL** — requirement setup awal website kamu. **Tidak di-generate otomatis** — salin dari `_TEMPLATE.md` lalu isi. |
| `sample-*.md`                          | **SAMPLE format** — latihan / referensi. Bukan target app kamu.                                                      |
| `_TEMPLATE.md`                         | Template kosong untuk fitur baru.                                                                                    |
| `_GOOD_EXAMPLE.md` / `_BAD_EXAMPLE.md` | Referensi gaya penulisan.                                                                                            |

Locator **berbeda per website**. Pipeline setup awal wajib:

1. `snapshot_page` → `artifacts/selector-catalog/auth/login.json` (atau path setara)
2. Plan → Generate (Path A: inline locator dari catalog)
3. Execute → Heal → Report

## Cara pakai (setup awal)

```bash
# buat requirement dari template (wizard tidak membuat file ini):
cp _TEMPLATE.md login.md
# isi: judul, Metadata (module/feature/tags), Kriteria Penerimaan, Skenario Uji

npm run qa:run -- requirements/login.md
# paste prompt Hermes (termasuk snapshot_page per site)
```

## Cara pakai (fitur baru)

1. Salin [`_TEMPLATE.md`](_TEMPLATE.md) → `nama-fitur.md`
2. Isi metadata wajib + skenario
3. Validasi: `npm run validate:requirement -- requirements/nama-fitur.md`
4. Pipeline Hermes

## Sample (latihan format saja)

- [`sample-login-empty-fields.md`](auth/sample-login-empty-fields.md) — empty-field + `@manual` CAPTCHA (Path B sample)
- [`sample-network-hybrid.md`](auth/sample-network-hybrid.md) — `@network` + `@hybrid` + `@aria`
- [`sample-network-assert.md`](auth/sample-network-assert.md) — `@network-assert` live payload/response (+ mock failure)
- [`_GOOD_EXAMPLE.md`](_GOOD_EXAMPLE.md) / [`_BAD_EXAMPLE.md`](_BAD_EXAMPLE.md)

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
