import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeSubRoutePattern } from '../../../tools/mcp/src/tools/_internal/semantic-extractor';
import { synthesizeRequirement } from '../../../tools/mcp/src/tools/synthesize-requirement';
import { validateRequirementText } from '../../../tools/mcp/src/tools/validate-requirement';

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
    const catalogRoot = path.resolve('artifacts', 'selector-catalog');
    for (const name of fs.existsSync(catalogRoot) ? fs.readdirSync(catalogRoot) : []) {
      if (name.startsWith('zz-test-invoice-')) {
        fs.rmSync(path.join(catalogRoot, name), { recursive: true, force: true });
      }
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

  test('preserves structured QA-authored scenarios in generated requirements', async () => {
    const res = await synthesizeRequirement({
      featureName: 'sample-synth',
      moduleName: 'invoice',
      title: 'Daftar Invoice',
      entryUrl: '/invoices/approved',
      role: 'finance',
      outputPath: outPath,
      userScenarios: [
        {
          title: 'Finance can view approved invoices',
          type: 'success',
          role: 'finance',
          steps: ['Open approved invoices', 'Inspect the invoice list'],
          expectedResults: ['The approved invoices list is visible'],
        },
        {
          title: 'Unauthorized role is denied',
          type: 'access-restriction',
          role: 'hrd',
          steps: ['Open approved invoices'],
          expectedResults: ['Access denied is visible'],
        },
      ],
    });

    expect(res.status).toBe('success');
    const md = fs.readFileSync(outPath, 'utf8');
    expect(md.indexOf('Finance can view approved invoices')).toBeGreaterThan(
      md.indexOf('## Skenario Uji'),
    );
    expect(md).toContain('## Access Matrix');
    expect(md).toContain('| hrd | deny | Access denied is visible |');
    expect(md).toContain(
      '- **Access expectation:** finance: bisa The approved invoices list is visible',
    );
    expect(validateRequirementText(md).violations.map((v) => v.ruleName)).not.toContain(
      'access_expectation_missing',
    );
    expect(md).toContain('- **Halaman awal:** /invoices/approved');
    expect(md).toContain('Open approved invoices');
    expect(md).toContain('The approved invoices list is visible');
    expect(md).toContain('TC-INVOICE-001');
    expect(md).toContain('finance');
    expect(md).toContain('hrd');
  });

  test('normalizes multiline scenario titles before rendering Markdown headings', async () => {
    const res = await synthesizeRequirement({
      featureName: 'sample-synth',
      moduleName: 'invoice',
      outputPath: outPath,
      userScenarios: [
        {
          title: 'Finance can view\n### injected heading',
          steps: ['Open approved invoices'],
          expectedResults: ['The approved invoices list is visible'],
        },
      ],
    });

    expect(res.status).toBe('success');
    const md = fs.readFileSync(outPath, 'utf8');
    expect(md).toContain('### SC-01: Finance can view ### injected heading');
    expect(md).not.toContain('\n### injected heading');
  });

  test('rejects malformed or oversized structured QA scenarios before writing', async () => {
    for (const userScenarios of [
      [{ title: 'Missing steps', expectedResults: ['visible'] }],
      [{ title: 'Missing result', steps: ['Open page'], expectedResults: [] }],
      [
        {
          title: 'Unexpected input',
          extra: 'ignored?',
          steps: ['Open page'],
          expectedResults: ['Visible'],
        },
      ],
      [
        {
          title: 'Unknown type',
          type: 'maybe',
          steps: ['Open page'],
          expectedResults: ['Visible'],
        },
      ],
      [
        {
          title: 'Unsafe role',
          role: '../other',
          steps: ['Open page'],
          expectedResults: ['Visible'],
        },
      ],
      [{ title: 'x'.repeat(201), steps: ['Open page'], expectedResults: ['Visible'] }],
      [{ title: 'Long text', steps: ['x'.repeat(501)], expectedResults: ['Visible'] }],
      [
        {
          title: 'Aggregate too large',
          steps: Array.from({ length: 20 }, () => 'x'.repeat(500)),
          expectedResults: Array.from({ length: 20 }, () => 'y'.repeat(500)),
        },
      ],
      Array.from({ length: 21 }, (_, index) => ({
        title: `Scenario ${index}`,
        steps: ['Open page'],
        expectedResults: ['Visible'],
      })),
    ]) {
      const res = await synthesizeRequirement({
        featureName: 'sample-synth',
        title: 'Daftar Invoice',
        outputPath: outPath,
        userScenarios,
      });
      expect(res.status).toBe('error');
    }
    expect(fs.existsSync(outPath)).toBe(false);
  });

  test('does not overwrite an existing requirement', async () => {
    const featureName = `zz-test-preserve-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const defaultPath = path.resolve('requirements', `${featureName}.md`);
    fs.writeFileSync(outPath, '# Explicit QA-owned requirement\n', 'utf8');
    fs.writeFileSync(defaultPath, '# QA-owned requirement\n', 'utf8');
    try {
      const res = await synthesizeRequirement({ featureName });
      const explicitRes = await synthesizeRequirement({ featureName, outputPath: outPath });
      expect(res.status).toBe('error');
      expect(explicitRes.status).toBe('error');
      expect(fs.readFileSync(defaultPath, 'utf8')).toBe('# QA-owned requirement\n');
      expect(fs.readFileSync(outPath, 'utf8')).toBe('# Explicit QA-owned requirement\n');
    } finally {
      fs.rmSync(defaultPath, { force: true });
    }
  });

  test('formatted QA-authored requirement validates successfully', async () => {
    const res = await synthesizeRequirement({
      featureName: 'sample-synth',
      moduleName: 'invoice',
      title: 'Invoice visibility',
      entryUrl: '/invoices',
      role: 'finance',
      outputPath: outPath,
      userScenarios: [
        {
          title: 'Finance sees invoices',
          type: 'success',
          role: 'finance',
          steps: ['Open /invoices', 'Inspect the list'],
          expectedResults: ['The invoice list is visible'],
        },
      ],
    });
    expect(res.status).toBe('success');
    expect(validateRequirementText(fs.readFileSync(outPath, 'utf8')).status).toBe('success');
  });

  test('synthesizes rich scenarios from mocked semantic catalog', async () => {
    const catalogDir = path.join(
      path.resolve('artifacts', 'selector-catalog'),
      `zz-test-invoice-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    );
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

  test('synthesized catalog requirement with backlog comment still validates', async () => {
    const featureName = `zz-test-backlog-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const defaultPath = path.resolve('requirements', `${featureName}.md`);
    const catalogDir = path.join(path.resolve('artifacts', 'selector-catalog'), featureName);
    fs.mkdirSync(catalogDir, { recursive: true });
    const mockCatalog = {
      schemaVersion: '1.0',
      featureName,
      pageName: 'list',
      url: 'https://staging.example.test/invoices',
      role: 'finance',
      hash: 'deadbeef',
      catalogHash: 'deadbeef',
      capturedAt: new Date().toISOString(),
      truncated: false,
      elementCount: 2,
      elements: [],
      semantic: {
        tables: [
          {
            name: 'Daftar Invoice',
            headers: ['Customer Name', 'Total Invoice'],
            rowActions: ['Lihat', 'Edit'],
            rowCount: 1,
          },
        ],
        statCards: [],
        forms: [],
        tabs: [],
        modals: [],
        rbacSignals: [],
        alertsAndToasts: [],
        subRoutes: [
          { label: 'Buat Invoice', targetUrl: '/invoices/new', routePattern: '/invoices/new' },
        ],
      },
    };
    fs.writeFileSync(path.join(catalogDir, 'list.json'), JSON.stringify(mockCatalog), 'utf8');

    try {
      const res = await synthesizeRequirement({
        featureName,
        moduleName: 'invoice',
        title: 'Manajemen Invoice',
        entryUrl: '/invoices',
        role: 'finance',
        catalogDirOverride: catalogDir,
      });
      expect(res.status).toBe('success');
      // The backlog block is an HTML comment — it must not be parsed as a scenario.
      expect(res.backlogSuggestionsCount).toBeGreaterThan(0);
      const md = fs.readFileSync(defaultPath, 'utf8');
      expect(md).toContain('### 💡 Rekomendasi Skenario Tambahan (Backlog):');
      const parsed = validateRequirementText(md);
      expect(
        parsed.violations.filter((v) => v.ruleName === 'scenario_structure'),
        JSON.stringify(parsed.violations),
      ).toEqual([]);
    } finally {
      fs.rmSync(catalogDir, { recursive: true, force: true });
      fs.rmSync(defaultPath, { force: true });
    }
  });
});
