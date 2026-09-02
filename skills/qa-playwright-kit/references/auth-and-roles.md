# Auth and multi-role testing

Load when the requirement has `Auth state: authenticated`, `Role scope` is set, or a scenario uses `(@access-restriction)`.

---

## Auth state field meaning

| `Auth state`      | Meaning                              | Spec implication                                                     |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `unauthenticated` | Page opens without login             | No `test.use({ storageState })` needed                               |
| `authenticated`   | Must be logged in as a specific role | Generator sets `test.use({ storageState: authStatePath('<role>') })` |

---

## Steps before Generate (auth required)

1. `npm run env:edit` — confirm role credentials exist and are not placeholder values
2. `npm run auth:setup` — materialise `.auth/{APP_ENV}/{role}.json`
3. `npm run setup:check` — verify `rolesReady` lists the expected role names

Without a valid auth file the test opens the login page instead of the target page.

---

## Checking role readiness

```bash
npm run env:status     # shows APP_ENV and per-role status
npm run setup:check    # shows rolesReady / rolesEncrypted / rolesIncomplete
```

`rolesEncrypted` = credentials exist but are dotenvx-encrypted → `npm run env:edit` to view/edit → re-run `npm run auth:setup`.

---

## `(@access-restriction)` scenario pattern

```markdown
### SC-03: HRD Denied Access to Approval Page (@access-restriction)

- **Test ID:** TC-FIN-003
- **Covers:** AC-03

**Prekondisi:** Logged in as HRD role

**Langkah:**
1. Open the finance approval page

**Hasil yang Diharapkan:**
- Page shows "Access denied" message or redirects elsewhere
- URL does not contain /finance/approval
```

This pattern generates a test that asserts **denial**, not success. The Generator uses `storageState: authStatePath('hrd')`.

---

## Role scope and Access Matrix

Fill the Access Matrix when multiple roles are in scope. The Planner uses it to determine how many spec files to generate.

```markdown
| Role        | Access | Expectation                              |
| ----------- | ------ | ---------------------------------------- |
| finance     | allow  | Can approve pending invoices             |
| hrd         | deny   | Redirected to 403 or another page        |
| super-admin | allow  | Can approve all invoices                 |
```

Each `deny` row produces a separate `(@access-restriction)` scenario.

---

## One spec per role (Generator output)

The Generator creates `tests/{feature}-{role}.spec.ts` as separate files. `test.use({ storageState })` is set at the file level, not per-test.

Example output:
- `tests/approve-invoice-finance.spec.ts` — storageState `finance`
- `tests/approve-invoice-hrd.spec.ts` — storageState `hrd`

---

## OTP / CAPTCHA

If the app requires OTP or CAPTCHA during login:

```bash
npm run auth:setup:headed   # opens browser → log in manually → session saved
```

Set `AUTH_CHALLENGE_MODE` via `npm run env:edit`. Do not mark a scenario `(@manual)` just because there is OTP — auth is handled at the setup level, not inside tests.

---

## Pitfalls

- `general` is a pipeline mode (non-role-aware), NEVER a role name. The sole default role is `user` (with `TEST_USER_*` credentials and `.auth/{APP_ENV}/user.json`). Never output `Role: general` or `role: 'general'`.
- Single role that is not `user` → wizard offers to mirror to `TEST_USER` — answer Yes to keep the general pipeline mode working.
- Auth file valid but redirects to `/login` → the app stores session in localStorage, not cookies. Check that `origins[0].localStorage` is non-empty in `.auth/{APP_ENV}/user.json`.
- Do not share one account across multiple QA members on a shared environment — create isolated accounts per team member.
