import type { CollectedTestData } from './types';
import { escapeHtml } from './shared';

const UNHEALTHY = new Set(['failed', 'timedOut', 'interrupted']);

/** Build data-* attributes used by client-side filter/search. */
export function buildFilterDataAttrs(test: CollectedTestData, rowKey: string): string {
  // Serve mode normalizes attachments to [] but keeps hasTrace/hasScreenshot/
  // hasVideo booleans — prefer the flags, fall back to attachment inspection.
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
    test.qaNotes || '',
    test.aiNotes || '',
  ]
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const status = String(test.status || '');
  const priority = String(test.priority || 'medium').toLowerCase();
  const role = test.role || '';
  const module = test.module || '';
  const feature = test.feature || '';
  const unhealthy = UNHEALTHY.has(status) ? '1' : '0';

  return [
    `data-row-key="${escapeHtml(rowKey)}"`,
    `data-test-id="${escapeHtml(test.testId || '')}"`,
    `data-status="${escapeHtml(status)}"`,
    `data-priority="${escapeHtml(priority)}"`,
    `data-role="${escapeHtml(role)}"`,
    `data-module="${escapeHtml(module)}"`,
    `data-feature="${escapeHtml(feature)}"`,
    `data-layers="${escapeHtml(layers)}"`,
    `data-has-trace="${hasTrace}"`,
    `data-has-screenshot="${hasScreenshot}"`,
    `data-has-video="${hasVideo}"`,
    `data-unhealthy="${unhealthy}"`,
    `data-failure-source="${escapeHtml(test.failureSource || '')}"`,
    `data-search="${escapeHtml(search)}"`,
  ].join(' ');
}

/** Compact export row payload for client-side filtered export. */
export function toExportPayload(tests: CollectedTestData[]): unknown[] {
  const rows: unknown[] = [];
  const groups = new Map<string, CollectedTestData[]>();
  for (const t of tests) {
    const r = t.role || '';
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(t);
  }
  for (const [role, list] of groups) {
    const slug = (role || 'general').toLowerCase().replace(/[^a-z0-9]/g, '_');
    list.forEach((t, i) => {
      rows.push({
        key: `${slug}__${t.testId || 'row'}-${i}`,
        testId: t.testId || '-',
        title: t.title,
        role: t.role || '',
        status: t.status,
        priority: t.priority,
        duration: t.duration,
        steps: (t.steps || [])
          .filter((s) => !s.title.startsWith('Before') && !s.title.startsWith('After'))
          .map((s) => s.title),
        inputData: t.inputData || {},
        expectedResult: t.expectedResult || '-',
        actualResult: t.actualResult || '-',
        failureSource: t.failureSource || '',
        affectedLayer: t.affectedLayer || [],
        qaNotes: t.qaNotes || '',
        aiNotes: t.aiNotes || '',
        hasTrace: t.hasTrace ?? t.attachments.some((a) => a.kind === 'trace'),
        hasScreenshot: t.attachments.some((a) => a.kind === 'screenshot'),
        hasVideo: t.attachments.some((a) => a.kind === 'video'),
      });
    });
  }
  return rows;
}
