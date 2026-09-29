# PLAN-AUTH-001: Test Plan for User Login

## Metadata

| Field              | Nilai                           |
| ------------------ | ------------------------------- |
| Source requirement | `requirements/_GOOD_EXAMPLE.md` |
| Module             | auth                            |
| Feature            | login-valid                     |
| Seed               | `seed:user.default`             |

## Catalog Evidence

| Page         | Catalog                                           |
| ------------ | ------------------------------------------------- |
| `login-page` | `artifacts/selector-catalog/auth/login-form.json` |

## Scenarios

### SC-01: Login Berhasil dengan Email dan Password Valid (@automated)

| Field                 | Nilai                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-AUTH-001`                                                                                                                                                                           |
| Covers                | `AC-01`, `AC-02`                                                                                                                                                                        |
| Actor                 | `user`                                                                                                                                                                                  |
| Auth Context          | `user`                                                                                                                                                                                  |
| Execution Mode        | `automated`                                                                                                                                                                             |
| Data Setup            | Seed user default dengan kredensial valid                                                                                                                                               |
| Actions               | 1. Navigate to /login<br>2. Fill email dengan kredensial valid<br>3. Fill password dengan kredensial valid<br>4. Click tombol submit                                                    |
| Assertions            | `[requirement]` Redirect ke `/dashboard` (assert pathname)<br>`[framework-derived]` `POST /api/login` sukses dengan status 200<br>`[live-verification]` Toast "Login berhasil" terlihat |
| Locator Intent        | `input[name="email"]`<br>`input[name="password"]`<br>`button[type="submit"]`                                                                                                            |
| Network Expectations  | `POST /api/login` -> 200                                                                                                                                                                |
| Artifact Expectations | screenshot on failure                                                                                                                                                                   |
| Cleanup               | none                                                                                                                                                                                    |
| Unknowns              | none                                                                                                                                                                                    |

---

### SC-02: Login Gagal dengan Password Salah (@automated)

| Field                 | Nilai                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test ID               | `TC-AUTH-002`                                                                                                                                                            |
| Covers                | `AC-03`                                                                                                                                                                  |
| Actor                 | `user`                                                                                                                                                                   |
| Auth Context          | `user`                                                                                                                                                                   |
| Execution Mode        | `automated`                                                                                                                                                              |
| Data Setup            | Seed user default; password yang diketik sengaja salah                                                                                                                   |
| Actions               | 1. Navigate to /login<br>2. Fill email dengan kredensial valid<br>3. Fill password dengan nilai salah<br>4. Click tombol submit                                          |
| Assertions            | `[requirement]` Tetap di `/login` (pathname tidak berubah)<br>`[requirement]` Pesan error observable muncul<br>`[framework-derived]` `POST /api/login` mengembalikan 401 |
| Locator Intent        | `input[name="email"]`<br>`input[name="password"]`<br>`button[type="submit"]`<br>`[role="alert"]`                                                                         |
| Network Expectations  | `POST /api/login` -> 401                                                                                                                                                 |
| Artifact Expectations | screenshot on failure                                                                                                                                                    |
| Cleanup               | none                                                                                                                                                                     |
| Unknowns              | none                                                                                                                                                                     |

---

## Coverage Gaps

| Scenario | AC      | Reason                                               |
| -------- | ------- | ---------------------------------------------------- |
| `SC-03`  | `AC-04` | External OTP authentication requires physical device |
