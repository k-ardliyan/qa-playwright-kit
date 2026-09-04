/** @jsxImportSource @kitajs/html */
import type { QaDecision } from '../../../../agents/reporter/report-archive';
import { IconSave } from '../../components/shared/icons';

export interface SaveRunModalProps {
  defaultLabel?: string;
  defaultSeries?: string;
}

const DECISIONS: Array<{ value: QaDecision; label: string; desc: string }> = [
  { value: 'APPROVE', label: 'APPROVE', desc: 'All tests pass / baseline ready' },
  { value: 'FILE_BUG', label: 'FILE_BUG', desc: 'Application bug detected' },
  { value: 'REVISE_REQUIREMENT', label: 'REVISE_REQUIREMENT', desc: 'Requirement mismatch' },
  { value: 'FIX_TEST', label: 'FIX_TEST', desc: 'Test logic or selector issue' },
  { value: 'FIX_ENV', label: 'FIX_ENV', desc: 'Environment / seed / auth issue' },
  { value: 'MARK_BLOCKED', label: 'MARK_BLOCKED', desc: 'Execution blocked by dependency' },
];

export function SaveRunModal({ defaultLabel = '', defaultSeries = '' }: SaveRunModalProps) {
  return (
    <div
      class="modal-overlay"
      id="save-modal"
      hidden
      aria-hidden="true"
      style="display:none"
      onclick="if(event.target===this){ closeSaveModal && closeSaveModal(); }"
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-save-title"
        aria-describedby="modal-save-description"
      >
        <div class="modal-head">
          <div class="modal-title-wrap">
            <span class="modal-icon-badge">
              <IconSave size={16} />
            </span>
            <h3 id="modal-save-title">Save Run to History</h3>
          </div>
          <button
            class="btn-close"
            type="button"
            onclick="closeSaveModal && closeSaveModal()"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div class="modal-body">
          <p id="modal-save-description" class="sr-only">
            Save the current test run with a QA decision and optional notes.
          </p>
          <div class="form-group">
            <label for="save-label" class="form-label">
              Run Label <span class="required">*</span>
            </label>
            <input
              type="text"
              id="save-label"
              class="cmd-input form-input"
              value={defaultLabel}
              placeholder="e.g. Login Regression — Staging RC12"
              required
            />
            <span class="form-hint muted">Human-readable label shown to QA.</span>
          </div>

          <div class="form-group">
            <label for="save-series" class="form-label">
              Test Series
            </label>
            <input
              type="text"
              id="save-series"
              class="cmd-input form-input"
              value={defaultSeries}
              placeholder="e.g. auth-login-regression"
            />
            <span class="form-hint muted">Used to group logically comparable runs.</span>
          </div>

          <div class="form-group">
            <label for="save-decision" class="form-label">
              QA Exit Decision <span class="required">*</span>
            </label>
            <select id="save-decision" class="cmd-select form-select" required>
              <option value="">— Select QA Decision —</option>
              {DECISIONS.map((d) => (
                <option value={d.value} safe>
                  {d.label} — {d.desc}
                </option>
              ))}
            </select>
          </div>

          <div class="form-group">
            <label for="save-notes" class="form-label">
              QA Notes
            </label>
            <textarea
              id="save-notes"
              class="cmd-input form-textarea"
              rows="3"
              placeholder="Context, known blockers, or triage remarks…"
            />
          </div>

          <div id="save-preview" class="save-preview" />
          <div id="save-feedback" class="save-feedback" role="alert" aria-live="assertive" />
        </div>

        <div class="modal-foot">
          <button class="btn-secondary" type="button" onclick="closeSaveModal && closeSaveModal()">
            Cancel
          </button>
          <button
            class="btn-save-primary"
            id="btn-save-confirm"
            type="button"
            onclick="confirmSave && confirmSave()"
          >
            <IconSave size={15} />
            <span>Save to History</span>
          </button>
        </div>
      </div>
    </div>
  );
}
