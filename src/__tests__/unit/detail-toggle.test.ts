import { test, expect } from '@playwright/test';
import { buildHashRouterJs } from '../../support/custom-dashboard/build-hash-router';
import { buildDetailPage } from '../../support/custom-dashboard/build-fragments';

test.describe('hash-router detail fragment toggle', () => {
  test('buildHashRouterJs defines global window.toggleDetailRow', () => {
    const js = buildHashRouterJs();
    expect(js).toContain('window.toggleDetailRow = function');
    expect(js).toContain('document.getElementById("detail-expand-"+idx)');
    // The querySelector must be syntactically valid inside the emitted JS.
    expect(js).toContain('[data-idx="\'+idx+\'"]');
  });

  test('buildDetailPage no longer embeds its own <script> toggle (innerHTML-safe)', () => {
    const html = buildDetailPage({
      runId: 'run-20260804-132457-920',
      scenarios: [
        {
          testId: 'TC-DEMO-04',
          title: 'should fail - intentional timeout error',
          status: 'failed',
          errorMessage: 'Timeout',
        },
      ],
    });
    // Fragment is injected via innerHTML — embedded scripts never run, so the
    // toggle handler must live in the shell, not inside the fragment.
    expect(html).not.toContain('<script>');
    // Row onclick triggers toggleDetailRow — this is the single handler path.
    expect(html).toContain('toggleDetailRow(0)');
    expect(html).toContain('detail-expand-0');
    // The expand button must NOT have its own onclick — it bubbles up to the
    // <tr> onclick. Having onclick on both causes a double-toggle (no-op).
    expect(html).toMatch(/<button class="detail-expand-btn"[^>]*>/);
    expect(html).not.toMatch(/<button class="detail-expand-btn"[^>]*onclick/);
  });

  test('hash query on #/ stays on the primary dashboard', () => {
    const js = buildHashRouterJs();
    expect(js).toContain('h === "/" || h.indexOf("/?") === 0');
  });
});
