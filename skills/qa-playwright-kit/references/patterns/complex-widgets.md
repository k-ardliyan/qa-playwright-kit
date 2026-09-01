# Complex UI Widgets & Browser Patterns

Panduan penulisan interaksi browser untuk komponen web yang kompleks.

## 1. File Upload / Dropzone (@upload)

Gunakan `fileChooser` event daripada memanipulasi input hidden secara paksa:

```ts
const fileChooserPromise = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /unggah file|upload/i }).click();
const fileChooser = await fileChooserPromise;
await fileChooser.setFiles(fixturePath('documents/sample.pdf'));

await expect(page.getByText('sample.pdf')).toBeVisible();
```

## 2. Nested iFrames / Payment Gateway (@iframe)

Gunakan `frameLocator` untuk berinteraksi di dalam iframe pihak ketiga:

```ts
const paymentFrame = page.frameLocator('iframe[name="midtrans-payment"]');
await paymentFrame.getByRole('button', { name: /bayar sekarang/i }).click();
await expect(paymentFrame.getByText(/pembayaran berhasil/i)).toBeVisible();
```

## 3. Date & Time Mocking (@clock)

Gunakan API `page.clock` Playwright untuk mensimulasikan waktu tanpa mengubah sistem host:

```ts
// Kunci waktu ke tanggal tertentu sebelum navigasi
await page.clock.setFixedTime(new Date('2026-08-31T08:00:00Z'));
await page.goto('/promo');
await expect(page.getByText(/promo berakhir hari ini/i)).toBeVisible();
```
