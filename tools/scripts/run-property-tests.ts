/// <reference types="node" />

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROPERTY_DIR = fs.existsSync(path.join(process.cwd(), 'src', '__tests__', 'property'))
  ? path.join(process.cwd(), 'src', '__tests__', 'property')
  : path.join(process.cwd(), 'src', 'tests', 'property');

function findPropertyTests(): string[] {
  if (!fs.existsSync(PROPERTY_DIR)) {
    return [];
  }

  return fs
    .readdirSync(PROPERTY_DIR)
    .filter((name) => name.endsWith('.property.ts'))
    .map((name) => path.join(PROPERTY_DIR, name))
    .sort((a, b) => a.localeCompare(b));
}

function main(): void {
  const files = findPropertyTests();

  if (files.length === 0) {
    process.stderr.write(`ERROR: No property tests found in ${PROPERTY_DIR}\n`);
    process.exit(1);
  }

  let failed = 0;

  for (const file of files) {
    const relative = path.relative(process.cwd(), file).replace(/\\/g, '/');
    process.stdout.write(`\n▶ ${relative}\n`);

    const result = spawnSync('npx', ['tsx', file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: true,
      stdio: 'inherit',
    });

    if ((result.status ?? 1) !== 0) {
      // Real failure surfaced twice: inline marker + GitHub annotation (not a grey log).
      process.stderr.write(`✗ Failed: ${relative}\n`);
      if (process.env.GITHUB_ACTIONS === 'true') {
        process.stdout.write(`::error::Property test failed: ${relative}\n`);
      }
      failed += 1;
    }
  }

  process.stdout.write(`\n${files.length - failed}/${files.length} property test files passed\n`);

  if (failed > 0) {
    process.stderr.write(
      `\n❌ ${failed} property test file(s) gagal — lihat blok '✗ Failed' di atas untuk daftar filenya.\n`,
    );
    process.exit(1);
  }
}

main();
