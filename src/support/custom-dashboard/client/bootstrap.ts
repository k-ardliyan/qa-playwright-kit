import { buildClipboardJs } from './clipboard';
import { buildActionsJs } from './actions';
import { buildTestFilterJs } from './test-filter';
import { buildInspectionDrawerJs } from './inspection-drawer';
import { buildSaveHistoryModalJs } from './save-history-modal';

/**
 * Orchestrates modular client-side behavior bundles into the document bootstrap.
 */
export function buildClientBootstrapJs(): string {
  return `
  <script>
  (function () {
    ${buildClipboardJs()}
    ${buildActionsJs()}
    ${buildInspectionDrawerJs()}
    ${buildSaveHistoryModalJs()}
    ${buildTestFilterJs()}
  })();
  </script>
  `;
}
