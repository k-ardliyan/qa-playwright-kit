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
  const role = readString(args.role, 'role') ?? 'user';
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

- **Test ID:** TC-${moduleName.toUpperCase()}-${String(scCounter - 1).padStart(3, '0')}
- **Covers:** ${acId}
- **Prioritas skenario:** high
- **Layer terdampak:** FE

**Prekondisi:** Pengguna berada di halaman ${sem.url} dengan role ${role}

**Langkah:**
1. Buka halaman ${sem.url}
2. Verifikasi tabel "${table.name}" berhasil dimuat
3. Periksa kesesuaian header kolom pada tabel

**Hasil yang Diharapkan:**
- Tabel "${table.name}" tampil di layar
- Kolom tabel memuat: ${colStr}
- Minimal 1 baris data terlihat dengan status yang valid
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
        `- **${acId}:** Card ringkasan metrik statistik (${cardTitles}) menampilkan informasi data yang valid.`,
      );

      scList.push(`### ${scId}: Verifikasi Ringkasan Metrik Statistik (@success)

- **Test ID:** TC-${moduleName.toUpperCase()}-${String(scCounter - 1).padStart(3, '0')}
- **Covers:** ${acId}
- **Prioritas skenario:** medium
- **Layer terdampak:** FE

**Prekondisi:** Pengguna membuka halaman ${sem.url}

**Langkah:**
1. Buka halaman ${sem.url}
2. Periksa blok card informasi statistik di bagian atas halaman

**Hasil yang Diharapkan:**
- Card metrik (${cardTitles}) tampil dengan format angka yang benar
`);
    }

    // 3. Form Input Scenarios (@success & @failure)
    if (sem.forms.length > 0) {
      const requiredInputs = sem.forms.filter((f) => f.required);
      const acSuccessId = `AC-${String(acCounter++).padStart(2, '0')}`;
      const acFailId = `AC-${String(acCounter++).padStart(2, '0')}`;

      acList.push(
        `- **${acSuccessId}:** Pengguna dapat mengisi dan mengirimkan formulir dengan data yang valid.`,
      );
      acList.push(
        `- **${acFailId}:** Formulir menampilkan pesan validasi error jika field wajib dikosongkan.`,
      );

      const inputDataLines = sem.forms
        .slice(0, 6)
        .map(
          (f) =>
            `- ${f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}: literal:Sample ${f.label}`,
        )
        .join('\n');

      const scSuccessId = `SC-${String(scCounter++).padStart(2, '0')}`;
      scList.push(`### ${scSuccessId}: Submit Formulir dengan Data Valid (@success)

- **Test ID:** TC-${moduleName.toUpperCase()}-${String(scCounter - 1).padStart(3, '0')}
- **Covers:** ${acSuccessId}
- **Prioritas skenario:** high
- **Layer terdampak:** FE

**Prekondisi:** Pengguna membuka formulir di ${sem.url}

**Input Data:**
${inputDataLines}

**Langkah:**
1. Buka halaman ${sem.url}
2. Isi setiap field formulir dengan data yang sesuai
3. Klik tombol submit / simpan

**Hasil yang Diharapkan:**
- Formulir berhasil disubmit tanpa pesan error
- Muncul notifikasi sukses atau diarahkan ke halaman ringkasan
`);

      if (requiredInputs.length > 0) {
        const scFailId = `SC-${String(scCounter++).padStart(2, '0')}`;
        scList.push(`### ${scFailId}: Validasi Error Saat Field Wajib Dikosongkan (@failure)

- **Test ID:** TC-${moduleName.toUpperCase()}-${String(scCounter - 1).padStart(3, '0')}
- **Covers:** ${acFailId}
- **Prioritas skenario:** high
- **Layer terdampak:** FE

**Prekondisi:** Pengguna membuka formulir di ${sem.url}

**Input Data:**
- ${requiredInputs[0]?.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}: (kosong)

**Langkah:**
1. Buka halaman ${sem.url}
2. Kosongkan field wajib "${requiredInputs[0]?.label}"
3. Klik tombol submit / simpan

**Hasil yang Diharapkan:**
- Formulir menolak pengiriman
- Pesan validasi error muncul di dekat field "${requiredInputs[0]?.label}"
`);
      }
    }

    // 4. Sub-routes suggestions
    for (const sr of sem.subRoutes) {
      backlogList.push(`- Sub-halaman: [${sr.label}] -> ${sr.routePattern}`);
    }
  }

  // Fallback if no catalogs found yet
  if (acList.length === 0) {
    acList.push(`- **AC-01:** Halaman utama fitur ${featureName} dapat diakses dengan sukses.`);
    scList.push(`### SC-01: Akses Halaman Utama Fitur ${featureName} (@success)

- **Test ID:** TC-${moduleName.toUpperCase()}-001
- **Covers:** AC-01
- **Prioritas skenario:** high
- **Layer terdampak:** FE

**Prekondisi:** Pengguna membuka aplikasi

**Langkah:**
1. Buka halaman ${entryUrl}

**Hasil yang Diharapkan:**
- Halaman ${featureName} berhasil dimuat dengan komponen utama terlihat
`);
    scCounter = 2;
  }

  const markdown = `# ${reqId}: ${rawTitle}

## Metadata

- **Tags:** #${moduleName.toLowerCase()} #ui #regression #discovered
- **Prioritas:** high
- **Auth state:** ${role && role !== 'unauthenticated' ? 'authenticated' : 'unauthenticated'}
- **Halaman awal:** ${entryUrl}
- **Module:** ${moduleName.toLowerCase()}
- **Feature:** ${featureName.toLowerCase()}
- **Role scope:** ${role}
- **Default role:** ${role}

## Kriteria Penerimaan

${acList.join('\n')}

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
