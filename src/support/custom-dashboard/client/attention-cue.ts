/**
 * Attention cue lifecycle for the "Open report" button.
 *
 * The cue loops indefinitely so a QA who looks away and comes back still sees
 * it. Two things must not happen as a result: the loop must not keep repainting
 * while the card is scrolled out of view, and it must not fight a user who has
 * already found the button (CSS handles hover/focus).
 *
 * Background tabs are already covered by the browser, which throttles CSS
 * animations there — this only handles the offscreen case.
 */
export function buildAttentionCueJs(): string {
  return `
  (function () {
    var cue = document.querySelector('.latest-run-card__actions .btn-primary');
    if (!cue || typeof IntersectionObserver !== 'function') return;
    var arrow = cue.querySelector('svg');

    function setPaused(paused) {
      var state = paused ? 'paused' : 'running';
      cue.style.animationPlayState = state;
      if (arrow) arrow.style.animationPlayState = state;
    }

    new IntersectionObserver(function (entries) {
      setPaused(!entries[0].isIntersecting);
    }, { threshold: 0 }).observe(cue);
  })();
  `;
}
