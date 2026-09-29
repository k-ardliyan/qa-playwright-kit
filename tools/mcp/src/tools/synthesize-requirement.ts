/**
 * MCP Tool: `synthesize_requirement`
 *
 * Synthesizes a structured, compliant `requirements/<feature>.md` draft
 * from semantic UI catalog snapshots (tables, forms, tabs, stat cards, modals).
 *
 * Emits active executable scenarios alongside backlog suggestions for QA review.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoRoot, createToolError, resolveAllowedPath, type ToolError } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';
import type { SemanticCatalog } from '../contracts/semantic-catalog';
import type { CatalogIndex } from './_internal/snapshot-core';

export interface SynthesizeRequirementArgs {
  featureName?: unknown;
  moduleName?: unknown;
  title?: unknown;
  entryUrl?: unknown;
  role?: unknown;
  outputPath?: unknown;
  catalogDirOverride?: unknown;
  userScenarios?: unknown;
}

export interface SynthesizeRequirementOutput {
  status: 'success' | 'error';
  featureName?: string;
  requirementPath?: string;
  markdownContent?: string;
  activeScenariosCount?: number;
  backlogSuggestionsCount?: number;
  message: string;
  error?: ToolError;
}

function readString(value: unknown, _field: string): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim().length === 0) return null;
  return value.trim();
}

const USER_SCENARIO_TYPES = [
  'success',
  'failure',
  'access-restriction',
  'manual',
  'general',
] as const;
type UserScenarioType = (typeof USER_SCENARIO_TYPES)[number];

interface UserScenario {
  title: string;
  type: UserScenarioType;
  role?: string;
  preconditions: string[];
  steps: string[];
  expectedResults: string[];
}

function parseUserScenarios(value: unknown): UserScenario[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  let totalChars = 0;
  const scenarios: UserScenario[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) =>
          !['title', 'type', 'role', 'preconditions', 'steps', 'expectedResults'].includes(key),
      )
    )
      return null;
    if (typeof record.title !== 'string' || !record.title.trim() || record.title.length > 200)
      return null;
    const type = record.type ?? 'general';
    if (typeof type !== 'string' || !USER_SCENARIO_TYPES.includes(type as UserScenarioType))
      return null;
    if (
      record.role !== undefined &&
      (typeof record.role !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(record.role.trim()))
    )
      return null;

    const readList = (input: unknown, required: boolean): string[] | null => {
      if (input === undefined && !required) return [];
      if (!Array.isArray(input) || (required && input.length === 0)) return null;
      const result: string[] = [];
      for (const entry of input) {
        if (typeof entry !== 'string' || !entry.trim() || entry.length > 500) return null;
        totalChars += entry.length;
        result.push(entry.trim());
      }
      return result;
    };

    totalChars += record.title.length + (typeof record.role === 'string' ? record.role.length : 0);
    const preconditions = readList(record.preconditions, false);
    const steps = readList(record.steps, true);
    const expectedResults = readList(record.expectedResults, true);
    if (!preconditions || !steps || !expectedResults || totalChars > 20_000) return null;
    scenarios.push({
      title: record.title.trim().replace(/[\r\n]+/g, ' '),
      type: type as UserScenarioType,
      ...(typeof record.role === 'string' ? { role: record.role.trim() } : {}),
      preconditions: preconditions.map((text) => text.replace(/[\r\n]+/g, ' ')),
      steps: steps.map((text) => text.replace(/[\r\n]+/g, ' ')),
      expectedResults: expectedResults.map((text) => text.replace(/[\r\n]+/g, ' ')),
    });
  }
  return scenarios;
}

export async function synthesizeRequirement(
  args: SynthesizeRequirementArgs | undefined,
): Promise<SynthesizeRequirementOutput> {
  if (!args || typeof args !== 'object') {
    return {
      status: 'error',
      message: 'Invalid arguments object.',
      error: { code: 'INVALID_INPUT', message: 'args must be an object.' },
    };
  }

  const featureName = readString(args.featureName, 'featureName');
  const moduleName = readString(args.moduleName, 'moduleName') ?? featureName ?? 'general';
  const rawTitle = readString(args.title, 'title') ?? `Fitur ${featureName ?? 'Baru'}`;
  const entryUrl = readString(args.entryUrl, 'entryUrl') ?? '/';
  const requestedRole = readString(args.role, 'role') ?? 'user';
  const userScenarios = parseUserScenarios(args.userScenarios);
  if (!userScenarios) {
    const err = createToolError(
      'INVALID_INPUT',
      '`userScenarios` must contain at most 20 valid scenarios with a title, non-empty steps, and expectedResults (20 KB max).',
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }
  const role = requestedRole === 'unauthenticated' ? requestedRole : requestedRole.toLowerCase();
  if (role !== 'unauthenticated' && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(role)) {
    const err = createToolError(
      'INVALID_INPUT',
      '`role` must be a valid role slug or `unauthenticated`.',
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }
  const reqId = `REQ-${moduleName.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-001`;

  if (!featureName) {
    const err = createToolError('INVALID_INPUT', '`featureName` is required.');
    return { status: 'error', message: err.error.message, error: err.error };
  }

  const rawCatalogDir = readString(args.catalogDirOverride, 'catalogDirOverride');
  const defaultCatalogDir = `${mcpWorkspace.selectorCatalogRel}/${featureName
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')}`;
  const catalogResolved = resolveAllowedPath(
    rawCatalogDir ?? defaultCatalogDir,
    'selector-catalog',
    {
      mustExist: false,
      readOnly: true,
    },
  );
  if (!catalogResolved.ok) {
    return {
      status: 'error',
      message: catalogResolved.error.message,
      error: catalogResolved.error,
    };
  }
  const catalogDir = catalogResolved.absolutePath;

  const semanticCatalogs: SemanticCatalog[] = [];

  if (fs.existsSync(catalogDir)) {
    const files = fs.readdirSync(catalogDir);
    for (const f of files) {
      if (f.endsWith('.json') && !f.startsWith('.')) {
        try {
          const content = JSON.parse(
            fs.readFileSync(path.join(catalogDir, f), 'utf8'),
          ) as CatalogIndex;
          if (content.semantic) {
            semanticCatalogs.push(content.semantic);
          }
        } catch {
          // ignore unreadable catalog
        }
      }
    }
  }

  // Generate markdown structure following requirements/_TEMPLATE.md
  let scCounter = 1;
  let acCounter = 1;
  const acList: string[] = [];
  const scList: string[] = [];
  const backlogList: string[] = [];

  /**
   * Render one scenario as a table. The label column keeps the exact names the
   * parsers already read (`Test ID`, `Covers`, `Langkah`, …) — only the shape
   * changes from bullet to table row. Multi-line values use `<br>`.
   */
  const scenarioTable = (fields: {
    testId: string;
    covers: string;
    role?: string;
    priority?: string;
    layer?: string;
    precondition?: string;
    inputData?: string[];
    steps: string[];
    expected: string[];
  }): string => {
    const cell = (value: string): string => value.replace(/\|/g, '\\|').trim();
    const rows: string[] = [`| Test ID | ${cell(fields.testId)} |`];
    if (fields.covers) rows.push(`| Covers | ${cell(fields.covers)} |`);
    if (fields.role) rows.push(`| Role | ${cell(fields.role)} |`);
    rows.push(`| Prioritas skenario | ${cell(fields.priority ?? 'high')} |`);
    rows.push(`| Layer terdampak | ${cell(fields.layer ?? 'FE')} |`);
    if (fields.precondition) rows.push(`| Prekondisi | ${cell(fields.precondition)} |`);
    if (fields.inputData && fields.inputData.length > 0) {
      rows.push(`| Input Data | ${fields.inputData.map(cell).join('<br>')} |`);
    }
    rows.push(`| Langkah | ${fields.steps.map((s, i) => cell(`${i + 1}. ${s}`)).join('<br>')} |`);
    rows.push(`| Hasil yang Diharapkan | ${fields.expected.map(cell).join('<br>')} |`);
    return ['| Field | Nilai |', '| --- | --- |', ...rows].join('\n');
  };

  const usedTestIds = new Set<string>();
  for (const [index, scenario] of userScenarios.entries()) {
    const acId = `AC-${String(acCounter++).padStart(2, '0')}`;
    const scId = `SC-${String(scCounter).padStart(2, '0')}`;
    scCounter += 1;
    const scenarioRole = scenario.role ?? role;
    const testId = `TC-${moduleName.toUpperCase()}-${String(index + 1).padStart(3, '0')}`;
    if (usedTestIds.has(testId)) {
      const err = createToolError(
        'INVALID_INPUT',
        `Duplicate generated Test ID '${testId}'. Use a shorter moduleName.`,
      );
      return { status: 'error', message: err.error.message, error: err.error };
    }
    usedTestIds.add(testId);
    const headingType = scenario.type === 'general' ? '' : ` (@${scenario.type})`;
    acList.push(`| ${acId} | ${scenario.expectedResults.join('; ').replace(/\|/g, '\\|')} |`);
    scList.push(`### ${scId}: ${scenario.title}${headingType}

${scenarioTable({
  testId,
  covers: acId,
  role: scenarioRole,
  precondition:
    scenario.preconditions.length > 0
      ? scenario.preconditions.join('; ')
      : `Pengguna membuka halaman ${entryUrl} dengan role ${scenarioRole}`,
  steps: scenario.steps,
  expected: scenario.expectedResults,
})}
`);
  }

  // 1. Tables & Columns Scenarios
  for (const sem of semanticCatalogs) {
    for (const table of sem.tables) {
      const acId = `AC-${String(acCounter++).padStart(2, '0')}`;
      const scId = `SC-${String(scCounter++).padStart(2, '0')}`;
      const colStr = table.headers.slice(0, 8).join(', ');

      acList.push(
        `- **${acId}:** Tabel "${table.name}" menampilkan daftar data dengan kolom ${colStr}.`,
      );

      scList.push(`### ${scId}: Melihat Daftar Data pada Tabel ${table.name} (@success)

${scenarioTable({
  testId: `TC-${moduleName.toUpperCase()}-${String(scCounter - 1).padStart(3, '0')}`,
  covers: acId,
  precondition: `Pengguna berada di halaman ${sem.url} dengan role ${role}`,
  steps: [
    `Buka halaman ${sem.url}`,
    `Verifikasi tabel "${table.name}" berhasil dimuat`,
    'Periksa kesesuaian header kolom pada tabel',
  ],
  expected: [
    `Tabel "${table.name}" tampil di layar`,
    `Kolom tabel memuat: ${colStr}`,
    'Minimal 1 baris data terlihat dengan status yang valid',
  ],
})}
`);

      // Suggest row actions as backlog
      if (table.rowActions.length > 0) {
        backlogList.push(
          `- Aksi Baris Tabel (${table.rowActions.join(', ')}) untuk tabel ${table.name}`,
        );
      }
    }

    // 2. Stat Cards Scenarios
    if (sem.statCards.length > 0) {
      const acId = `AC-${String(acCounter++).padStart(2, '0')}`;
      const scId = `SC-${String(scCounter++).padStart(2, '0')}`;
      const cardTitles = sem.statCards.map((c) => c.title).join(', ');

      acList.push(
        `| ${acId} | Card ringkasan metrik statistik (${cardTitles}) menampilkan informasi data yang valid. |`,
      );

      scList.push(`### ${scId}: Verifikasi Ringkasan Metrik Statistik (@success)

${scenarioTable({
  testId: `TC-${moduleName.toUpperCase()}-${String(scCounter - 1).padStart(3, '0')}`,
  covers: acId,
  priority: 'medium',
  precondition: `Pengguna membuka halaman ${sem.url}`,
  steps: [
    `Buka halaman ${sem.url}`,
    'Periksa blok card informasi statistik di bagian atas halaman',
  ],
  expected: [`Card metrik (${cardTitles}) tampil dengan format angka yang benar`],
})}
`);
    }

    // 3. Form Input Scenarios (@success & @failure)
    if (sem.forms.length > 0) {
      const requiredInputs = sem.forms.filter((f) => f.required);
      const acSuccessId = `AC-${String(acCounter++).padStart(2, '0')}`;
      const acFailId = `AC-${String(acCounter++).padStart(2, '0')}`;

      acList.push(
        `| ${acSuccessId} | Pengguna dapat mengisi dan mengirimkan formulir dengan data yang valid. |`,
      );
      acList.push(
        `| ${acFailId} | Formulir menampilkan pesan validasi error jika field wajib dikosongkan. |`,
      );

      const inputDataLines = sem.forms
        .slice(0, 6)
        .map(
          (f) => `${f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}: literal:Sample ${f.label}`,
        );

      const scSuccessId = `SC-${String(scCounter++).padStart(2, '0')}`;
      scList.push(`### ${scSuccessId}: Submit Formulir dengan Data Valid (@success)

${scenarioTable({
  testId: `TC-${moduleName.toUpperCase()}-${String(scCounter - 1).padStart(3, '0')}`,
  covers: acSuccessId,
  precondition: `Pengguna membuka formulir di ${sem.url}`,
  inputData: inputDataLines,
  steps: [
    `Buka halaman ${sem.url}`,
    'Isi setiap field formulir dengan data yang sesuai',
    'Klik tombol submit / simpan',
  ],
  expected: [
    'Formulir berhasil disubmit tanpa pesan error',
    'Muncul notifikasi sukses atau diarahkan ke halaman ringkasan',
  ],
})}
`);

      if (requiredInputs.length > 0) {
        const scFailId = `SC-${String(scCounter++).padStart(2, '0')}`;
        scList.push(`### ${scFailId}: Validasi Error Saat Field Wajib Dikosongkan (@failure)

${scenarioTable({
  testId: `TC-${moduleName.toUpperCase()}-${String(scCounter - 1).padStart(3, '0')}`,
  covers: acFailId,
  precondition: `Pengguna membuka formulir di ${sem.url}`,
  inputData: [`${requiredInputs[0]?.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}: (kosong)`],
  steps: [
    `Buka halaman ${sem.url}`,
    `Kosongkan field wajib "${requiredInputs[0]?.label}"`,
    'Klik tombol submit / simpan',
  ],
  expected: [
    'Formulir menolak pengiriman',
    `Pesan validasi error muncul di dekat field "${requiredInputs[0]?.label}"`,
  ],
})}
`);
      }
    }

    // 4. Sub-routes suggestions
    for (const sr of sem.subRoutes) {
      backlogList.push(`- Sub-halaman: [${sr.label}] -> ${sr.routePattern}`);
    }
  }

  // Fallback only when neither QA scenarios nor catalogs were available.
  if (acList.length === 0) {
    acList.push(`| AC-01 | Halaman utama fitur ${featureName} dapat diakses dengan sukses. |`);
    scList.push(`### SC-01: Akses Halaman Utama Fitur ${featureName} (@success)

${scenarioTable({
  testId: `TC-${moduleName.toUpperCase()}-001`,
  covers: 'AC-01',
  precondition: 'Pengguna membuka aplikasi',
  steps: [`Buka halaman ${entryUrl}`],
  expected: [`Halaman ${featureName} berhasil dimuat dengan komponen utama terlihat`],
})}
`);
    scCounter = 2;
  }

  const scenarioRoles = [...new Set(userScenarios.map((scenario) => scenario.role ?? role))];
  const roleScope = [...new Set([role, ...scenarioRoles])].filter(
    (item) => item !== 'unauthenticated',
  );
  const metadataRoleScope = roleScope.length > 0 ? roleScope : ['user'];
  const accessRows: string[] = [];
  const accessExpectations: string[] = [];
  for (const scenarioRole of scenarioRoles) {
    const roleScenarios = userScenarios.filter(
      (scenario) => (scenario.role ?? role) === scenarioRole,
    );
    const denied = roleScenarios.some((scenario) => scenario.type === 'access-restriction');
    const expectation = roleScenarios.flatMap((scenario) => scenario.expectedResults).join('; ');
    accessRows.push(
      `| ${scenarioRole} | ${denied ? 'deny' : 'allow'} | ${expectation.replace(/\|/g, '\\|')} |`,
    );
    accessExpectations.push(`${scenarioRole}: ${denied ? 'tidak bisa' : 'bisa'} ${expectation}`);
  }

  const markdown = `# ${reqId}: ${rawTitle}

## Metadata

| Field | Nilai |
| --- | --- |
| Tags | #${moduleName.toLowerCase()} #ui #regression #discovered |
| Prioritas | high |
| Auth state | ${role !== 'unauthenticated' ? 'authenticated' : 'unauthenticated'} |
| Halaman awal | ${entryUrl} |
| Module | ${moduleName.toLowerCase()} |
| Feature | ${featureName.toLowerCase()} |
| Role scope | ${metadataRoleScope.join(', ')} |
| Access expectation | ${accessExpectations.length > 0 ? accessExpectations.join('; ') : `${metadataRoleScope[0]}: bisa mengakses fitur`} |
| Default role | ${role === 'unauthenticated' ? 'user' : role} |

## Kriteria Penerimaan

| ID | Kriteria |
| --- | --- |
${acList.join('\n')}

${accessRows.length > 0 ? `## Access Matrix\n\n| Role | Access | Expectation |\n| --- | --- | --- |\n${accessRows.join('\n')}\n` : ''}

## Skenario Uji

${scList.join('\n---\n\n')}
${
  backlogList.length > 0
    ? `\n<!--
### 💡 Rekomendasi Skenario Tambahan (Backlog):
${backlogList.join('\n')}
-->`
    : ''
}
`;

  const rawOutput = readString(args.outputPath, 'outputPath');
  // outputPath must land inside requirements/ as a feature file — same rules as
  // the rest of the pipeline (blocks traversal, _TEMPLATE/README, outside-repo paths).
  let resolvedAbs: string | null = null;
  if (rawOutput) {
    const resolvedOutput = resolveAllowedPath(rawOutput, 'requirements', { mustExist: false });
    if (!resolvedOutput.ok) {
      return {
        status: 'error',
        message: resolvedOutput.error.message,
        error: resolvedOutput.error,
      };
    }
    resolvedAbs = resolvedOutput.absolutePath;
  }

  const outputAbs =
    resolvedAbs ??
    path.join(
      getRepoRoot(),
      mcpWorkspace.requirementsRel,
      `${featureName.toLowerCase().replace(/[^a-z0-9-_]+/g, '-')}.md`,
    );
  if (fs.existsSync(outputAbs)) {
    const err = createToolError(
      'INVALID_INPUT',
      `Requirement already exists at ${path.relative(getRepoRoot(), outputAbs).replace(/\\/g, '/')}; provide a new outputPath instead of overwriting it.`,
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }
  const outputRel = path.relative(getRepoRoot(), outputAbs).replace(/\\/g, '/');

  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
  fs.writeFileSync(outputAbs, markdown, 'utf8');

  return {
    status: 'success',
    featureName,
    requirementPath: outputRel.replace(/\\/g, '/'),
    markdownContent: markdown,
    activeScenariosCount: scCounter - 1,
    backlogSuggestionsCount: backlogList.length,
    message: `Requirement synthesized successfully at ${outputRel.replace(/\\/g, '/')}`,
  };
}
