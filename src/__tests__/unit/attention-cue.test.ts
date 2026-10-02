import { test, expect } from '@playwright/test';
import { buildAttentionCueJs } from '../../support/custom-dashboard/client/attention-cue';
import { buildClientBootstrapJs } from '../../support/custom-dashboard/client/bootstrap';

/**
 * The "Open report" cue loops for as long as the page is open, so the two
 * failure modes it can have are: repainting forever while scrolled out of view,
 * and being scoped to a class rather than to the one button that is a
 * destination.
 */
test.describe('attention cue contracts', () => {
  test('the cue pauses when the button leaves the viewport', () => {
    const js = buildAttentionCueJs();
    expect(js).toContain('IntersectionObserver');
    expect(js).toContain('animationPlayState');
    // Paused while offscreen, resumed when it comes back.
    expect(js).toContain("paused ? 'paused' : 'running'");
  });

  test('the cue targets the card action, not the shared button class', () => {
    const js = buildAttentionCueJs();
    expect(js).toContain('.latest-run-card__actions .btn-primary');
    // A bare `.btn-primary` selector would also catch the history page's Save
    // buttons, which are not a destination.
    expect(js).not.toMatch(/querySelector\('\.btn-primary'\)/);
  });

  test('the bundle ships the cue lifecycle', () => {
    const js = buildClientBootstrapJs();
    expect(js).toContain('IntersectionObserver');
  });
});
