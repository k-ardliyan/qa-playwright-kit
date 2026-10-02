import { buildClipboardJs } from './clipboard';
import { buildActionsJs } from './actions';
import { buildTestFilterJs } from './test-filter';
import { buildSaveHistoryModalJs, buildQaNotesJs } from './save-history-modal';
import { buildMediaLightboxJs } from './media-lightbox';
import { buildAttentionCueJs } from './attention-cue';

/**
 * Orchestrates modular client-side behavior bundles into the document bootstrap.
 */
export function buildClientBootstrapJs(): string {
  return `
  <script>
  (function () {
    ${buildClipboardJs()}
    ${buildActionsJs()}
    ${buildSaveHistoryModalJs()}
    ${buildQaNotesJs()}
    ${buildTestFilterJs()}
    ${buildMediaLightboxJs()}
    ${buildAttentionCueJs()}
  })();
  </script>
  `;
}
