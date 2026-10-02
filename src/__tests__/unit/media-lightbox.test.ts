import { test, expect } from '@playwright/test';
import { MediaLightbox } from '../../support/custom-dashboard/components/shared/MediaLightbox';
import { buildMediaLightboxJs } from '../../support/custom-dashboard/client/media-lightbox';
import { Attachments } from '../../support/custom-dashboard/components/detail/Attachments';
import { NotesCell } from '../../support/custom-dashboard/components/table/TableCells';
import { buildClientBootstrapJs } from '../../support/custom-dashboard/client/bootstrap';
import type { CollectedTestData } from '../../support/custom-dashboard/types';

/**
 * The evidence lightbox replaces "opens in a new tab" with an in-page dialog.
 * These contracts pin the parts a refactor would silently drop: the dialog
 * being a real <dialog>, the media kinds wiring the right preview attribute,
 * and the bootstrap actually shipping the behavior.
 */
test.describe('media lightbox contracts', () => {
  test('the dialog is a native <dialog> with both media stages', () => {
    const html = String(MediaLightbox());
    expect(html).toContain('<dialog');
    expect(html).toContain('id="media-lightbox"');
    // One stage serves both kinds; the client unhides exactly one.
    expect(html).toContain('id="media-lightbox-img"');
    expect(html).toContain('id="media-lightbox-video"');
    // Escape hatch for full-resolution inspection and saving.
    expect(html).toContain('id="media-lightbox-open"');
    expect(html).toContain('Open in new tab');
  });

  test('the client bundle ships the lightbox behavior', () => {
    const js = buildClientBootstrapJs();
    expect(js).toContain('data-media-preview');
    expect(js).toContain('showModal');
    expect(js).toContain('closeMediaLightbox');
    // Fallback for browsers without <dialog>.showModal().
    expect(js).toContain("window.open(src, '_blank', 'noopener')");
    // Backdrop dismissal must be judged on where the gesture started.
    expect(js).toContain('downOnBackdrop');
  });

  test('a paused video is stopped when the dialog closes', () => {
    const js = buildMediaLightboxJs();
    // Audio continuing after close is the classic lightbox bug.
    expect(js).toContain('vid.pause()');
  });

  test('the scroll lock is released on both close paths', () => {
    const js = buildMediaLightboxJs();
    // The page behind the preview must not scroll while it is open…
    expect(js).toContain("document.body.style.overflow = lock ? 'hidden' : ''");
    // …and the native Escape close bypasses closeLightbox(), so the dialog's
    // own close event has to clear the lock too.
    expect(js).toContain("dlgEl.addEventListener('close'");
  });

  test('the image alt names the attachment, not an empty string', () => {
    const js = buildMediaLightboxJs();
    // In a viewer the image is the content — an empty alt leaves a screen
    // reader with nothing to announce.
    expect(js).toContain("img.alt = 'Evidence preview: '");
    const html = String(MediaLightbox());
    expect(html).not.toContain('alt=""');
  });

  test('screenshots and videos declare their preview kind', () => {
    const html = String(
      Attachments({
        attachments: [
          { kind: 'screenshot', name: 'shot.png', relativePath: 'attachments/shot.png' },
          {
            kind: 'video',
            name: 'rec.webm',
            relativePath: 'attachments/rec.webm',
            contentType: 'video/webm',
          },
        ],
      }),
    );
    expect(html).toContain('data-media-preview="image"');
    expect(html).toContain('data-media-preview="video"');
    expect(html).toContain('data-media-name="shot.png"');
    expect(html).toContain('data-media-name="rec.webm"');
    // The href stays real so middle-click / no-JS still reach the file.
    expect(html).toContain('href="/attachments/shot.png"');
  });

  test('both attachment cards carry the same zoom control', () => {
    const html = String(
      Attachments({
        attachments: [
          { kind: 'screenshot', name: 'shot.png', relativePath: 'attachments/shot.png' },
          {
            kind: 'video',
            name: 'rec.webm',
            relativePath: 'attachments/rec.webm',
            contentType: 'video/webm',
          },
        ],
      }),
    );
    // A screenshot used to rely on the image being clickable, so the two cards
    // looked unlike each other. Both now expose an explicit expand button.
    const expandButtons = html.match(/attachment-card__expand/g) ?? [];
    expect(expandButtons.length, 'one zoom control per media card').toBe(2);
    expect(html).toContain('Preview screenshot larger');
    expect(html).toContain('Preview video larger');
  });

  test('the table renders a real video thumbnail, not a text chip', () => {
    const testRow = {
      testId: 'SC-V1',
      title: 'Video evidence test',
      status: 'failed',
      attachments: [{ kind: 'video', name: 'rec.webm', relativePath: 'attachments/rec.webm' }],
      errors: [],
      steps: [],
      affectedLayer: [],
      retry: 0,
      duration: 900,
    } as unknown as CollectedTestData;

    const html = String(NotesCell({ test: testRow }));
    // A bare "video" chip made the two evidence kinds look unlike each other.
    expect(html).toContain('evidence-thumb--video');
    expect(html).toContain('<video');
    expect(html).toContain('evidence-play');
    expect(html).not.toContain('>video</a>');
  });

  test('the NOTES cell routes both media kinds through the lightbox', () => {
    const testRow = {
      testId: 'SC-X1',
      title: 'Evidence test',
      status: 'failed',
      attachments: [
        { kind: 'screenshot', name: 'a.png', relativePath: 'attachments/a.png' },
        { kind: 'video', name: 'b.webm', relativePath: 'attachments/b.webm' },
        { kind: 'trace', name: 'c.zip', relativePath: 'attachments/c.zip' },
      ],
      errors: [],
      steps: [],
      affectedLayer: [],
      retry: 0,
      duration: 1200,
    } as unknown as CollectedTestData;

    const html = String(NotesCell({ test: testRow }));
    expect(html).toContain('data-media-preview="image"');
    expect(html).toContain('data-media-preview="video"');
    // The trace is a download, not a preview — it must stay a plain link.
    expect(html).toContain('attachments/c.zip');
    expect(html).not.toContain('data-media-preview="trace"');
  });
});
