import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeSubRoutePattern } from '../../../tools/mcp/src/tools/_internal/semantic-extractor';
import { synthesizeRequirement } from '../../../tools/mcp/src/tools/synthesize-requirement';

test.describe('normalizeSubRoutePattern', () => {
  test('normalizes numeric IDs to :id', () => {
    expect(normalizeSubRoutePattern('/invoices/123')).toBe('/invoices/:id');
    expect(normalizeSubRoutePattern('/invoices/123/edit')).toBe('/invoices/:id/edit');
  });

  test('normalizes slug and UUID identifiers to :id', () => {
    expect(normalizeSubRoutePattern('/invoices/INV-2026-001')).toBe('/invoices/:id');
    expect(normalizeSubRoutePattern('/users/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d')).toBe(
      '/users/:id',
    );
  });

  test('keeps static routes unchanged', () => {
    expect(normalizeSubRoutePattern('/invoices/new')).toBe('/invoices/new');
    expect(normalizeSubRoutePattern('/dashboard/settings')).toBe('/dashboard/settings');
  });
});

test.describe('synthesizeRequirement', () => {
  // Hardening (resolveAllowedPath 'requirements') requires output inside the
  // real repo requirements/ — write with a unique test-prefixed filename and
  // always clean up in afterEach.
  let outPath: string;
  let tempDir: string;

  test.beforeEach(() => {
    outPath = path.resolve(
      'requirements',
      `zz-test-synth-${Date.now()}-${Math.floor(Math.random() * 1e6)}.md`,
    );
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synth-req-test-'));
  });

  test.afterEach(() => {
    if (fs.existsSync(outPath)) {
      fs.rmSync(outPath, { force: true });
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('synthesizes valid requirement markdown when no catalog exists (baseline)', async () => {
    const res = await synthesizeRequirement({
      featureName: 'sample-synth',
      moduleName: 'invoice',
      title: 'Daftar Invoice',
      entryUrl: '/invoices',
      role: 'finance',
      outputPath: outPath,
    });

    expect(res.status).toBe('success');
    expect(res.activeScenariosCount).toBeGreaterThan(0);
    expect(fs.existsSync(outPath)).toBe(true);

    const md = fs.readFileSync(outPath, 'utf8');
    expect(md).toContain('# REQ-INVOICE-001: Daftar Invoice');
    expect(md).toContain('- **Module:** invoice');
    expect(md).toContain('- **Role scope:** finance');
    expect(md).toContain('## Kriteria Penerimaan');
    expect(md).toContain('## Skenario Uji');
  });

  test('synthesizes rich scenarios from mocked semantic catalog', async () => {
    // catalogDirOverride is still read-only (no guard) — an isolated tmp dir is
    // fine here; only outputPath is hardened to requirements/.
    const catalogDir = path.join(tempDir, 'artifacts', 'selector-catalog', 'invoice-feature');
    fs.mkdirSync(catalogDir, { recursive: true });

    const mockCatalog = {
      schemaVersion: 'qa.selector-catalog/v1',
      featureName: 'invoice-feature',
      pageName: 'list',
      url: 'http://localhost:3000/invoices',
      role: 'finance',
      hash: 'mockhash123',
      capturedAt: new Date().toISOString(),
      truncated: false,
      elementCount: 10,
      elements: [],
      semantic: {
        schemaVersion: 'qa.semantic-catalog/v1',
        url: 'http://localhost:3000/invoices',
        role: 'finance',
        capturedAt: new Date().toISOString(),
        tables: [
          {
            name: 'Daftar Invoice',
            headers: ['No', 'Nomor Invoice', 'Customer', 'Nominal', 'Status', 'Aksi'],
            sampleRow: { 'Nomor Invoice': 'INV-2026-001', Customer: 'PT Maju' },
            rowActions: ['Detail', 'Edit'],
          },
        ],
        statCards: [{ title: 'Total Invoice', value: '1,240' }],
        tabs: [],
        steppers: [],
        treegrids: [],
        treeViews: [],
        kanbanBoards: [],
        radioGroups: [],
        toggleSwitches: [],
        sliders: [],
        spinbuttons: [],
        breadcrumbs: [],
        paginations: [],
        accordions: [],
        actionMenus: [],
        commandPalettes: [],
        charts: [],
        progressBars: [],
        forms: [
          {
            label: 'Customer Name',
            type: 'textbox',
            required: true,
          },
        ],
        uploadDropzones: [],
        modalsAndDrawers: [],
        rbacSignals: [],
        alertsAndToasts: [],
        subRoutes: [
          { label: 'Buat Invoice', targetUrl: '/invoices/new', routePattern: '/invoices/new' },
        ],
      },
    };

    fs.writeFileSync(path.join(catalogDir, 'list.json'), JSON.stringify(mockCatalog), 'utf8');

    // Run synthesis with mock output path (inside repo requirements/ per hardening)
    const res = await synthesizeRequirement({
      featureName: 'invoice-feature',
      moduleName: 'invoice',
      title: 'Manajemen Invoice',
      entryUrl: '/invoices',
      role: 'finance',
      outputPath: outPath,
      catalogDirOverride: catalogDir,
    });

    expect(res.status).toBe('success');
    expect(res.activeScenariosCount).toBeGreaterThanOrEqual(3);
    expect(res.backlogSuggestionsCount).toBeGreaterThan(0);

    const md = fs.readFileSync(outPath, 'utf8');
    expect(md).toContain('Tabel Daftar Invoice');
    expect(md).toContain('Total Invoice');
    expect(md).toContain('Customer Name');
  });
});
