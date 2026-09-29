# PLAN-XXX: Test Plan for [Feature Name]

<!--
  CARA PAKAI TEST PLAN TEMPLATE (v2.0 — format tabel):
  1. Dibuat oleh Planner Agent dari RequirementContractV1.
  2. Format: Markdown di specs/nama-fitur.plan.md.
  3. Divalidasi via MCP: compile_test_plan dan validate_plan.

  ATURAN TABEL:
  - Pisahkan beberapa item dalam satu sel dengan <br>
  - Escape karakter pipe di dalam sel dengan \|
  - Label kolom kiri WAJIB persis seperti contoh (parser membacanya)
-->

## Metadata

| Field                   | Nilai                        |
| ----------------------- | ---------------------------- |
| Source requirement      | `requirements/nama-fitur.md` |
| Source requirement hash | `[requirement-source-hash]`  |
| Module                  | `[nama-modul]`               |
| Feature                 | `[nama-fitur]`               |
| Seed                    | `seed:[entity].[state]`      |

## Catalog Evidence

| Page         | Catalog                                           |
| ------------ | ------------------------------------------------- |
| `login-form` | `artifacts/selector-catalog/auth/login-form.json` |

## Scenarios

### SC-01: [Nama Skenario] (@automated)

| Field                 | Nilai                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-XXX-001`                                                                                                                                                              |
| Covers                | `AC-01`, `AC-02`                                                                                                                                                          |
| Actor                 | `finance`                                                                                                                                                                 |
| Auth Context          | `finance`                                                                                                                                                                 |
| Execution Mode        | `automated`                                                                                                                                                               |
| Data Setup            | Seed entity in pending state                                                                                                                                              |
| Actions               | 1. Navigate to /feature/path<br>2. Fill form inputs<br>3. Click submit button                                                                                             |
| Assertions            | `[requirement]` Status changes to expected value<br>`[framework-derived]` Network request succeeds with status 200<br>`[live-verification]` Toast notification is visible |
| Locator Intent        | `input[name="title"]`<br>`button[type="submit"]`                                                                                                                          |
| Network Expectations  | `POST /api/feature` -> 200                                                                                                                                                |
| Artifact Expectations | screenshot on failure                                                                                                                                                     |
| Cleanup               | none                                                                                                                                                                      |
| Unknowns              | none                                                                                                                                                                      |

---

## Coverage Gaps

| Scenario | AC      | Reason                                               |
| -------- | ------- | ---------------------------------------------------- |
| `SC-03`  | `AC-04` | External OTP authentication requires physical device |
