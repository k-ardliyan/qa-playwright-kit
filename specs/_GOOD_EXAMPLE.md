# PLAN-AUTH-001: Test Plan for User Login

## Metadata

| Field              | Nilai                           |
| ------------------ | ------------------------------- |
| Source requirement | `requirements/_GOOD_EXAMPLE.md` |
| Module             | `auth`                          |
| Feature            | `login-valid`                   |
| Seed               | `seed:user.default`             |

## Catalog Evidence

| Page         | Catalog                                           |
| ------------ | ------------------------------------------------- |
| `login-page` | `artifacts/selector-catalog/auth/login-form.json` |

## Scenarios

### SC-01: Login Berhasil dengan Email dan Password Valid (@automated)

| Field                 | Nilai                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-AUTH-001`                                                                                                                                                                                                           |
| Covers                | `AC-01`, `AC-02`                                                                                                                                                                                                        |
| Actor                 | `user`                                                                                                                                                                                                                  |
| Auth Context          | `user`                                                                                                                                                                                                                  |
| Execution Mode        | `automated`                                                                                                                                                                                                             |
| Data Setup            | Seed user account with valid password                                                                                                                                                                                   |
| Actions               | 1. Navigate to /login<br>2. Fill input[name="email"] with credential:user.email<br>3. Fill input[name="password"] with credential:user.password<br>4. Click button[type="submit"]                                       |
| Assertions            | `[requirement]` URL redirects to /dashboard<br>`[requirement]` Dashboard header displays greeting text<br>`[requirement]` Cookie session_id is stored in browser<br>`[framework-derived]` Page title contains Dashboard |
| Locator Intent        | `input[name="email"]`<br>`input[name="password"]`<br>`button[type="submit"]`<br>`header .user-greeting`                                                                                                                 |
| Network Expectations  | `POST /api/auth/login` -> 200                                                                                                                                                                                           |
| Artifact Expectations | screenshot on failure                                                                                                                                                                                                   |
| Cleanup               | clear session cookies                                                                                                                                                                                                   |
| Unknowns              | none                                                                                                                                                                                                                    |

---

### SC-02: Login Gagal dengan Password Salah (@automated)

| Field                 | Nilai                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-AUTH-002`                                                                                                                                                                                        |
| Covers                | `AC-03`                                                                                                                                                                                              |
| Actor                 | `user`                                                                                                                                                                                               |
| Auth Context          | `user`                                                                                                                                                                                               |
| Execution Mode        | `automated`                                                                                                                                                                                          |
| Data Setup            | Seed user account; the typed password is intentionally wrong                                                                                                                                         |
| Actions               | 1. Navigate to /login<br>2. Fill input[name="email"] with credential:user.email<br>3. Fill input[name="password"] with literal:WrongPassword123!<br>4. Click button[type="submit"]                   |
| Assertions            | `[requirement]` URL stays at /login<br>`[requirement]` Red error message appears below the form<br>`[requirement]` Password field is cleared<br>`[framework-derived]` Submit button is enabled again |
| Locator Intent        | `input[name="email"]`<br>`input[name="password"]`<br>`button[type="submit"]`<br>`[role="alert"]`                                                                                                     |
| Network Expectations  | `POST /api/auth/login` -> 401                                                                                                                                                                        |
| Artifact Expectations | screenshot on failure                                                                                                                                                                                |
| Cleanup               | none                                                                                                                                                                                                 |
| Unknowns              | none                                                                                                                                                                                                 |

---

### SC-03: Submit dengan Email Kosong (@automated)

| Field                 | Nilai                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | `TC-AUTH-003`                                                                                                                                                                     |
| Covers                | `AC-04`                                                                                                                                                                           |
| Actor                 | `user`                                                                                                                                                                            |
| Auth Context          | `user`                                                                                                                                                                            |
| Execution Mode        | `automated`                                                                                                                                                                       |
| Data Setup            | Seed user account                                                                                                                                                                 |
| Actions               | 1. Navigate to /login<br>2. Leave the Email field empty<br>3. Fill input[name="password"] with credential:user.password<br>4. Click button[type="submit"]                         |
| Assertions            | `[requirement]` Form submit is rejected and validation shows on the Email field<br>`[requirement]` URL stays at /login<br>`[framework-derived]` No authentication request is sent |
| Locator Intent        | `input[name="email"]`<br>`button[type="submit"]`                                                                                                                                  |
| Network Expectations  | none                                                                                                                                                                              |
| Artifact Expectations | screenshot on failure                                                                                                                                                             |
| Cleanup               | none                                                                                                                                                                              |
| Unknowns              | none                                                                                                                                                                              |

---

## Coverage Gaps

| Scenario | AC      | Reason                                                                       |
| -------- | ------- | ---------------------------------------------------------------------------- |
| `SC-04`  | `AC-05` | Account lockout requires 5 consecutive failures and a time-window reset      |
| `SC-05`  | `AC-06` | Google OAuth popup and external provider consent cannot be automated from CI |
