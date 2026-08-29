/// <reference types="node" />

import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateRequirement } from '../mcp/src/tools/validate-requirement';
import { findRepoRoot } from '../mcp/src/utils/safety';
import { EXIT } from '../scripts/exit-codes';
import {
  friendly,
  printError,
  printOk,
  printWarn,
  withFriendlyErrors,
} from '../scripts/format-error';
import { isInteractiveStdin, pickRequirementFile } from '../scripts/pick-requirement';

async function main(): Promise<void> {
  await withFriendlyErrors(async () => {
    // Anchor cwd at the repo root first so the picker sees requirements/
    const repoRoot = findRepoRoot(__dirname);
    process.chdir(repoRoot);

    let argPath = process.argv[2];
    if (!argPath && isInteractiveStdin()) {
      const picked = await pickRequirementFile(repoRoot);
      if (picked) argPath = picked;
    }

    if (!argPath) {
      throw friendly({
        title: 'Argumen requirement file tidak ada',
        detail:
          'Usage: npm run validate:requirement   (TTY memilih file)  |  npx tsx tools/validators/validate-requirement.ts requirements/nama-fitur.md',
        hint: 'Di terminal interaktif ketik npm run validate:requirement. CI wajib kirim path.',
        docsLink: 'docs/GUIDE.md#validasi-format-tanpa-buka-agent',
        exitCode: EXIT.USAGE,
      });
    }

    const resolved = path.resolve(process.cwd(), argPath);
    if (!fs.existsSync(resolved)) {
      throw friendly({
        title: `File requirement tidak ditemukan: ${argPath}`,
        detail: `Resolved path: ${resolved}`,
        hint: 'Buat dulu dari template: cp requirements/_TEMPLATE.md ' + argPath,
        docsLink: 'docs/GUIDE.md#writing-requirements',
        exitCode: EXIT.USAGE,
      });
    }

    const relativePath = path.relative(process.cwd(), resolved).replace(/\\/g, '/');
    const output = validateRequirement({ requirementPath: relativePath });

    let errorCount = 0;
    let warnCount = 0;

    for (const violation of output.violations) {
      const scenario = violation.scenarioName ? ` [${violation.scenarioName}]` : '';
      if (violation.severity === 'error') {
        errorCount++;
        printError({
          title: `${violation.ruleName}${scenario}`,
          detail: violation.message,
          hint: violation.suggestion ?? 'Perbaiki manual lalu validasi ulang.',
          docsLink: 'docs/GUIDE.md#troubleshooting-validate-requirement',
          exitCode: EXIT.FIXABLE,
        });
      } else {
        warnCount++;
        printWarn(`${violation.ruleName}${scenario}: ${violation.message}`);
        if (violation.suggestion) {
          process.stdout.write(`  💡 ${violation.suggestion}\n`);
        }
      }
    }

    process.stdout.write('\n');
    if (output.status === 'error') {
      if (output.violations.length === 0) {
        printError({
          title: 'Validation failed',
          detail: output.message,
          hint: 'Lihat output di atas untuk detail.',
          exitCode: EXIT.FIXABLE,
        });
      }
      process.stderr.write(`Score: ${output.score}/100\n\n`);
      process.stderr.write(
        `❌ ${errorCount} error, ${warnCount} warning. Perbaiki error lalu coba lagi.\n`,
      );
      process.exit(EXIT.FIXABLE);
    }

    printOk(`${output.message}`);
    if (output.violations.length > 0) {
      printWarn(`${warnCount} warning — review sebelum lanjut pipeline.`);
    }
    printOk(`Score: ${output.score}/100`);
    process.exit(EXIT.OK);
  });
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(EXIT.ESCALATE);
});
