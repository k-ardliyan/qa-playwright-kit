/** @jsxImportSource @kitajs/html */
import { IconX } from '../shared/icons';

/**
 * ConfirmDialog — one shared promise-based confirm for important actions.
 *
 * Native `<dialog>` (showModal) so focus trapping, Escape, and the top layer
 * come from the platform. The client API `window.studioConfirm({...})` (see
 * client/confirm.ts) fills #confirm-title / #confirm-desc and resolves on the
 * OK / Cancel buttons. Tone 'danger' switches the OK button to .btn-danger.
 */
export function ConfirmDialog() {
  return (
    <dialog class="confirm-dialog" id="confirm-dialog" aria-labelledby="confirm-title">
      <div class="confirm-dialog__card">
        <div class="confirm-dialog__head">
          <h3 class="confirm-dialog__title" id="confirm-title">
            Konfirmasi
          </h3>
          <button class="btn-close" type="button" id="confirm-close" aria-label="Tutup">
            <IconX size={14} />
          </button>
        </div>
        <p class="confirm-dialog__desc" id="confirm-desc" hidden />
        <div class="confirm-dialog__foot">
          <button class="btn btn-secondary" type="button" id="confirm-cancel">
            Batal
          </button>
          <button class="btn btn-primary" type="button" id="confirm-ok">
            Lanjutkan
          </button>
        </div>
      </div>
    </dialog>
  );
}
