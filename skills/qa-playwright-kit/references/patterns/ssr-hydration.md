# SSR Hydration & Modern Frontend Patterns

Flakiness prevention for Single Page Apps (SPA) and Server-Side Rendering (Next.js, Remix, TanStack Start).

## 1. Avoiding the Hydration Click Trap

On SSR web apps, the HTML button can appear before the JavaScript event listener is attached. An AI click that fires too early can trigger no action at all.

- ✅ **Prevention pattern:**

  ```ts
  // Make sure the form is responsive before clicking submit
  const submitBtn = page.getByRole('button', { name: /submit/i });
  await expect(submitBtn).toBeVisible();
  await expect(submitBtn).toBeEnabled();

  // Wait for network idle if there is dynamic bundle fetching
  await page.waitForLoadState('domcontentloaded');
  await submitBtn.click();
  ```

## 2. Dialogs & Radix UI Popovers

Modern dropdown/popover components portal their elements into `document.body`. Find elements by their global accessible role:

```ts
await page.getByRole('combobox', { name: /select category/i }).click();
await expect(page.getByRole('listbox')).toBeVisible();
await page.getByRole('option', { name: 'Electronics' }).click();
```
