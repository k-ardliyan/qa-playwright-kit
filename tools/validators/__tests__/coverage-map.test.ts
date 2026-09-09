import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildCoverageReport,
  collectFiles,
  importSpecifiers,
  isModuleCoveredByTest,
  resolveSpecifier,
} from '../../validators/coverage-map';

/** Create an isolated temp tree that mimics the repo layout. */
function makeTree(): { root: string; src: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-map-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'feature', '__tests__'), { recursive: true });
  fs.mkdirSync(path.join(src, 'public'), { recursive: true });
  return {
    root,
    src,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function write(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

test('collectFiles honors skipTestsDirs', () => {
  const { root, src, cleanup } = makeTree();
  try {
    write(root, 'src/feature/core.ts', 'export const a = 1;\n');
    write(root, 'src/feature/__tests__/core.test.ts', "import { a } from '../core';\n");
    expect(collectFiles(src, (n) => /\.test\.ts$/.test(n), false)).toHaveLength(1);
    expect(collectFiles(src, (n) => /\.test\.ts$/.test(n), true)).toHaveLength(0);
  } finally {
    cleanup();
  }
});

test('importSpecifiers extracts static relative and alias imports only', () => {
  const { root, cleanup } = makeTree();
  try {
    const f = write(
      root,
      'src/feature/__tests__/x.test.ts',
      [
        "import { a } from '../core';",
        "import { b } from '@/other';",
        'const dynamic = import("../lazy");',
        "export type { C } from './types';",
      ].join('\n'),
    );
    expect(importSpecifiers(f)).toEqual(['../core', '@/other', './types']);
  } finally {
    cleanup();
  }
});

test('resolveSpecifier resolves relative, alias, and index imports under src', () => {
  const { root, src, cleanup } = makeTree();
  try {
    write(root, 'src/feature/core.ts', 'export const a = 1;\n');
    write(root, 'src/feature/sub/index.ts', 'export const b = 2;\n');
    expect(resolveSpecifier(path.join(src, 'feature'), './core', src)?.endsWith('core.ts')).toBe(
      true,
    );
    expect(
      resolveSpecifier(path.join(src, 'feature'), '@/feature/core', src)?.endsWith('core.ts'),
    ).toBe(true);
    expect(resolveSpecifier(path.join(src, 'feature'), './sub', src)?.endsWith('index.ts')).toBe(
      true,
    );
    // Outside src/ and bare specifiers never resolve.
    expect(resolveSpecifier(path.join(src, 'feature'), '../..', src)).toBeNull();
    expect(resolveSpecifier(path.join(src, 'feature'), 'playwright', src)).toBeNull();
  } finally {
    cleanup();
  }
});

test('isModuleCoveredByTest matches direct, alias, and ancestor-barrel imports', () => {
  const { root, src, cleanup } = makeTree();
  try {
    const core = write(root, 'src/feature/core.ts', 'export const a = 1;\n');
    // Direct relative import.
    const direct = write(
      root,
      'src/feature/__tests__/direct.test.ts',
      "import { a } from '../core';\n",
    );
    expect(isModuleCoveredByTest(core, direct, src)).toBe(true);

    // Alias import.
    const alias = write(
      root,
      'src/feature/__tests__/alias.test.ts',
      "import { a } from '@/feature/core';\n",
    );
    expect(isModuleCoveredByTest(core, alias, src)).toBe(true);

    // Ancestor import (barrel chain): test imports the feature barrel.
    const barrel = write(root, 'src/feature/index.ts', "export * from './core';\n");
    const viaBarrel = write(
      root,
      'src/feature/__tests__/barrel.test.ts',
      "import { a } from '..';\n",
    );
    expect(isModuleCoveredByTest(core, viaBarrel, src)).toBe(true);
    expect(isModuleCoveredByTest(barrel, viaBarrel, src)).toBe(true);

    // Unrelated test does not cover.
    const unrelated = write(
      root,
      'src/feature/__tests__/other.test.ts',
      "import { x } from 'playwright';\n",
    );
    expect(isModuleCoveredByTest(core, unrelated, src)).toBe(false);
  } finally {
    cleanup();
  }
});

test('buildCoverageReport flags large untested modules but accepts property tests', () => {
  const { root, cleanup } = makeTree();
  try {
    const bigBody = `${Array.from({ length: 200 }, (_, i) => `const v${i} = ${i};`).join('\n')}\n`;
    const propBody = `${Array.from({ length: 200 }, (_, i) => `const p${i} = ${i};`).join('\n')}\n`;
    // >150-line module with no test at all.
    write(root, 'src/orphan/big.ts', bigBody);
    // Module covered only by a property test.
    write(root, 'src/p/engine.ts', propBody);
    write(root, 'src/__tests__/property/engine.property.ts', "import '../../p/engine';\n");

    const report = buildCoverageReport(root);
    const errorFiles = report.findings.filter((f) => f.severity === 'error');
    expect(errorFiles.map((f) => f.file).some((f) => f.endsWith('orphan/big.ts'))).toBe(true);
    expect(report.coveredFiles.some((f) => f.endsWith('p/engine.ts'))).toBe(true);
  } finally {
    cleanup();
  }
});
