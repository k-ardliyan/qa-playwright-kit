# Complex UI Widgets & Browser Patterns

Writing guide for browser interactions with complex web components.

## 1. File Upload / Dropzone (@upload)

Use `uploadFixture`, `uploadViaChooser`, or `dropFixture` from `@/support/pw` (or the `filechooser` event):

```ts
import { uploadViaChooser, dropFixture } from '@/support/pw';

// 1. Chooser / button upload
const fileChooserPromise = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /upload file|unggah/i }).click();
const fileChooser = await fileChooserPromise;
await fileChooser.setFiles(fixturePath('documents/sample.pdf'));

await expect(page.getByText('sample.pdf')).toBeVisible();

// 2. Drag & Drop upload zone (Playwright v1.60+ synthetic drop DataTransfer)
await dropFixture(page.locator('.dropzone-area'), 'documents/sample.pdf');
```

## 2. Nested iFrames / Payment Gateway (@iframe)

Use `frameLocator` to interact inside third-party iframes. On Playwright v1.63+, `page.frameLocator()` without an argument also searches across the whole iframe subtree:

```ts
// Specific iframe
const paymentFrame = page.frameLocator('iframe[name="payment-gateway"]');
await paymentFrame.getByRole('button', { name: /pay now/i }).click();
await expect(paymentFrame.getByText(/payment successful/i)).toBeVisible();

// Or search any frame when the iframe selector is dynamic:
await page.frameLocator().getByRole('button', { name: /pay now/i }).click();
```

## 3. Date & Time Mocking (@clock)

Use the Playwright `page.clock` API to simulate time without touching the host system:

```ts
// Pin time to a specific date before navigation
await page.clock.setFixedTime(new Date('2026-08-31T08:00:00Z'));
await page.goto('/promo');
await expect(page.getByText(/promo ends today/i)).toBeVisible();
```
