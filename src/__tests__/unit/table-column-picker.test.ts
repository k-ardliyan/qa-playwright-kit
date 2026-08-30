import { test, expect } from '@playwright/test';
import { TableColumnPicker } from '../../support/custom-dashboard/components/table/TableToolbar';
import { renderInteractiveScript } from '../../support/custom-dashboard/shared';

test.describe('Table Column Picker Component & Structure', () => {
  test('TableColumnPicker component renders scrollable body and actions footer', () => {
    const html = String(TableColumnPicker());

    expect(html).toContain('class="column-picker"');
    expect(html).toContain('id="column-picker-btn"');
    expect(html).toContain('class="column-picker__menu"');
    expect(html).toContain('class="column-picker__body"');
    expect(html).toContain('class="column-picker__actions"');
    expect(html).toContain('id="column-picker-show-all"');
    expect(html).toContain('id="column-picker-reset"');

    // Body should contain column toggles and pin sticky items
    expect(html).toContain('data-col-toggle="testId"');
    expect(html).toContain('data-col-toggle="module"');
    expect(html).toContain('data-col-toggle="feature"');
    expect(html).toContain('data-col-toggle="description"');
    expect(html).toContain('data-col-toggle="steps"');
    expect(html).toContain('data-col-toggle="input"');
    expect(html).toContain('data-col-toggle="expected"');
    expect(html).toContain('data-col-toggle="actual"');
    expect(html).toContain('data-col-toggle="status"');
    expect(html).toContain('data-col-toggle="priority"');
    expect(html).toContain('data-col-toggle="source"');
    expect(html).toContain('data-col-toggle="notes"');
    expect(html).toContain('data-pin-sticky="header"');
    expect(html).toContain('data-pin-sticky="left"');
  });

  test('renderInteractiveScript contains Show All and Reset button handlers', () => {
    const script = renderInteractiveScript();

    expect(script).toContain("getElementById('column-picker-show-all')");
    expect(script).toContain("getElementById('column-picker-reset')");
    expect(script).toContain("querySelectorAll('[data-col-toggle]')");
    expect(script).toContain('DEFAULT_COLS');
    expect(script).toContain('applyColumnVisibility');
  });
});
