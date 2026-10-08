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

> **Enforced:** a spec whose requirement declares `Auth state: authenticated` **must** declare a session (`test.use({ storageState: authStatePath('<role>') })`). Otherwise `validate_generated_tests` rejects it — the spec would run unauthenticated and a weak assertion could pass green on the login page. Login-subject specs (`login*.spec.ts` / `@auth`) are exempt. For an intentional anonymous check, declare an explicit empty storageState: `test.use({ storageState: { cookies: [], origins: [] } })`.

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

| Field | Nilai |
| --- | --- |
| Test ID | TC-FIN-003 |
| Covers | AC-03 |
| Role | `hrd` |
| Prekondisi | Logged in as HRD role |
| Langkah | 1. Open the finance approval page |
| Hasil yang Diharapkan | - Page shows "Access denied" message or redirects elsewhere<br>- URL does not contain /finance/approval |
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

Set `AUTH_CHALLENGE_MODE` via `npm run env:edit`. Ordinary feature scenarios that require auth do not need a `(@manual)` tag because auth is handled at the setup level via session state. However, login scenarios that specifically verify OTP/CAPTCHA interaction still carry `(@manual)` in the requirement (see `requirements/_TEMPLATE.md`).

---

## Auth Recovery Protocol (CC-AUTH-RECOVERY)

Trigger: 401/403, `unauthorized`, `session expired`, the test redirects to `/login`, or trace/screenshot shows the page ended on the login page.

1. **Stop healing that file.** Auth failure = `failureSource: 'env'`, `isHealable: false`. Patching locators while the page is stuck on login corrupts the test.
2. **Real re-login via the setup project:** `npm run auth:setup` (OTP/CAPTCHA: `npm run auth:setup:headed`). **Run it yourself** — a plain session refresh is routine and reversible; do not stop to ask QA for permission. Escalate to QA only when a human is genuinely required (OTP/CAPTCHA, credentials not yet filled via `npm run env:edit`) or when the session still fails after this one cycle. This is the only session producer — a real UI login that writes cookies + localStorage + sessionStorage in one pass. Still-valid sessions are reused automatically (cheap, no re-login).
3. **Re-run only the affected spec files**, then resume the phase.
4. **Max 1 re-auth cycle per role per run.** A 401 recurring after a fresh login = a server session TTL / multi-layer session problem → report to QA as FIX ENVIRONMENT, do not loop silently.

### Anti-lockout (the server account can get locked)

The target server (e.g. ERPKu) locks an account after **~3 failed credentials** for **~30 minutes** — and its API message is often generic ("Nama akun atau kata sandi salah") even when `debug.reason: ACCOUNT_LOCKED`.

- **At most 1 negative scenario per suite** and **1 submit click only** — use a **fictional** identifier (e.g. `qa.invalid.user.not.exists`), not a wrong password on a real role account. `login-none.md` SC-06 already does it right; do not add wrong-password variations against real `*_EMAIL` accounts.
- **Do not re-run `npm run auth:setup` repeatedly** with credentials you are not sure are correct — every failed attempt adds to the lockout counter. Still-valid sessions are reused automatically, so a successful `auth:setup` is cheap; repeated failures are expensive.
- If login is valid but the page stays on `/login` and the body contains lock/salah/invalid → do not hard-fail in a way that triggers another attempt; record it as blocked (`ACCOUNT_LOCKED — wait unlock`), and the existing storageState session can still be used by other tests.
- Sequential runs (when needed): the file name prefix sets the order — negative first, then positive roles (`--workers=1` for a multi-role login suite).

### Hard bans

- **NEVER inject storage state**: `browser_set_storage_state`, `context.addCookies`, `localStorage.setItem` tokens, hand-editing `.auth/*.json`. A real login writes many storage layers at once; injection guesses one layer → a fake session that looks green.
- **NEVER log in inside a spec** (`tests/*.spec.ts` filling login forms). Auth flows only through `test.use({ storageState: authStatePath('<role>') })` from the setup project. Exception: the requirement itself is a login scenario (`authState: unauthenticated`) — the login steps are the test subject, not session provisioning.
- **NEVER duplicate/rename session files into fake roles** (e.g. `cp user.json user-2.json` then `authStatePath('user-2')`). A role exists ONLY when its credentials are registered in `config/environments/{APP_ENV}.env` (`<ROLE>_PASSWORD` + identity) and its session is produced by `npm run auth:setup`. A `.auth/` file with no env backing is an orphan → flagged by `auth:verify` and rejected by `validate_generated_tests`. Need another account: `npm run env:edit` → add role → `npm run auth:setup`.

---

## Complex Login Flow Recipes (`src/support/auth.setup.ts`)

`auth.setup.ts` is modular and designed to be customized when an app has extra login interactions beyond simple username + password. Add custom steps directly in `src/support/auth.setup.ts` — add `// CUSTOM_AUTH_FLOW` at the top first: the wizard, `env:edit`, and `npm run upgrade` all skip a marked file automatically, no commit needed.

### Recipe 1: Post-Login Profile / Tenant / Branch Selector

When submitting credentials keeps the user on the same page to pick a user profile, account, or branch before redirecting:

```typescript
await test.step('Isi kredensial dan submit form login', async () => {
  await page.fill('input[name="username"]', cred.loginId);
  await page.fill('input[name="password"]', cred.password);
  await page.click('button[type="submit"]');
});

await test.step('Pilih profil pengguna setelah login', async () => {
  // Wait for the re-rendered profile card/button
  const profileItem = page.getByRole('button', { name: new RegExp(cred.loginId, 'i') }).first();
  await expect(profileItem).toBeVisible({ timeout: 10_000 });
  await profileItem.click();

  // If there is a confirmation button:
  const continueBtn = page.getByRole('button', { name: /lanjutkan|pilih|masuk/i }).first();
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click();
  }
});
```

### Recipe 2: 2-Step Login (Identifier -> Next -> Password)

When the application asks for email/username on screen 1, clicks "Next", then shows the password input on screen 2:

```typescript
await test.step('Isi identifier dan klik Lanjutkan', async () => {
  await page.fill('input[name="email"], input[name="username"]', cred.loginId);
  await page.click('button:has-text("Next"), button:has-text("Lanjutkan")');
});

await test.step('Isi password dan submit', async () => {
  const pwdInput = page.locator('input[type="password"]');
  await expect(pwdInput).toBeVisible({ timeout: 10_000 });
  await pwdInput.fill(cred.password);
  await page.click('button[type="submit"], button:has-text("Login")');
});
```

### Recipe 3: Post-Login Terms / Disclaimer Modal

When a modal dialog appears after password verification requiring acceptance before reaching the dashboard:

```typescript
await test.step('Konfirmasi disclaimer/persetujuan setelah login', async () => {
  const acceptBtn = page.getByRole('button', { name: /saya setuju|agree|accept|lanjutkan/i }).first();
  if (await acceptBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await acceptBtn.click();
  }
});
```

---

### Recipe 4: Company / Tenant Code Typed at Login

Most multi-tenant apps need the company code **before** the credentials. Configure it in env — no code edit needed:

```bash
# config/environments/{APP_ENV}.env
FINANCE_COMPANY=acme
# only when auto-detection misses the field:
# FINANCE_COMPANY_SELECTOR=#tenant-code
```

Tenant delivered by link (subdomain / path / query) needs **no** company key — put it in the role URL instead: `FINANCE_LOGIN_URL_PATH=https://acme.app.com/login` or `/login?company=acme`. If the app instead shows a tenant picker **after** login, use Recipe 1.

---

## Pitfalls

- `general` is a pipeline mode (non-role-aware), NEVER a role name. The sole default role is `user` (with `TEST_USER_*` credentials and `.auth/{APP_ENV}/user.json`). Never output `Role: general` or `role: 'general'`.
- Single role that is not `user` → wizard offers to mirror to `TEST_USER` — answer Yes to keep the general pipeline mode working.
- Auth file valid but redirects to `/login` → the app stores session in localStorage, not cookies. Check that `origins[0].localStorage` is non-empty in `.auth/{APP_ENV}/user.json`.
- Session expired mid-run (401 / redirected to login) → Auth Recovery Protocol above. Do not heal locators, do not inject storage state.
- Specs never log in inside the test body — session provisioning only via the setup project.
- `fullyParallel: true` → tests within a single file also run concurrently. Scenarios that mutate shared account state (logout, password/profile change, session revoke) MUST be serialized: `test.describe.configure({ mode: 'serial' })` for the group, or `lock: '<role>-account'` (Playwright ≥1.63) when other files use the same account. Never disable global parallelism.
- Roles come from env only: a `.auth/*.json` file whose credentials are not in env is an orphan (duplication artifact), not a valid role — `auth:verify` flags it and `validate_generated_tests` rejects specs that use it.
- Do not share one account across multiple QA members on a shared environment — create isolated accounts per team member.
- Tenant mismatch: a saved session stamped for another company is refused — `snapshot_page` / `discover_pages` return `warnings` and capture WITHOUT that session; `health_check` / `pipeline_status` report the role not-ready; specs abort before navigation. Fix is `npm run auth:setup`, not a locator heal. Set `{ROLE}_COMPANY` (or the tenant-scoped login URL) per role; the framework throws when the key is set but no company input matches — fix the selector, do not delete the key.
- Company `<select>` is filled via `selectOption` (value or label). Set `{ROLE}_COMPANY_SELECTOR` only when the field name is not company/tenant/organization/workspace.
