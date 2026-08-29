# Generator: test.step titles

Load when generating or healing `tests/*.spec.ts`, or when Table View Test Step shows Playwright API names.

Hard contract for Phase 2 (Generate) and Heal when rewriting specs. Implements the QA report language: Test Step = requirement step text, Input Data = metadata, Actual = Expected on pass.

Also required by `.github/agents/generator.agent.md` (wrap actions in `test.step()`, `setTestMetadata` first, `captureActualResult` after last assertion).

Copy step titles from the requirement verbatim. If the requirement is in Indonesian, titles stay in Indonesian. Do not translate.

## Pattern

```ts
test('TC-AUTH-001: Login succeeds with valid email and password', async ({ page }) => {
  setTestMetadata({
    testId: 'TC-AUTH-001',
    module: 'auth',
    feature: 'login-valid',
    priority: 'HIGH',
    affectedLayer: ['FE', 'BE'],
    inputData: {
      email: 'credential:user.email',
      password: 'credential:user.password',
    },
    expectedResult:
      'Browser URL changes to /dashboard; header shows "Welcome"; Logout button is visible',
  });

  await test.step('Type the email in the Email field', async () => {
    await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL!);
  });

  await test.step('Type the password in the Password field', async () => {
    await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
  });

  await test.step('Click the "Sign in" button', async () => {
    await page.getByRole('button', { name: 'Sign in' }).click();
  });

  await test.step('URL changes to /dashboard and greeting is visible', async () => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('Welcome')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
    captureActualResult(
      'Browser URL changes to /dashboard; header shows "Welcome"; Logout button is visible',
    );
  });
});
```

Table View Test Step for this test:

```
1. Type the email in the Email field
2. Type the password in the Password field
3. Click the "Sign in" button
4. URL changes to /dashboard and greeting is visible
```

Playwright's auto `Expect "getByText('Welcome')" to be visible` is nested inside step 4 — Accordion only.

## Rules

1. One `test.step` per requirement step. Title = step text (strip leading number).
2. Optional final step for the assertion bundle, titled from the expected result (keep it short).
3. `fill` / `click` / `toBeVisible` / `getByRole` live **inside** the callback, never as the step title.
4. Values live in `inputData`, not in step titles.
5. `captureActualResult` argument **equals** `expectedResult` (same string, character-for-character).
6. Import `setTestMetadata` and `captureActualResult` from `tests/fixtures.ts` (or `@/public/metadata`). Never invent a second metadata helper.
7. `test.skip` / skeleton: still call `setTestMetadata`; omit `captureActualResult`.

## Wrong (the QA complaint)

```ts
await page.getByLabel('Email').fill('qa@acme.com');
await expect(page.getByText('Welcome')).toBeVisible();
captureActualResult('Page loaded');
```

Dashboard then shows:

- Test Step: `Expect "getByText('Welcome')" to be visible`
- Input Data: empty
- Expected: (from metadata, maybe OK)
- Actual: `Page loaded` (≠ Expected)

## Heal

If a failing or passing row shows Playwright API names in Test Step, classify `failureSource: ai_generation` (or `test` if a human edited the spec) and wrap the body in `test.step` titles copied verbatim from the requirement steps. Do not change dashboard formatters to hide the APIs — fix the spec.
