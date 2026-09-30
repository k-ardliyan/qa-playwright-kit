# Polling & Async Waiting Patterns (Anti-Flaky)

Use these patterns for asynchronous UI instead of `page.waitForTimeout` (a hardcoded sleep makes tests flaky and slow — always replace it with auto-waiting, `expect.poll`, or web-first assertions). Async wait / concurrency is the #1 measured cause of flaky tests (FSE 2014, ICSME 2022) — this rule is the highest-value one in the pack.

## 1. Polling Assertion State (`expect.poll`)

Use `expect.poll` when waiting for a data/status/text change that needs a time interval:

```ts
await expect.poll(async () => {
  return await page.getByTestId('order-status-badge').textContent();
}, {
  message: 'Order status did not become Completed within the timeout',
  intervals: [500, 1000, 2000],
  timeout: 10_000,
}).toBe('Completed');
```

## 2. Dynamic Web Assertions over Bare Sleeping

- ❌ **Wrong:**

  ```ts
  await page.waitForTimeout(3000);
  expect(await page.locator('.toast').isVisible()).toBeTruthy();
  ```

- ✅ **Correct (auto-retrying assertion):**

  ```ts
  await expect(page.locator('.toast')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.toast')).toHaveText(/saved successfully/i);
  ```

## 3. Network Response Awaiting

Use `page.waitForResponse` before triggering a click on a mutating form:

```ts
const [response] = await Promise.all([
  page.waitForResponse((res) => res.url().includes('/api/v1/orders') && res.status() === 200),
  page.getByRole('button', { name: /save order/i }).click(),
]);
```
