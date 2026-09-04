/** @jsxImportSource @kitajs/html */
import type { QaDecision } from '../../../../agents/reporter/report-archive';
import { IconEdit, IconSave } from '../../components/shared/icons';

const DECISIONS: Array<{ value: QaDecision; label: string; desc: string }> = [
  { value: 'APPROVE', label: 'APPROVE', desc: 'All tests pass / baseline ready' },
  { value: 'FILE_BUG', label: 'FILE_BUG', desc: 'Application bug detected' },
  { value: 'REVISE_REQUIREMENT', label: 'REVISE_REQUIREMENT', desc: 'Requirement mismatch' },
  { value: 'FIX_TEST', label: 'FIX_TEST', desc: 'Test logic or selector issue' },
  { value: 'FIX_ENV', label: 'FIX_ENV', desc: 'Environment / seed / auth issue' },
  { value: 'MARK_BLOCKED', label: 'MARK_BLOCKED', desc: 'Execution blocked by dependency' },
];

export function EditRunModal() {
  return (
    <div
      class="modal-overlay"
      id="edit-run-modal"
      hidden
      aria-hidden="true"
      style="display:none"
      onclick="if(event.target===this){ closeEditModal && closeEditModal(); }"
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-edit-title"
        aria-describedby="modal-edit-description"
      >
        <div class="modal-head">
          <div class="modal-title-wrap">
            <span class="modal-icon-badge">
              <IconEdit size={16} />
            </span>
            <h3 id="modal-edit-title">Edit Run Details</h3>
          </div>
          <button
            class="btn-close"
            type="button"
            onclick="closeEditModal && closeEditModal()"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div class="modal-body">
          <p id="modal-edit-description" class="sr-only">
            Edit archived run metadata, QA decision, and notes.
          </p>
          <div class="form-group">
            <label class="form-label">Run ID</label>
            <div class="font-mono text-muted pad-8" id="edit-run-id-display" />
            <input type="hidden" id="edit-run-id" />
          </div>

          <div class="form-group">
            <label for="edit-display-name" class="form-label">
              Run Label (Display Name) <span class="required">*</span>
            </label>
            <input
              type="text"
              id="edit-display-name"
              class="cmd-input form-input"
              placeholder="e.g. Login Regression — Staging RC12"
              required
            />
            <span class="form-hint muted">Human-readable label shown to QA.</span>
          </div>

          <div class="form-group">
            <label for="edit-test-series" class="form-label">
              Test Series
            </label>
            <input
              type="text"
              id="edit-test-series"
              class="cmd-input form-input"
              placeholder="e.g. auth-login-regression"
            />
            <span class="form-hint muted">Used to group logically comparable runs.</span>
          </div>

          <div class="form-group">
            <label for="edit-requirement-id" class="form-label">
              Requirement ID
            </label>
            <input
              type="text"
              id="edit-requirement-id"
              class="cmd-input form-input"
              placeholder="e.g. REQ-AUTH-001"
            />
            <span class="form-hint muted">Linked requirement code.</span>
          </div>

          <div class="form-group">
            <label for="edit-qa-decision" class="form-label">
              QA Exit Decision <span class="required">*</span>
            </label>
            <select id="edit-qa-decision" class="cmd-select form-select" required>
              <option value="">— Select QA Decision —</option>
              {DECISIONS.map((d) => (
                <option value={d.value} safe>
                  {d.label} — {d.desc}
                </option>
              ))}
            </select>
          </div>

          <div class="form-group">
            <label for="edit-qa-notes" class="form-label">
              QA Notes
            </label>
            <textarea
              id="edit-qa-notes"
              class="cmd-input form-textarea"
              rows="3"
              placeholder="Context, known blockers, or triage remarks…"
            />
          </div>

          <div id="edit-feedback" class="save-feedback" role="alert" aria-live="assertive" />
        </div>

        <div class="modal-foot">
          <button class="btn-secondary" type="button" onclick="closeEditModal && closeEditModal()">
            Cancel
          </button>
          <button
            class="btn-save-primary"
            id="btn-edit-confirm"
            type="button"
            onclick="confirmEditExecute && confirmEditExecute()"
          >
            <IconSave size={15} />
            <span>Save Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
}
