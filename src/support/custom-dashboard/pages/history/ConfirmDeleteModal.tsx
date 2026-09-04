/** @jsxImportSource @kitajs/html */
import { IconTrash } from '../../components/shared/icons';

export function ConfirmDeleteModal() {
  return (
    <div
      class="modal-overlay"
      id="confirm-delete-modal"
      hidden
      aria-hidden="true"
      style="display:none"
      onclick="if(event.target===this){ closeConfirmDelete && closeConfirmDelete(); }"
    >
      <div
        class="modal-card modal-card--danger"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-delete-title"
        aria-describedby="modal-delete-description"
      >
        <div class="modal-head">
          <div class="modal-title-wrap">
            <span class="modal-icon-badge modal-icon-badge--danger">
              <IconTrash size={16} />
            </span>
            <h3 id="modal-delete-title">Confirm Archive Deletion</h3>
          </div>
          <button
            class="btn-close"
            type="button"
            onclick="closeConfirmDelete && closeConfirmDelete()"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <p id="modal-delete-description">
            Are you sure you want to permanently delete this archived run?
          </p>
          <p class="modal-delete-target text-danger" id="confirm-delete-target" />
          <p class="modal-delete-warning muted">
            This action removes the saved summary and metadata. This cannot be undone.
          </p>
        </div>
        <div class="modal-foot">
          <button
            class="btn-secondary"
            type="button"
            onclick="closeConfirmDelete && closeConfirmDelete()"
          >
            Cancel
          </button>
          <button
            class="btn-danger"
            id="btn-confirm-delete-execute"
            aria-describedby="modal-delete-description"
            type="button"
            onclick="confirmDeleteExecute && confirmDeleteExecute()"
          >
            <IconTrash size={15} />
            <span>Delete Permanently</span>
          </button>
        </div>
      </div>
    </div>
  );
}
