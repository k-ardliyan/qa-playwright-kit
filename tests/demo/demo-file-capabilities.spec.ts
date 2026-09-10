// req: (demo — file capability kit self-test)
// seed: src/tests/seed.spec.ts
// generated-at: 2026-07-24T00:00:00.000Z
/**
 * Demo: download / upload / PDF content helpers (offline).
 * Uses demo fixture tokens only — not a product domain schema.
 *
 * Run: npx playwright test src/tests/demo/demo-file-capabilities.spec.ts --project=demo
 */
import * as fs from 'node:fs';
import { test, expect } from '@/fixtures/base.fixture';
import {
  assertDownloadedEnvelope,
  assertPdfContains,
  downloadAndSave,
  fixturePath,
  uploadFixture,
} from '@/support/pw';

test.describe('File capabilities demo @demo @download @upload @file-content', () => {
  test('upload fixture into file input', async ({ page }) => {
    await test.step('Render file input and upload fixture', async () => {
      await page.setContent(`
      <html><body>
        <label>Upload <input type="file" id="f" /></label>
      </body></html>
    `);
      await uploadFixture(page.locator('#f'), 'images/sample.png');
      const name = await page
        .locator('#f')
        .evaluate((el: HTMLInputElement) => el.files?.[0]?.name ?? '');
      expect(name).toBe('sample.png');
    });
  });

  test('download blob and assert envelope', async ({ page }) => {
    await test.step('Trigger download and assert envelope', async () => {
      const payload = 'demo-download-body';
      await page.setContent(`
      <html><body>
        <a id="dl" download="demo-export.txt" href="data:text/plain,${payload}">Download</a>
      </body></html>
    `);
      const { path: saved, suggestedFilename } = await downloadAndSave(page, () =>
        page.locator('#dl').click(),
      );
      expect(suggestedFilename).toBe('demo-export.txt');
      await assertDownloadedEnvelope(saved, { minBytes: 1, ext: '.txt' });
      expect(fs.readFileSync(saved, 'utf8')).toContain('demo-download-body');
    });
  });

  test('PDF sample contains demo tokens only', async () => {
    await test.step('Assert PDF demo tokens', async () => {
      const pdf = fixturePath('pdf', 'sample-text.pdf');
      await assertPdfContains(pdf, ['QA-KIT-SAMPLE-PDF', 'TOKEN-ALPHA']);
    });
  });
});
