/**
 * Standalone Node assert harness (not a Playwright test).
 * Run: npx tsx tools/scripts/__tests__/framework-upgrade.test.ts
 *
 * Covers the upgrade safety contract with REAL git repos in a temp dir:
 *   - framework-zone diff selection (QA files are never targets)
 *   - dirty-worktree guard (git checkout discards local edits silently)
 *   - untracked collision guard (git checkout overwrites silently)
 *   - --check touches nothing
 *   - apply stages changes, deletes removed files, leaves QA files byte-identical
 *   - generated auth.setup.ts: preserve on marker, replace + .bak otherwise
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertCleanWorktree,
  applyZoneDiff,
  computeZoneDiff,
  firstChangelogSection,
  FRAMEWORK_PATHS,
  GENERATED_AUTH_SETUP,
  inFrameworkZone,
  findRiskyLocalFrameworkCommits,
  packageVersion,
  parsePorcelain,
  parseUpgradeArgs,
  runUpgrade,
  shouldPreserveGeneratedFile,
  UpgradeError,
} from '../framework-upgrade';

let passed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  \u2713 ${name}\n`);
  } catch (err) {
    process.stdout.write(`  \u2717 ${name}\n`);
    throw err;
  }
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function write(cwd: string, rel: string, content: string): void {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

/** Read a file with EOL normalized — Windows autocrlf rewrites LF→CRLF on checkout. */
function read(cwd: string, rel: string): string {
  return fs.readFileSync(path.join(cwd, rel), 'utf-8').replace(/\r\n/g, '\n');
}

function commitAll(cwd: string, message: string): void {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message]);
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

process.stdout.write('\npure helpers\n');

check('parsePorcelain handles modified / untracked / rename', () => {
  const entries = parsePorcelain(' M src/x.ts\n?? notes.txt\nR  old.ts -> src/new.ts\n');
  assert.deepEqual(entries, [
    { status: ' M', file: 'src/x.ts' },
    { status: '??', file: 'notes.txt' },
    { status: 'R ', file: 'src/new.ts' },
  ]);
});

check('inFrameworkZone: framework yes, QA-owned no', () => {
  assert.equal(inFrameworkZone('src/x.ts'), true);
  assert.equal(inFrameworkZone('tests/data/keep.json'), true);
  assert.equal(inFrameworkZone('requirements/_TEMPLATE.md'), true);
  assert.equal(inFrameworkZone('requirements/user-qa.md'), false);
  assert.equal(inFrameworkZone('tests/mine.spec.ts'), false);
  assert.equal(inFrameworkZone('specs/checkout-test-plan.md'), false);
});

check('computeZoneDiff splits updated / deleted / outside', () => {
  const diff = computeZoneDiff(
    'M\tsrc/x.ts\nA\tsrc/new.ts\nD\tdocs/old.md\nM\trequirements/user-qa.md\n',
  );
  assert.deepEqual(diff.updated, ['src/x.ts', 'src/new.ts']);
  assert.deepEqual(diff.deleted, ['docs/old.md']);
  assert.deepEqual(diff.outside, ['requirements/user-qa.md']);
});

check('shouldPreserveGeneratedFile only for marker-bearing auth.setup.ts', () => {
  assert.equal(
    shouldPreserveGeneratedFile(GENERATED_AUTH_SETUP, '// CUSTOM_AUTH_FLOW\ncode'),
    true,
  );
  assert.equal(
    shouldPreserveGeneratedFile(GENERATED_AUTH_SETUP, '// KUSTOM_LOGIN_FLOW\ncode'),
    true,
  );
  assert.equal(shouldPreserveGeneratedFile(GENERATED_AUTH_SETUP, 'plain generated code'), false);
  assert.equal(shouldPreserveGeneratedFile('src/support/other.ts', '// CUSTOM_AUTH_FLOW'), false);
});

check(
  'assertCleanWorktree: tracked dirty throws, untracked outside passes, untracked inside throws',
  () => {
    assert.doesNotThrow(() => assertCleanWorktree([], FRAMEWORK_PATHS));
    assert.doesNotThrow(() =>
      assertCleanWorktree([{ status: '??', file: 'notes.txt' }], FRAMEWORK_PATHS),
    );
    assert.throws(
      () => assertCleanWorktree([{ status: ' M', file: 'src/x.ts' }], FRAMEWORK_PATHS),
      UpgradeError,
    );
    assert.throws(
      () => assertCleanWorktree([{ status: '??', file: 'src/local-probe.ts' }], FRAMEWORK_PATHS),
      UpgradeError,
    );
  },
);

check('packageVersion / firstChangelogSection / parseUpgradeArgs', () => {
  assert.equal(packageVersion('{"version":"1.2.3"}'), '1.2.3');
  assert.equal(packageVersion('not json'), null);
  assert.equal(
    firstChangelogSection('# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n'),
    '## [Unreleased]',
  );
  const options = parseUpgradeArgs(['--check', '--source', '/tmp/upstream', '--ref', 'v1']);
  assert.deepEqual(options, { checkOnly: true, source: '/tmp/upstream', ref: 'v1' });
  assert.equal(parseUpgradeArgs([])?.checkOnly, false);
  assert.equal(parseUpgradeArgs(['--help']), null);
  assert.throws(() => parseUpgradeArgs(['--bogus']), UpgradeError);
});

check(
  'findRiskyLocalFrameworkCommits: local customization is flagged, synced upstream content is not',
  () => {
    // Fresh pair of repos: upstream + QA clone sharing history.
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-upgrade-risky-'));
    const up = path.join(tmp2, 'up');
    const qa2 = path.join(tmp2, 'qa');
    try {
      fs.mkdirSync(up, { recursive: true });
      git(up, ['init', '-q', '-b', 'main']);
      git(up, ['config', 'user.email', 'm@t.local']);
      git(up, ['config', 'user.name', 'M']);
      write(up, 'src/f.ts', 'upstream v1\n');
      write(up, 'src/g.ts', 'upstream g v1\n');
      commitAll(up, 'v1');

      fs.mkdirSync(qa2, { recursive: true });
      git(qa2, ['init', '-q', '-b', 'main']);
      git(qa2, ['config', 'user.email', 'q@t.local']);
      git(qa2, ['config', 'user.name', 'Q']);
      git(qa2, ['remote', 'add', 'origin', up]);
      git(qa2, ['fetch', '-q', 'origin', 'main']);
      git(qa2, ['reset', '-q', '--hard', 'FETCH_HEAD']);
      git(qa2, ['remote', 'remove', 'origin']);

      // Local commit that merely syncs an upstream version of g.ts (previous upgrade).
      write(up, 'src/g.ts', 'upstream g v2\n');
      commitAll(up, 'v2');
      git(qa2, ['fetch', '-q', up, 'main']);
      git(qa2, ['checkout', '-q', 'FETCH_HEAD', '--', 'src/g.ts']);
      commitAll(qa2, 'sync upgrade');
      // Local commit with a REAL customization of f.ts (never upstream).
      write(qa2, 'src/f.ts', 'LOCAL CUSTOMIZATION\n');
      commitAll(qa2, 'local tweak');

      // Upstream now changes both files.
      write(up, 'src/f.ts', 'upstream f v2\n');
      write(up, 'src/g.ts', 'upstream g v3\n');
      commitAll(up, 'v3');
      git(qa2, ['fetch', '-q', up, 'main']);

      const check1 = findRiskyLocalFrameworkCommits(qa2, ['src/f.ts', 'src/g.ts']);
      assert.ok(check1.riskyFiles.includes('src/f.ts'), 'local customization must be flagged');
      assert.ok(
        !check1.riskyFiles.includes('src/g.ts'),
        'synced upstream content must NOT be flagged',
      );
      assert.ok(check1.commits.length > 0);

      // A file upstream never touched is never at risk, even when customized locally.
      const check2 = findRiskyLocalFrameworkCommits(qa2, ['src/other.ts']);
      assert.deepEqual(check2, { commits: [], riskyFiles: [] });
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  },
);

// ─── Integration: real git repos ─────────────────────────────────────────────

process.stdout.write('\nintegration (real git repos)\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-upgrade-'));
const upstream = path.join(tmp, 'upstream');
const qa = path.join(tmp, 'qa');

try {
  fs.mkdirSync(upstream, { recursive: true });
  git(upstream, ['init', '-q', '-b', 'main']);
  git(upstream, ['config', 'user.email', 'maintainer@test.local']);
  git(upstream, ['config', 'user.name', 'Maintainer']);
  write(upstream, 'package.json', '{"name":"qa-playwright-kit","version":"0.1.0"}');
  write(upstream, 'src/x.ts', 'export const x = "v1";\n');
  write(upstream, 'docs/y.md', '# y v1\n');
  write(upstream, 'docs/old.md', 'to be removed\n');
  write(upstream, 'requirements/_TEMPLATE.md', 'template v1\n');
  write(upstream, 'tests/data/keep.json', '{"v":1}\n');
  write(upstream, 'src/support/auth.setup.ts', 'generated v1\n');
  commitAll(upstream, 'v1');

  // QA repo = template copy at v1 (no shared-history assumption needed: fetch by path).
  fs.mkdirSync(qa, { recursive: true });
  git(qa, ['init', '-q', '-b', 'main']);
  git(qa, ['config', 'user.email', 'qa@test.local']);
  git(qa, ['config', 'user.name', 'QA']);
  git(qa, ['remote', 'add', 'origin', upstream]);
  git(qa, ['fetch', '-q', 'origin', 'main']);
  git(qa, ['reset', '-q', '--hard', 'FETCH_HEAD']);
  git(qa, ['remote', 'remove', 'origin']);

  // QA owns a spec (tracked, upstream never has it) + a local env-like gitignored file.
  write(qa, 'tests/mine.spec.ts', 'export const mine = "qa-owned";\n');
  write(qa, '.gitignore', 'config/environments/*.env\n');
  write(qa, 'config/environments/local.env', 'SECRET=qa-local\n');
  commitAll(qa, 'qa spec');

  // Upstream advances: framework files + a QA-named file upstream happens to carry.
  write(upstream, 'src/x.ts', 'export const x = "v2";\n');
  write(upstream, 'src/new.ts', 'export const added = true;\n');
  write(upstream, 'docs/y.md', '# y v2\n');
  fs.rmSync(path.join(upstream, 'docs/old.md'));
  write(upstream, 'requirements/_TEMPLATE.md', 'template v2\n');
  write(upstream, 'requirements/user-qa.md', 'upstream copy — must NOT land in QA repo\n');
  commitAll(upstream, 'v2');

  check('dirty guard: untracked file inside framework zone aborts before touching anything', () => {
    write(qa, 'src/local-probe.ts', 'local scratch\n');
    assert.throws(
      () => runUpgrade(qa, { checkOnly: false, source: upstream, ref: 'main' }),
      (err: unknown) => err instanceof UpgradeError && /local-probe/.test((err as Error).message),
    );
    fs.rmSync(path.join(qa, 'src/local-probe.ts'));
  });

  check('--check previews zone files only and touches nothing', () => {
    const preview = runUpgrade(qa, { checkOnly: true, source: upstream, ref: 'main' });
    assert.ok(preview.updated.includes('src/x.ts'));
    assert.ok(preview.updated.includes('src/new.ts'));
    assert.ok(preview.updated.includes('docs/y.md'));
    assert.ok(preview.updated.includes('requirements/_TEMPLATE.md'));
    assert.ok(!preview.updated.includes('requirements/user-qa.md'));
    assert.equal(preview.fromVersion, '0.1.0');
    assert.equal(preview.toVersion, '0.1.0');

    assert.equal(read(qa, 'src/x.ts'), 'export const x = "v1";\n');
    assert.equal(git(qa, ['status', '--porcelain']).stdout.trim(), '');
  });

  check('--check still previews on a dirty worktree (no writes, no guard)', () => {
    write(qa, 'src/x.ts', 'export const x = "local edit";\n');
    const preview = runUpgrade(qa, { checkOnly: true, source: upstream, ref: 'main' });
    assert.ok(preview.updated.includes('src/x.ts'));
    // The local edit is still there — preview never writes.
    assert.equal(read(qa, 'src/x.ts'), 'export const x = "local edit";\n');
    git(qa, ['checkout', '--', 'src/x.ts']);
  });

  check('apply stages framework files, leaves removed + QA files alone', () => {
    const diff = git(qa, ['diff', '--name-status', 'HEAD', 'FETCH_HEAD', '--', ...FRAMEWORK_PATHS]);
    const zone = computeZoneDiff(diff.stdout);
    const result = applyZoneDiff(qa, zone);

    assert.ok(result.applied.includes('src/x.ts'));
    assert.equal(read(qa, 'src/x.ts'), 'export const x = "v2";\n');
    assert.ok(fs.existsSync(path.join(qa, 'src/new.ts')));
    assert.equal(read(qa, 'docs/y.md'), '# y v2\n');
    assert.equal(read(qa, 'requirements/_TEMPLATE.md'), 'template v2\n');

    // Removed upstream → reported, NOT deleted (QA files may live in the same dir).
    assert.ok(zone.deleted.includes('docs/old.md'));
    assert.ok(fs.existsSync(path.join(qa, 'docs/old.md')));

    // QA-owned + gitignored files untouched.
    assert.equal(read(qa, 'tests/mine.spec.ts'), 'export const mine = "qa-owned";\n');
    assert.ok(!fs.existsSync(path.join(qa, 'requirements/user-qa.md')));
    assert.equal(read(qa, 'config/environments/local.env'), 'SECRET=qa-local\n');

    // Changes are STAGED, not committed.
    const staged = git(qa, ['diff', '--cached', '--name-only']).stdout;
    assert.ok(staged.includes('src/x.ts'));
    assert.equal(git(qa, ['log', '-1', '--format=%s']).stdout.trim(), 'qa spec');
  });

  check('dirty guard: staged changes from a previous apply block the next run', () => {
    assert.throws(
      () => runUpgrade(qa, { checkOnly: false, source: upstream, ref: 'main' }),
      UpgradeError,
    );
    commitAll(qa, 'sync upstream v2');
  });

  check('auth.setup.ts with QA marker is preserved, without marker replaced + .bak', () => {
    // QA customizes the generated login flow.
    write(qa, GENERATED_AUTH_SETUP, '// CUSTOM_AUTH_FLOW\nexport const custom = true;\n');
    commitAll(qa, 'customize auth flow');
    write(upstream, GENERATED_AUTH_SETUP, 'generated v2\n');
    commitAll(upstream, 'upstream changes auth template');

    git(qa, ['fetch', '-q', upstream, 'main']);
    const diff = git(qa, ['diff', '--name-status', 'HEAD', 'FETCH_HEAD', '--', ...FRAMEWORK_PATHS]);
    const zone = computeZoneDiff(diff.stdout);
    assert.deepEqual(zone.updated, [GENERATED_AUTH_SETUP]);

    const preserved = applyZoneDiff(qa, zone);
    assert.deepEqual(preserved.preserved, [GENERATED_AUTH_SETUP]);
    assert.equal(
      read(qa, GENERATED_AUTH_SETUP),
      '// CUSTOM_AUTH_FLOW\nexport const custom = true;\n',
    );
    assert.ok(!fs.existsSync(path.join(qa, `${GENERATED_AUTH_SETUP}.bak`)));

    // QA drops the marker → file is treated as generated and replaced, with backup.
    write(qa, GENERATED_AUTH_SETUP, 'unmarked local version\n');
    commitAll(qa, 'drop marker');
    git(qa, ['fetch', '-q', upstream, 'main']);
    const diff2 = git(qa, [
      'diff',
      '--name-status',
      'HEAD',
      'FETCH_HEAD',
      '--',
      ...FRAMEWORK_PATHS,
    ]);
    const zone2 = computeZoneDiff(diff2.stdout);
    const replaced = applyZoneDiff(qa, zone2);
    assert.deepEqual(replaced.preserved, []);
    assert.equal(read(qa, GENERATED_AUTH_SETUP), 'generated v2\n');
    assert.equal(read(qa, `${GENERATED_AUTH_SETUP}.bak`), 'unmarked local version\n');
  });

  check('up to date: second run reports no framework changes', () => {
    commitAll(qa, 'sync auth template');
    // docs/old.md still exists (never auto-deleted) → deletion-only report, no apply loop.
    const outcome = runUpgrade(qa, { checkOnly: true, source: upstream, ref: 'main' });
    assert.deepEqual(outcome.updated, []);
    assert.deepEqual(outcome.preserved, []);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write(`\n${passed} checks passed\n`);
