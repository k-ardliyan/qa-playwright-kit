import { test, expect } from '@playwright/test';
import {
  categorizeNotImplementedReason,
  computeNotImplementedByCategory,
  NOT_IMPLEMENTED_CATEGORY_ORDER,
} from '../../support/custom-dashboard/domain/not-implemented-categories';
import { buildDashboardOverview } from '../../support/custom-dashboard/domain/dashboard-overview';

/**
 * The "Kenapa belum jalan" panel answers QA's question with a CATEGORY and a
 * next action, not a raw reason blob. These tests pin the categorizer against
 * the REAL tes-qa reason strings and the overview aggregation order.
 */
test.describe('not-implemented reason categories', () => {
  test('maps the real tes-qa reason strings to their categories', () => {
    expect(
      categorizeNotImplementedReason(
        'UI belum dieksplorasi (form/dialog/stepper belum ada di selector catalog) — Explore lanjutan diperlukan',
      ),
    ).toBe('halaman-belum-dieksplorasi');
    expect(
      categorizeNotImplementedReason(
        'Butuh rentang tanggal/periode terkontrol — verifikasi manual atau seed khusus',
      ),
    ).toBe('butuh-seed');
    expect(
      categorizeNotImplementedReason('Butuh manipulasi sesi/kedaluwarsa — verifikasi manual'),
    ).toBe('butuh-sesi');
    expect(
      categorizeNotImplementedReason(
        'Butuh payroll berjalan sampai status Dibayar — prasyarat rantai payroll belum tersedia.',
      ),
    ).toBe('butuh-rantai-data');
  });

  test('routes an empty/missing reason to tanpa-alasan and anything else to alasan-lain', () => {
    expect(categorizeNotImplementedReason(undefined)).toBe('tanpa-alasan');
    expect(categorizeNotImplementedReason('   ')).toBe('tanpa-alasan');
    expect(categorizeNotImplementedReason('alasan yang belum ada polanya')).toBe('alasan-lain');
  });

  test('groups rows in canonical category order and keeps distinct reasons', () => {
    const rows = [
      { status: 'not-implemented', notImplementedReason: 'Butuh manipulasi sesi/kedaluwarsa' },
      { status: 'not-implemented', notImplementedReason: 'Butuh rentang tanggal — seed khusus' },
      { status: 'not-implemented', notImplementedReason: 'UI belum dieksplorasi' },
      { status: 'not-implemented', notImplementedReason: 'UI belum dieksplorasi (varian lain)' },
      { status: 'not-implemented' },
      { status: 'passed' }, // ignored — only unbuilt work belongs here
    ];
    const entries = computeNotImplementedByCategory(rows);

    expect(entries.map((e) => e.categoryId)).toEqual([
      'halaman-belum-dieksplorasi',
      'butuh-seed',
      'butuh-sesi',
      'tanpa-alasan',
    ]);
    const page = entries.find((e) => e.categoryId === 'halaman-belum-dieksplorasi');
    expect(page?.count).toBe(2);
    expect(page?.reasons).toHaveLength(2);
    expect(page?.nextAction).toContain('snapshot_page');
  });

  test('returns an empty list for a run without unbuilt work', () => {
    expect(computeNotImplementedByCategory([{ status: 'passed' }, { status: 'failed' }])).toEqual(
      [],
    );
  });

  test('the overview carries the grouped panel data from summary testCases', () => {
    const summary = {
      total: 2,
      passed: 0,
      failed: 0,
      skipped: 0,
      notImplemented: 2,
      passRate: 0,
      timestamp: '2026-10-07T00:00:00.000Z',
      runMeta: {
        appEnv: 'dev',
        ci: false,
        totalDurationMs: 0,
        generatedAt: '2026-10-07T00:00:00.000Z',
      },
      testCases: [
        {
          testId: 'SC-01',
          scenarioId: 'SC-01',
          title: 'a',
          role: 'finance',
          module: 'payroll',
          feature: 'f',
          status: 'not-implemented',
          priority: 'high',
          duration: 0,
          inputData: {},
          expectedResult: '',
          actualResult: '',
          affectedLayer: [],
          attachmentCount: 0,
          hasTrace: false,
          notImplementedReason: 'Butuh manipulasi sesi/kedaluwarsa — verifikasi manual',
        },
        {
          testId: 'SC-02',
          scenarioId: 'SC-02',
          title: 'b',
          role: 'finance',
          module: 'payroll',
          feature: 'f',
          status: 'not-implemented',
          priority: 'low',
          duration: 0,
          inputData: {},
          expectedResult: '',
          actualResult: '',
          affectedLayer: [],
          attachmentCount: 0,
          hasTrace: false,
        },
      ],
    };

    const overview = buildDashboardOverview({ latestSummary: summary, history: [] });
    expect(overview.notImplementedByCategory.map((e) => e.categoryId)).toEqual([
      'butuh-sesi',
      'tanpa-alasan',
    ]);
    expect(NOT_IMPLEMENTED_CATEGORY_ORDER[0]).toBe('halaman-belum-dieksplorasi');
  });
});
