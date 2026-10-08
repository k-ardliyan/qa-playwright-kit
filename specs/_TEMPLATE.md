# PLAN-XXX: Test Plan for [Feature Name]

<!--
  CARA PAKAI TEST PLAN TEMPLATE (v2.1 — format tabel):
  1. Dibuat oleh Planner Agent dari RequirementContractV1.
  2. Format: Markdown di specs/nama-fitur-test-plan.md.
  3. Divalidasi via MCP: compile_test_plan dan validate_plan.

  ATURAN TABEL:
  - Pisahkan beberapa item dalam satu sel dengan <br>
  - Escape karakter pipe di dalam sel dengan \|
  - Label kolom kiri WAJIB persis seperti contoh (parser membacanya)

  CATATAN: setiap field yang didokumentasikan di file ini BENAR-BENAR dibaca
  parser. Jangan menambah field yang tidak diproses engine.
-->

## Metadata

| Field                   | Nilai                        |
| ----------------------- | ---------------------------- |
| Source requirement      | `requirements/nama-fitur.md` |
| Source requirement hash | `[requirement-source-hash]`  |
| Module                  | `[nama-modul]`               |
| Feature                 | `[nama-fitur]`               |
| Seed                    | `seed:[entity].[state]`      |
| Doctrine                | `doctrine/v2`                |

## Catalog Evidence

| Page         | Catalog                                           |
| ------------ | ------------------------------------------------- |
| `login-form` | `artifacts/selector-catalog/auth/login-form.json` |

## Data Targets

> Opsional. Salin dari requirement; ini yang diperiksa `validate_plan` untuk
> memastikan setiap operasi CRUD yang dijanjikan punya skenario atau Coverage Gap.

| Entity  | Operations       | Covers  |
| ------- | ---------------- | ------- |
| invoice | read, transition | `SC-01` |

## Relationships

> Opsional. Relasi `confirmed` boleh di-assert dan butuh seed terdaftar;
> relasi `assumption` TIDAK boleh menjadi skenario runnable.

| Parent   | Child   | Confidence | Scenario | Seed                   |
| -------- | ------- | ---------- | -------- | ---------------------- |
| customer | invoice | confirmed  | `SC-01`  | `seed:customer.active` |

## Scenarios

> Tag di heading hanya untuk `@manual`, `@blocked`, dan `@not-implemented` —
> ketiganya memaksa `Execution Mode`. Skenario tanpa tag otomatis berjalan
> sebagai `automated` (default), jadi JANGAN menulis `(@automated)`.
> Nilai `Execution Mode` yang sah: `automated`, `manual`, `blocked`,
> `not-implemented`. `Evidence Mode` default `ui-e2e`; gunakan `hybrid-ui`
> hanya dengan tag `@hybrid`, producer seed yang dideklarasikan, cleanup test-owned,
> dan assertion UI pada test yang sama.
>
> Bedanya: `@manual` = tidak berlaku untuk otomasi (CAPTCHA/OTP/biometric —
> daftar tertutup). `@blocked` = bloker nyata berbukti (halaman error, akses
> ditolak). `@not-implemented` = direncanakan tapi belum dibangun (halaman
> belum dieksplorasi, seed belum ada). Bloker dan belum-dibangun WAJIB punya
> entri di `## Coverage Gaps` — itu catatan kerja belum selesai, bukan skip.

### SC-01: [Nama Skenario]

| Field                 | Nilai                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-XXX-001`                                                                                            |
| Covers                | `AC-01`, `AC-02`                                                                                        |
| Actor                 | `finance`                                                                                               |
| Auth Context          | `finance`                                                                                               |
| Page                  | `login-form`                                                                                            |
| Execution Mode        | `automated`                                                                                             |
| Evidence Mode         | `ui-e2e` — default; use `hybrid-ui` only with `@hybrid` + registered seed + safe cleanup                |
| Data Setup            | `seed:[entity].[state]` via registered producer, atau `-`                                               |
| Data Operation        | `create` (opsional: create/read/update/delete/transition)                                               |
| Data Entity           | `invoice` (opsional)                                                                                    |
| Asserts Relation      | `customer-invoices` (opsional; harus ada di `## Relationships`)                                         |
| Actions               | 1. Navigate to /feature/path<br>2. Fill form inputs<br>3. Click submit button                           |
| Assertions            | `[requirement]` Status changes to expected value<br>`[live-verification]` Toast notification is visible |
| Locator Intent        | `input[name="title"]`<br>`button[type="submit"]`                                                        |
| Network Expectations  | `-`                                                                                                     |
| Artifact Expectations | screenshot on failure                                                                                   |
| Cleanup               | `-`                                                                                                     |
| Unknowns              | none                                                                                                    |

---

## Coverage Gaps

| Scenario | AC      | Reason                                               |
| -------- | ------- | ---------------------------------------------------- |
| `SC-03`  | `AC-04` | External OTP authentication requires physical device |
