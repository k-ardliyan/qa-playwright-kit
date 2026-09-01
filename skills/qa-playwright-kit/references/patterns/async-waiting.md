# Polling & Async Waiting Patterns (Anti-Flaky)

Gunakan pola ini untuk mengatasi UI asinkron tanpa menggunakan `page.waitForTimeout` (hardcoded sleep dilarang oleh ARCH-013).

## 1. Polling Assertion State (`expect.poll`)

Gunakan `expect.poll` ketika menunggu perubahan status data atau atribut teks yang memerlukan interval waktu:

```ts
await expect.poll(async () => {
  return await page.getByTestId('order-status-badge').textContent();
}, {
  message: 'Status pesanan tidak berubah menjadi Completed dalam batas waktu',
  intervals: [500, 1000, 2000],
  timeout: 10_000,
}).toBe('Completed');
```

## 2. Dynamic Web Assertions over Bare Sleeping

* ❌ **Salah:**
  ```ts
  await page.waitForTimeout(3000);
  expect(await page.locator('.toast').isVisible()).toBeTruthy();
  ```

* ✅ **Benar (Auto-retrying assertion):**
  ```ts
  await expect(page.locator('.toast')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.toast')).toHaveText(/berhasil disimpan/i);
  ```

## 3. Network Response Awaiting

Gunakan `page.waitForResponse` sebelum melakukan trigger klik pada form mutasi:

```ts
const [response] = await Promise.all([
  page.waitForResponse((res) => res.url().includes('/api/v1/orders') && res.status() === 200),
  page.getByRole('button', { name: /simpan pesanan/i }).click(),
]);
```
