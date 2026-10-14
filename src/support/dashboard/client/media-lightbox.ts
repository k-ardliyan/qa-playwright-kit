/**
 * Evidence lightbox behavior — opens screenshot/video previews in the shared
 * <dialog> instead of a new tab.
 *
 * Delegated at the document level so every render site (attachment grid, table
 * NOTES cell, artifacts strip, archived fragments) works with a single
 * listener and no per-surface wiring.
 */
export function buildMediaLightboxJs(): string {
  return `
  (function () {
    function lightbox() { return document.getElementById('media-lightbox'); }

    // A modal <dialog> makes the page inert but does NOT lock the scroll
    // container, so a wheel over the preview scrolls the page behind it and
    // the report lands somewhere else once the dialog closes. The other
    // dialogs in this dashboard use the same body-overflow lock.
    function lockScroll(lock) {
      document.body.style.overflow = lock ? 'hidden' : '';
    }

    // iOS refuses to play a video inline unless playsinline is set before the
    // first play; the JSX types do not carry the attribute, so set it here.
    var vidEl = document.getElementById('media-lightbox-video');
    if (vidEl && !vidEl.hasAttribute('playsinline')) {
      vidEl.setAttribute('playsinline', '');
      vidEl.setAttribute('webkit-playsinline', '');
    }

    function closeLightbox() {
      var dlg = lightbox();
      if (!dlg) return;
      // A video left playing behind a closed dialog keeps its audio going.
      var vid = document.getElementById('media-lightbox-video');
      if (vid && !vid.paused) vid.pause();
      if (dlg.open) dlg.close();
      lockScroll(false);
    }

    function openLightbox(kind, src, name) {
      var dlg = lightbox();
      if (!dlg || !src) return;
      var img = document.getElementById('media-lightbox-img');
      var vid = document.getElementById('media-lightbox-video');
      var openLink = document.getElementById('media-lightbox-open');
      var nameEl = document.getElementById('media-lightbox-name');
      if (!img || !vid) return;

      if (kind === 'video') {
        img.hidden = true;
        img.removeAttribute('src');
        vid.hidden = false;
        vid.src = src;
        // Autoplay is a courtesy, not a requirement — a rejected play() (no
        // user gesture, unsupported codec) must not break the dialog.
        var attempt = vid.play();
        if (attempt && typeof attempt.catch === 'function') attempt.catch(function () {});
      } else {
        if (!vid.paused) vid.pause();
        vid.hidden = true;
        vid.removeAttribute('src');
        img.hidden = false;
        img.src = src;
      }
      if (openLink) openLink.href = src;
      if (nameEl) nameEl.textContent = name || '';
      // The image is the content of a viewer, so its alt must name what is
      // shown; an empty alt would leave a screen reader with nothing.
      if (kind !== 'video' && name) img.alt = 'Evidence preview: ' + name;

      if (typeof dlg.showModal === 'function') {
        if (!dlg.open) {
          dlg.showModal();
          lockScroll(true);
        }
      } else {
        // Pre-dialog browsers: degrade to the old behavior rather than nothing.
        window.open(src, '_blank', 'noopener');
      }
    }

    // A modal <dialog> gives focus trapping and Escape for free, but NOT
    // click-outside-to-dismiss: a backdrop click targets the dialog element
    // itself. Judge it on where the gesture STARTED, or a drag that begins on
    // the media and ends on the dialog padding would close mid-inspection.
    var downOnBackdrop = false;
    document.addEventListener('mousedown', function (e) {
      var dlg = lightbox();
      downOnBackdrop = Boolean(dlg && dlg.open && e.target === dlg);
    });

    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;

      var trigger = e.target.closest('[data-media-preview]');
      if (trigger) {
        e.preventDefault();
        openLightbox(
          trigger.getAttribute('data-media-preview'),
          trigger.getAttribute('href') || trigger.getAttribute('data-media-src'),
          trigger.getAttribute('data-media-name')
        );
        return;
      }

      var dlg = lightbox();
      if (!dlg || !dlg.open) return;

      if (e.target.closest('[data-media-lightbox-close]')) {
        e.preventDefault();
        closeLightbox();
        return;
      }
      // Backdrop click (the dialog's own padding) and the stage's empty area
      // both dismiss, which is what a viewer expects from a lightbox.
      var stage = dlg.querySelector('.media-lightbox__stage');
      if (e.target === dlg && downOnBackdrop) closeLightbox();
      else if (stage && e.target === stage) closeLightbox();
      downOnBackdrop = false;
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var dlg = lightbox();
      if (dlg && dlg.open) closeLightbox();
    });

    // Escape closes a modal <dialog> natively, without going through
    // closeLightbox(), so the scroll lock has to be released on the element's
    // own close event as well — otherwise the page stays frozen after Escape.
    var dlgEl = lightbox();
    if (dlgEl) {
      dlgEl.addEventListener('close', function () { lockScroll(false); });
    }

    window.openMediaLightbox = openLightbox;
    window.closeMediaLightbox = closeLightbox;
  })();
  `;
}
