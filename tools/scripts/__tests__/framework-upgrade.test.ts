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
 *   - marker-bearing auth.setup.ts never blocks the dirty guard (uncommitted or not)
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertCleanWorktree,
  applyZoneDiff,
  commitExists,
  computeZoneDiff,
  firstChangelogSection,
  FRAMEWORK_PATHS,
  GENERATED_AUTH_SETUP,
  hasCustomizationMarker,
  inFrameworkZone,
  findRiskyLocalFrameworkCommits,
  looksBinary,
  mergeFile,
  packageVersion,
  parsePorcelain,
  parseUpgradeArgs,
  resolveBase,
  runUpgrade,
  shouldPreserveGeneratedFile,
  toJsonResult,
  UpgradeError,
} from '../framework-upgrade';
import { readUpgradeState, writeUpgradeState } from '../upgrade-state';
import { generateAuthSetupContent } from '../wizard-auth-template';

// Isolate the Hermes install probe for the WHOLE harness. `runUpgrade` runs the
// real skill sync, which detects Hermes via LOCALAPPDATA; without this, the
// integration runs would register their throwaway temp repos in the developer's
// real ~/.hermes/config.yaml (trusted_project_dirs). Pointing LOCALAPPDATA at an
// empty temp dir makes detectHermesInstall() false → no trust spawn, no writes.
const isolatedLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-upgrade-hermes-'));
process.env.LOCALAPPDATA = isolatedLocalAppData;
process.on('exit', () => {
  fs.rmSync(isolatedLocalAppData, { recursive: true, force: true });
});

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
  // The framework pack ships in the zone (refreshed by upgrade). Hermes learns
  // outside the repo entirely (~/.hermes/skills), so no repo path is a learned
  // zone and nothing the kit writes can overwrite a Hermes lesson.
  assert.equal(inFrameworkZone('skills/qa-playwright-kit/SKILL.md'), true);
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

check('marker detection is line-anchored: a docstring MENTION does not mark a file', () => {
  // The generated template's own docstring teaches the marker — if a mention
  // counted, every fresh file would be born "customized" and the wizard could
  // never regenerate it (regression: the .bak test above went red).
  assert.equal(hasCustomizationMarker('// CUSTOM_AUTH_FLOW\nexport const x = 1;\n'), true);
  assert.equal(hasCustomizationMarker('// KUSTOM_LOGIN_FLOW\nexport const x = 1;\n'), true);
  assert.equal(
    hasCustomizationMarker(' * add // CUSTOM_AUTH_FLOW at the top of this file\n'),
    false,
  );
  assert.equal(hasCustomizationMarker('const x = "CUSTOM_AUTH_FLOW";\n'), false);
  assert.equal(
    shouldPreserveGeneratedFile(
      GENERATED_AUTH_SETUP,
      generateAuthSetupContent({
        roles: [{ name: 'user', authFile: '.auth/local/user.json' }],
        loginUrl: '/login',
        successUrlPath: '/dashboard',
      }),
    ),
    false,
    'freshly generated auth.setup.ts must NOT be treated as customized',
  );
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
  assert.deepEqual(options, { checkOnly: true, source: '/tmp/upstream', ref: 'v1', json: false });
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

// ─── Marker-aware dirty guard (unit) ─────────────────────────────────────────
// The marker-bearing generated auth.setup.ts is preserved by applyZoneDiff, so
// the dirty guard must not block on it — QA edits it locally and runs upgrade
// without committing. Real file content is read via markerAwareBaseDir.

process.stdout.write('\nmarker-aware dirty guard\n');

check('marker-bearing auth.setup.ts is waived by the guard; unmarked still blocks', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-guard-marker-'));
  try {
    write(base, GENERATED_AUTH_SETUP, '// CUSTOM_AUTH_FLOW\nexport const custom = true;\n');
    // Marker present (uncommitted) → waived.
    assert.doesNotThrow(() =>
      assertCleanWorktree([{ status: ' M', file: GENERATED_AUTH_SETUP }], FRAMEWORK_PATHS, base),
    );
    // Legacy marker is honoured too.
    write(base, GENERATED_AUTH_SETUP, '// KUSTOM_LOGIN_FLOW\nexport const custom = true;\n');
    assert.doesNotThrow(() =>
      assertCleanWorktree([{ status: ' M', file: GENERATED_AUTH_SETUP }], FRAMEWORK_PATHS, base),
    );
    // Without the marker the guard blocks — the file would be overwritten.
    write(base, GENERATED_AUTH_SETUP, 'plain generated code\n');
    assert.throws(
      () =>
        assertCleanWorktree([{ status: ' M', file: GENERATED_AUTH_SETUP }], FRAMEWORK_PATHS, base),
      (err: unknown) =>
        err instanceof UpgradeError && /CUSTOM_AUTH_FLOW/.test((err as Error).message),
    );
    // No baseDir (pure call) stays conservative.
    assert.throws(() =>
      assertCleanWorktree([{ status: ' M', file: GENERATED_AUTH_SETUP }], FRAMEWORK_PATHS),
    );
    // Other framework files are unaffected by the waiver.
    assert.throws(() =>
      assertCleanWorktree([{ status: ' M', file: 'src/x.ts' }], FRAMEWORK_PATHS, base),
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

check('marker-bearing auth.setup.ts does not block runUpgrade (uncommitted local edit)', () => {
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-guard-run-'));
  const up = path.join(tmp3, 'up');
  const qa3 = path.join(tmp3, 'qa');
  try {
    fs.mkdirSync(up, { recursive: true });
    git(up, ['init', '-q', '-b', 'main']);
    git(up, ['config', 'user.email', 'm@t.local']);
    git(up, ['config', 'user.name', 'M']);
    write(up, 'package.json', '{"name":"qa-playwright-kit","version":"0.1.0"}');
    write(up, GENERATED_AUTH_SETUP, 'generated v1\n');
    commitAll(up, 'v1');

    fs.mkdirSync(qa3, { recursive: true });
    git(qa3, ['init', '-q', '-b', 'main']);
    git(qa3, ['config', 'user.email', 'q@t.local']);
    git(qa3, ['config', 'user.name', 'Q']);
    git(qa3, ['remote', 'add', 'origin', up]);
    git(qa3, ['fetch', '-q', 'origin', 'main']);
    git(qa3, ['reset', '-q', '--hard', 'FETCH_HEAD']);
    git(qa3, ['remote', 'remove', 'origin']);

    // Upstream changes the template; QA customizes locally WITH the marker, uncommitted.
    write(up, GENERATED_AUTH_SETUP, 'generated v2\n');
    commitAll(up, 'v2');
    write(qa3, GENERATED_AUTH_SETUP, '// CUSTOM_AUTH_FLOW\ngenerated v1 + QA steps\n');

    // Guard waived → upgrade proceeds; apply preserves the QA file.
    const outcome = runUpgrade(qa3, { checkOnly: false, source: up, ref: 'main' });
    assert.deepEqual(outcome.updated, [GENERATED_AUTH_SETUP]);
    assert.deepEqual(outcome.preserved, [GENERATED_AUTH_SETUP]);
    assert.equal(read(qa3, GENERATED_AUTH_SETUP), '// CUSTOM_AUTH_FLOW\ngenerated v1 + QA steps\n');
    // Uncommitted local edit is still uncommitted — upgrade did not stage it.
    assert.ok(!git(qa3, ['diff', '--cached', '--name-only']).stdout.includes(GENERATED_AUTH_SETUP));
  } finally {
    fs.rmSync(tmp3, { recursive: true, force: true });
  }
});

// ─── Upgrade state (base) ────────────────────────────────────────────────────

process.stdout.write('\nupgrade state (base)\n');

check('state round-trips and tolerates a corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-state-'));
  try {
    assert.equal(readUpgradeState(dir), null); // absent
    writeUpgradeState(dir, {
      schemaVersion: 1,
      upstream: 'up',
      ref: 'main',
      syncedCommit: 'abc123',
      syncedAt: '2026-10-05T00:00:00.000Z',
    });
    const back = readUpgradeState(dir);
    assert.equal(back?.syncedCommit, 'abc123');
    assert.equal(back?.ref, 'main');

    fs.writeFileSync(path.join(dir, '.upgrade-state.json'), '{ not json', 'utf-8');
    assert.equal(readUpgradeState(dir), null); // corrupt → null, never throws

    fs.writeFileSync(path.join(dir, '.upgrade-state.json'), '{"schemaVersion":2}', 'utf-8');
    assert.equal(readUpgradeState(dir), null); // wrong schema → null
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('resolveBase prefers the recorded commit, falls back to null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-base-'));
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'a@b.c']);
    git(dir, ['config', 'user.name', 't']);
    write(dir, 'a.txt', 'x\n');
    commitAll(dir, 'c1');
    const sha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();

    assert.equal(resolveBase(dir, null), null); // no state → no base
    assert.equal(
      resolveBase(dir, {
        schemaVersion: 1,
        upstream: '',
        ref: '',
        syncedCommit: 'deadbeef',
        syncedAt: '',
      }),
      null,
    ); // stale sha
    assert.equal(
      resolveBase(dir, {
        schemaVersion: 1,
        upstream: '',
        ref: '',
        syncedCommit: sha,
        syncedAt: '',
      }),
      sha,
    );
    assert.equal(commitExists(dir, sha), true);
    assert.equal(commitExists(dir, 'deadbeefdeadbeef'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('mergeFile merges disjoint edits cleanly and marks real conflicts', () => {
  const base = 'line1\nline2\nline3\nline4\n';
  // ours edits line1, theirs edits line4 → clean.
  const clean = mergeFile(base, 'OURS\nline2\nline3\nline4\n', 'line1\nline2\nline3\nTHEIRS\n');
  assert.equal(clean.clean, true);
  assert.equal(clean.failed, false);
  assert.ok(clean.content.includes('OURS'));
  assert.ok(clean.content.includes('THEIRS'));
  // both edit line1 → conflict markers.
  const conflicted = mergeFile(
    base,
    'OURS\nline2\nline3\nline4\n',
    'THEIRS\nline2\nline3\nline4\n',
  );
  assert.equal(conflicted.clean, false);
  assert.equal(conflicted.failed, false);
  assert.ok(conflicted.content.includes('<<<<<<<'));
  // binary content → git cannot merge; failed=true and content is NOT usable.
  const bin = '\u0000\u0001\u0002binary';
  const failed = mergeFile(bin, `${bin}x`, `${bin}y`);
  assert.equal(failed.failed, true);
  assert.equal(failed.clean, false);
  assert.equal(failed.content, '');
});

check('looksBinary detects NUL bytes and replacement chars', () => {
  assert.equal(looksBinary('plain text\n'), false);
  assert.equal(looksBinary('has\u0000nul'), true);
  assert.equal(looksBinary('bad\ufffdutf8'), true);
});

// ─── Integration: safe-delete + three-way merge + --json ─────────────────────

process.stdout.write('\nintegration: base-aware apply\n');

const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-upgrade-base-'));
const upB = path.join(tmpB, 'upstream');
const qaB = path.join(tmpB, 'qa');

try {
  // upstream v1
  fs.mkdirSync(upB, { recursive: true });
  git(upB, ['init', '-q', '-b', 'main']);
  git(upB, ['config', 'user.email', 'm@t.local']);
  git(upB, ['config', 'user.name', 'M']);
  write(upB, 'package.json', '{"name":"qa-playwright-kit","version":"0.1.0"}');
  write(upB, 'src/x.ts', 'l1\nl2\nl3\nl4\n'); // clean 3-way merge
  write(upB, 'src/gone.ts', 'to be deleted upstream\n'); // safe-delete
  write(upB, 'src/qakept.ts', 'kept by QA\n'); // delete vs QA edit → kept
  write(upB, 'src/conflict.ts', 'base\n'); // same-region conflict
  commitAll(upB, 'v1');

  // QA repo = v1
  fs.mkdirSync(qaB, { recursive: true });
  git(qaB, ['init', '-q', '-b', 'main']);
  git(qaB, ['config', 'user.email', 'q@t.local']);
  git(qaB, ['config', 'user.name', 'Q']);
  git(qaB, ['remote', 'add', 'origin', upB]);
  git(qaB, ['fetch', '-q', 'origin', 'main']);
  git(qaB, ['reset', '-q', '--hard', 'FETCH_HEAD']);
  git(qaB, ['remote', 'remove', 'origin']);
  const baseSha = git(qaB, ['rev-parse', 'HEAD']).stdout.trim();
  // record the base (as a real upgrade would)
  writeUpgradeState(qaB, {
    schemaVersion: 1,
    upstream: upB,
    ref: 'main',
    syncedCommit: baseSha,
    syncedAt: new Date().toISOString(),
  });

  // QA edits x.ts region A, qakept.ts, and conflict.ts; leaves gone.ts alone.
  write(qaB, 'src/x.ts', 'QA-A\nl2\nl3\nl4\n');
  write(qaB, 'src/qakept.ts', 'QA owns this now\n');
  write(qaB, 'src/conflict.ts', 'QA-SIDE\n');
  commitAll(qaB, 'qa work');

  // upstream v2: edit x.ts region B, delete gone.ts + qakept.ts, edit conflict.ts same line.
  write(upB, 'src/x.ts', 'l1\nl2\nl3\nUP-B\n');
  fs.rmSync(path.join(upB, 'src/gone.ts'));
  fs.rmSync(path.join(upB, 'src/qakept.ts'));
  write(upB, 'src/conflict.ts', 'UP-SIDE\n');
  commitAll(upB, 'v2');

  check('three-way merge: QA region A + upstream region B both survive, no conflict', () => {
    const outcome = runUpgrade(qaB, { checkOnly: false, source: upB, ref: 'main' });
    const merged = read(qaB, 'src/x.ts');
    assert.ok(merged.includes('QA-A'), 'QA edit survives');
    assert.ok(merged.includes('UP-B'), 'upstream edit survives');
    assert.equal(outcome.nextAction, 'resolve-conflicts'); // conflict.ts conflicts
  });

  check('safe-delete removes an upstream-deleted file QA never touched', () => {
    assert.equal(fs.existsSync(path.join(qaB, 'src/gone.ts')), false);
    const staged = git(qaB, ['diff', '--cached', '--name-only']).stdout;
    assert.ok(staged.includes('src/gone.ts'), 'deletion is staged');
  });

  check('kept: upstream-deleted file that QA modified is NOT deleted', () => {
    assert.ok(fs.existsSync(path.join(qaB, 'src/qakept.ts')), 'QA-modified file kept');
    assert.equal(read(qaB, 'src/qakept.ts'), 'QA owns this now\n');
  });

  check('three-way conflict: markers written, file NOT staged', () => {
    const content = read(qaB, 'src/conflict.ts');
    assert.ok(content.includes('<<<<<<<'), 'conflict markers present');
    const staged = git(qaB, ['diff', '--cached', '--name-only']).stdout;
    assert.ok(!staged.includes('src/conflict.ts'), 'conflicted file is not staged');
  });

  check('base is recorded and reused on the next run', () => {
    const state = readUpgradeState(qaB);
    assert.ok(state, 'state written');
    assert.notEqual(state?.syncedCommit, baseSha, 'advanced to the new upstream head');
    const outcome = runUpgrade(qaB, { checkOnly: true, source: upB, ref: 'main' });
    assert.equal(outcome.base, state?.syncedCommit);
  });

  check('toJsonResult: one JSON object with the agent contract fields', () => {
    const outcome = runUpgrade(qaB, { checkOnly: true, source: upB, ref: 'main' });
    const json = toJsonResult(outcome);
    const round = JSON.parse(JSON.stringify(json));
    assert.ok(['ok', 'conflicts', 'blocked', 'up-to-date'].includes(round.status));
    assert.ok(Array.isArray(round.updated));
    assert.ok(Array.isArray(round.conflicts));
    assert.equal(typeof round.nextAction, 'string');
    assert.equal(typeof round.rollback, 'string');
    assert.equal(JSON.stringify(round).includes('\n'), false, 'single line');
  });
} finally {
  fs.rmSync(tmpB, { recursive: true, force: true });
}

// Binary guard: a file QA and upstream both change must NOT be truncated by
// `git merge-file` (which prints nothing for binary input). Regression: the
// first implementation wrote the empty stdout and wiped the file.
const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-upgrade-bin-'));
const upBin = path.join(tmpBin, 'upstream');
const qaBin = path.join(tmpBin, 'qa');

try {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00, 0xff]);
  fs.mkdirSync(path.join(upBin, 'tests', 'data'), { recursive: true });
  git(upBin, ['init', '-q', '-b', 'main']);
  git(upBin, ['config', 'user.email', 'm@t.local']);
  git(upBin, ['config', 'user.name', 'M']);
  fs.writeFileSync(path.join(upBin, 'package.json'), '{"name":"x","version":"1.0.0"}');
  fs.writeFileSync(path.join(upBin, 'tests/data/logo.png'), png);
  commitAll(upBin, 'v1');

  fs.mkdirSync(qaBin, { recursive: true });
  git(qaBin, ['init', '-q', '-b', 'main']);
  git(qaBin, ['config', 'user.email', 'q@t.local']);
  git(qaBin, ['config', 'user.name', 'Q']);
  git(qaBin, ['remote', 'add', 'origin', upBin]);
  git(qaBin, ['fetch', '-q', 'origin', 'main']);
  git(qaBin, ['reset', '-q', '--hard', 'FETCH_HEAD']);
  git(qaBin, ['remote', 'remove', 'origin']);
  const baseBin = git(qaBin, ['rev-parse', 'HEAD']).stdout.trim();
  writeUpgradeState(qaBin, {
    schemaVersion: 1,
    upstream: upBin,
    ref: 'main',
    syncedCommit: baseBin,
    syncedAt: new Date().toISOString(),
  });

  // QA edits the binary locally…
  const qaPng = Buffer.concat([png, Buffer.from([0xaa])]);
  fs.mkdirSync(path.join(qaBin, 'tests', 'data'), { recursive: true });
  fs.writeFileSync(path.join(qaBin, 'tests/data/logo.png'), qaPng);
  commitAll(qaBin, 'qa tweak png');
  // …and upstream edits it too.
  fs.writeFileSync(
    path.join(upBin, 'tests/data/logo.png'),
    Buffer.concat([png, Buffer.from([0xbb])]),
  );
  commitAll(upBin, 'v2 png');

  check('binary file edited on both sides is NOT truncated (no empty write)', () => {
    const outcome = runUpgrade(qaBin, { checkOnly: false, source: upBin, ref: 'main' });
    const after = fs.readFileSync(path.join(qaBin, 'tests/data/logo.png'));
    assert.ok(after.length > 0, 'file is not empty');
    assert.ok(after.equals(qaPng), 'QA bytes preserved verbatim');
    assert.ok(
      outcome.conflicts.some((c) => c.file === 'tests/data/logo.png' && c.kind === 'binary'),
      'reported as a binary conflict',
    );
    assert.ok(!git(qaBin, ['diff', '--cached', '--name-only']).stdout.includes('logo.png'));
  });
} finally {
  fs.rmSync(tmpBin, { recursive: true, force: true });
}

check('--json is accepted by the arg parser', () => {
  const opts = parseUpgradeArgs(['--json']);
  assert.equal(opts?.json, true);
  const plain = parseUpgradeArgs([]);
  assert.equal(plain?.json, false);
});

process.stdout.write(`\n${passed} checks passed\n`);
