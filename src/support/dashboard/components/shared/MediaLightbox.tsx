/** @jsxImportSource @kitajs/html */
import { IconExternalLink, IconX } from './icons';

/**
 * Global evidence lightbox — one instance per document (mounted in
 * DashboardDocument). Screenshot and video previews open here instead of a new
 * browser tab: a native <dialog> opened with showModal() lands in the top layer
 * with a ::backdrop, makes the page inert, traps focus, and closes on Escape
 * without any JS for those parts.
 *
 * The stage holds both an <img> and a <video>; the client fills one and hides
 * the other, so a single dialog serves both media kinds. "Open in new tab"
 * stays as an escape hatch for full-resolution inspection and for saving.
 */
export function MediaLightbox() {
  return (
    <dialog class="media-lightbox" id="media-lightbox" aria-label="Evidence preview">
      <div class="media-lightbox__head">
        <span class="media-lightbox__name" id="media-lightbox-name" safe />
        <div class="media-lightbox__actions">
          <a
            class="media-lightbox__open"
            id="media-lightbox-open"
            href="#"
            target="_blank"
            rel="noopener"
          >
            <IconExternalLink size={14} />
            <span>Open in new tab</span>
          </a>
          <button
            class="btn-close"
            type="button"
            data-media-lightbox-close
            aria-label="Close preview"
          >
            <IconX size={14} />
          </button>
        </div>
      </div>
      <div class="media-lightbox__stage">
        {/* Both stages ship empty and the client fills the one that matches the
            media kind. A transparent 1×1 data URI (not an empty src) keeps the
            element a valid image, so no browser treats it as a broken request.
            The alt is set with the src: in a viewer the image IS the content,
            so a screen reader needs the attachment name, not an empty alt. */}
        <img
          id="media-lightbox-img"
          alt="Evidence preview"
          src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
          hidden
        />
        {/* `playsinline` is set from the client bundle: KitaJS's JSX types do
            not carry that attribute, and a JS-set attribute is not typechecked. */}
        <video id="media-lightbox-video" controls hidden />
      </div>
    </dialog>
  );
}
