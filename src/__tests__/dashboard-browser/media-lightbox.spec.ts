import { test, expect, type Page } from '@playwright/test';

/**
 * Evidence previews open in the shared <dialog> lightbox instead of a new
 * browser tab. The seeded run carries a screenshot AND a video on SC-L2, so
 * both media paths are exercised against real bytes.
 *
 * These run against the real dashboard server (see config/playwright/dashboard.ts).
 */
test.describe('evidence lightbox', () => {
  /** Open the SC-L2 accordion card with its Attachments chip expanded. */
  async function openEvidenceCard(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#view-accordion details.test-card[data-test-id="SC-L2"]').evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
      el.querySelectorAll('details.chip').forEach((c) => {
        (c as HTMLDetailsElement).open = true;
      });
    });
  }

  /** Three seeded cards carry evidence — every locator must stay on SC-L2. */
  function card(page: Page) {
    return page.locator('#view-accordion details.test-card[data-test-id="SC-L2"]');
  }

  test('clicking a screenshot opens the dialog instead of a new tab', async ({ page }) => {
    await openEvidenceCard(page);
    const dialog = page.locator('#media-lightbox');
    await expect(dialog).not.toBeVisible();

    // No popup may open: the whole point is replacing the new-tab behavior.
    let popupOpened = false;
    page.on('popup', () => {
      popupOpened = true;
    });

    await card(page).locator('.attachment-card--screenshot .attachment-card__media').click();

    await expect(dialog).toBeVisible();
    expect(popupOpened, 'lightbox must not open a new tab').toBe(false);
    // The image stage is filled and the video stage stays out of the way.
    await expect(page.locator('#media-lightbox-img')).toBeVisible();
    await expect(page.locator('#media-lightbox-video')).toBeHidden();
    const src = await page.locator('#media-lightbox-img').getAttribute('src');
    expect(src, 'image src must point at the seeded attachment').toContain('SC-L2.png');
    await expect(page.locator('#media-lightbox-name')).toHaveText('SC-L2.png');
    // The escape hatch points at the same file.
    await expect(page.locator('#media-lightbox-open')).toHaveAttribute('href', /SC-L2\.png$/);
  });

  test('clicking the video preview opens the dialog with the video stage', async ({ page }) => {
    await openEvidenceCard(page);
    const dialog = page.locator('#media-lightbox');

    await card(page).locator('.attachment-card--video .attachment-card__expand').click();

    await expect(dialog).toBeVisible();
    await expect(page.locator('#media-lightbox-video')).toBeVisible();
    await expect(page.locator('#media-lightbox-img')).toBeHidden();
    const src = await page.locator('#media-lightbox-video').getAttribute('src');
    expect(src, 'video src must point at the seeded recording').toContain('SC-L2-recording.webm');
  });

  test('Escape closes the dialog', async ({ page }) => {
    await openEvidenceCard(page);
    const dialog = page.locator('#media-lightbox');

    await card(page).locator('.attachment-card--screenshot .attachment-card__media').click();
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the close button closes the dialog', async ({ page }) => {
    await openEvidenceCard(page);
    const dialog = page.locator('#media-lightbox');

    await card(page).locator('.attachment-card--screenshot .attachment-card__media').click();
    await expect(dialog).toBeVisible();

    await page.locator('#media-lightbox [data-media-lightbox-close]').click();
    await expect(dialog).toBeHidden();
  });

  test('a backdrop click closes the dialog, but a click on the media does not', async ({
    page,
  }) => {
    await openEvidenceCard(page);
    const dialog = page.locator('#media-lightbox');

    await card(page).locator('.attachment-card--screenshot .attachment-card__media').click();
    await expect(dialog).toBeVisible();

    // Clicking the image itself must keep the preview open for inspection.
    await page.locator('#media-lightbox-img').click();
    await expect(dialog).toBeVisible();

    // A click on the dialog's own padding (the backdrop area) dismisses it.
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
  });

  test('the NOTES cell in table view routes media through the same dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=table');
    await page.waitForLoadState('domcontentloaded');

    const thumb = page.locator('#view-table .evidence-thumb').first();
    await expect(thumb).toBeVisible();
    // It must be wired to the lightbox, not a new tab.
    await expect(thumb).toHaveAttribute('data-media-preview', 'image');

    await thumb.click();
    await expect(page.locator('#media-lightbox')).toBeVisible();
    await expect(page.locator('#media-lightbox-img')).toBeVisible();
  });

  test('the table shows a real video thumbnail, and it opens the video stage', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=table');
    await page.waitForLoadState('domcontentloaded');

    // The video evidence used to be a bare "video" text chip beside a real
    // screenshot thumbnail — the two kinds looked unlike each other.
    const videoThumb = page.locator('#view-table .evidence-thumb--video').first();
    await expect(videoThumb).toBeVisible();
    await expect(videoThumb.locator('video')).toBeAttached();
    await expect(videoThumb.locator('.evidence-play')).toBeVisible();

    await videoThumb.click();
    await expect(page.locator('#media-lightbox')).toBeVisible();
    await expect(page.locator('#media-lightbox-video')).toBeVisible();
    await expect(page.locator('#media-lightbox-img')).toBeHidden();
  });

  test('the seeded recording actually decodes a frame', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=table');
    await page.waitForLoadState('domcontentloaded');

    // A 66-byte stub used to load as bytes but never paint. The seed now ships
    // a real VP8 webm, so the thumbnail must reach a non-zero intrinsic size.
    const decoded = await page
      .locator('#view-table .evidence-thumb--video video')
      .first()
      .evaluate(async (el) => {
        const v = el as HTMLVideoElement;
        if (v.readyState >= 1) return { w: v.videoWidth, h: v.videoHeight };
        await new Promise<void>((resolve) => {
          v.addEventListener('loadedmetadata', () => resolve(), { once: true });
          setTimeout(resolve, 3000);
        });
        return { w: v.videoWidth, h: v.videoHeight };
      });

    expect(decoded.w, 'video thumbnail decoded no frame').toBeGreaterThan(0);
    expect(decoded.h).toBeGreaterThan(0);
  });

  test('both attachment cards expose the same zoom control', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#view-accordion details.test-card[data-test-id="SC-L2"]').evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
      el.querySelectorAll('details.chip').forEach((c) => {
        (c as HTMLDetailsElement).open = true;
      });
    });

    const scoped = page.locator('#view-accordion details.test-card[data-test-id="SC-L2"]');
    // A screenshot relied on the image being clickable; the pair now matches.
    await expect(
      scoped.locator('.attachment-card--screenshot .attachment-card__expand'),
    ).toBeVisible();
    await expect(scoped.locator('.attachment-card--video .attachment-card__expand')).toBeVisible();

    // The screenshot's zoom control must open the image stage.
    await scoped.locator('.attachment-card--screenshot .attachment-card__expand').click();
    await expect(page.locator('#media-lightbox')).toBeVisible();
    await expect(page.locator('#media-lightbox-img')).toBeVisible();
    await expect(page.locator('#media-lightbox-video')).toBeHidden();
  });
});

/**
 * A modal <dialog> makes the page inert but does NOT lock the scroll container,
 * so a wheel over the preview used to scroll the page behind it — the report
 * landed somewhere else once the dialog closed. The lock must be released on
 * BOTH close paths: the JS close button and the native Escape close.
 */
test.describe('evidence lightbox scroll lock', () => {
  async function openPreview(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=table');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#view-table .evidence-thumb').first().click();
    await expect(page.locator('#media-lightbox')).toBeVisible();
  }

  test('the page behind the preview cannot scroll while it is open', async ({ page }) => {
    await openPreview(page);
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  });

  test('Escape releases the scroll lock', async ({ page }) => {
    await openPreview(page);

    await page.keyboard.press('Escape');
    await expect(page.locator('#media-lightbox')).toBeHidden();
    // The native close path does not go through closeLightbox(), so the
    // element's own `close` event has to clear the lock.
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });

  test('the close button releases the scroll lock', async ({ page }) => {
    await openPreview(page);

    await page.locator('#media-lightbox [data-media-lightbox-close]').click();
    await expect(page.locator('#media-lightbox')).toBeHidden();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });
});
