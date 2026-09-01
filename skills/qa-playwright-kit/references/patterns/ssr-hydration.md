# SSR Hydration & Modern Frontend Patterns

Pencegahan flakiness pada aplikasi Single Page Apps (SPA) & Server-Side Rendering (Next.js, Remix, TanStack Start).

## 1. Menghindari Hydration Click Trap

Pada web SSR, tombol HTML bisa muncul sebelum JavaScript event listener terpasang. Klik AI yang terlalu cepat bisa tidak memicu aksi apapun.

* ✅ **Pola Pencegahan:**
  ```ts
  // Pastikan form sudah responsif sebelum klik submit
  const submitBtn = page.getByRole('button', { name: /submit/i });
  await expect(submitBtn).toBeVisible();
  await expect(submitBtn).toBeEnabled();
  
  // Tunggu network idle jika ada dynamic bundle fetching
  await page.waitForLoadState('domcontentloaded');
  await submitBtn.click();
  ```

## 2. Dialogs & Radix UI Popovers

Komponen dropdown/popover modern melepaskan elemen ke `document.body` (Portal). Cari elemen berdasarkan role accessible global:

```ts
await page.getByRole('combobox', { name: /pilih kategori/i }).click();
await expect(page.getByRole('listbox')).toBeVisible();
await page.getByRole('option', { name: 'Elektronik' }).click();
```
