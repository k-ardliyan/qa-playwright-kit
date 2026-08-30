/** @jsxImportSource @kitajs/html */
import type { CollectedTestData } from '../../types';
import {
  ActualResultCell,
  FailureSourceCell,
  InputDataCell,
  MultilineTextCell,
  NotesCell,
  PriorityBadgeCell,
  StatusBadge,
  StepsCell,
} from './TableCells';

export interface TestRowProps {
  test: CollectedTestData;
  rowKey: string;
}

const UNHEALTHY = new Set(['failed', 'timedOut', 'interrupted']);

export function TestRow({ test, rowKey }: TestRowProps) {
  const hasTrace = (test.hasTrace ?? test.attachments.some((a) => a.kind === 'trace')) ? '1' : '0';
  const hasScreenshot = test.attachments.some((a) => a.kind === 'screenshot') ? '1' : '0';
  const hasVideo = test.attachments.some((a) => a.kind === 'video') ? '1' : '0';
  const layers = (test.affectedLayer || []).join(',');
  const search = [
    test.testId,
    test.title,
    test.fullTitle,
    test.role,
    test.module,
    test.feature,
    test.expectedResult,
    test.actualResult,
    test.errorMessage,
    test.failureSource || '',
  ]
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const status = String(test.status || '');
  const priority = String(test.priority || 'medium').toLowerCase();
  const role = test.role || '';
  const moduleName = test.module || '';
  const featureName = test.feature || '';
  const unhealthy = UNHEALTHY.has(status) ? '1' : '0';

  return (
    <tr
      class={`tbl-row tbl-row--${test.status}`}
      data-row-key={rowKey}
      data-test-id={test.testId || ''}
      data-status={status}
      data-priority={priority}
      data-role={role}
      data-module={moduleName}
      data-feature={featureName}
      data-layers={layers}
      data-has-trace={hasTrace}
      data-has-screenshot={hasScreenshot}
      data-has-video={hasVideo}
      data-unhealthy={unhealthy}
      data-failure-source={test.failureSource || ''}
      data-search={search}
    >
      <td class="tbl-test-id col-sticky-0" data-col="testId">
        <code safe>{test.testId || '-'}</code>
      </td>
      <td class="tbl-module" data-col="module">
        <span class="module-chip" safe>
          {test.module || 'general'}
        </span>
      </td>
      <td class="tbl-feature" data-col="feature">
        <span class="feature-chip" safe>
          {test.feature || 'general'}
        </span>
      </td>
      <td class="tbl-description" data-col="description">
        <MultilineTextCell text={test.title} class="tbl-title" />
      </td>
      <td class="tbl-steps col-tertiary" data-col="steps">
        <StepsCell steps={test.steps} />
      </td>
      <td class="tbl-input col-secondary" data-col="input">
        <InputDataCell inputData={test.inputData} />
      </td>
      <td class="tbl-expected col-secondary" data-col="expected">
        <MultilineTextCell text={test.expectedResult || '-'} class="tbl-expected__text" />
      </td>
      <td class="tbl-actual" data-col="actual">
        <ActualResultCell test={test} />
      </td>
      <td class="tbl-status" data-col="status">
        <StatusBadge status={test.status} />
      </td>
      <td class="tbl-priority" data-col="priority">
        <PriorityBadgeCell priority={test.priority} />
      </td>
      <td class="tbl-source" data-col="source">
        <FailureSourceCell test={test} />
      </td>
      <td class="tbl-notes" data-col="notes">
        <NotesCell test={test} />
      </td>
    </tr>
  );
}
