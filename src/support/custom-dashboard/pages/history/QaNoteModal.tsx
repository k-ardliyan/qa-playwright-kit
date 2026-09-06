/** @jsxImportSource @kitajs/html */
import { IconEdit, IconSave } from '../../components/shared/icons';

/**
 * Global per-test QA note editor — one instance per document (mounted in
 * DashboardDocument). Opened by the ✎ buttons in the NOTES cell and detail
 * views via the `edit-qa-note` action; served on every page so the table,
 * accordion cards, and archived detail fragments share the same dialog.
 */
export function QaNoteModal() {
  return (
    <div
      class="modal-overlay"
      id="qa-note-modal"
      hidden
      aria-hidden="true"
      style="display:none"
      onclick="if(event.target===this){ closeQaNoteModal && closeQaNoteModal(); }"
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qa-note-modal-title"
        aria-describedby="qa-note-modal-description"
      >
        <div class="modal-head">
          <div class="modal-title-wrap">
            <span class="modal-icon-badge">
              <IconEdit size={16} />
            </span>
            <h3 id="qa-note-modal-title">Catatan QA</h3>
          </div>
          <button
            class="btn-close"
            type="button"
            onclick="closeQaNoteModal && closeQaNoteModal()"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div class="modal-body">
          <p id="qa-note-modal-description" class="sr-only">
            Write or edit the QA note for this test row. Notes are saved per run and archived with
            it.
          </p>
          <div class="form-group">
            <label class="form-label">Test</label>
            <code class="notes-scenario" id="qa-note-test-label" />
            <input type="hidden" id="qa-note-scenario-id" />
            <input type="hidden" id="qa-note-test-id" />
            <input type="hidden" id="qa-note-role" />
            <input type="hidden" id="qa-note-run-id" />
          </div>

          <div class="form-group">
            <label for="qa-note-input" class="form-label">
              Catatan{' '}
              <span class="form-hint muted">(maks 4000 karakter — kosongkan untuk menghapus)</span>
            </label>
            <textarea
              id="qa-note-input"
              class="cmd-input form-textarea"
              rows="4"
              maxlength="4000"
              placeholder="Contoh: butuh seed data invoice X; flow B lebih cepat dari flow A…"
            />
          </div>

          <div id="qa-note-feedback" class="save-feedback" role="status" aria-live="polite" />
        </div>

        <div class="modal-foot">
          <button
            class="btn-secondary"
            type="button"
            onclick="closeQaNoteModal && closeQaNoteModal()"
          >
            Cancel
          </button>
          <button
            class="btn-save-primary"
            id="btn-qa-note-save"
            type="button"
            onclick="saveQaNoteModal && saveQaNoteModal()"
          >
            <IconSave size={15} />
            <span>Save Note</span>
          </button>
        </div>
      </div>
    </div>
  );
}
