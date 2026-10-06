/**
 * Standalone Node assert harness (not a Playwright test).
 * Run: npx tsx tools/scripts/__tests__/framework-upgrade.test.ts
 *
 * Covers the upgrade safety contract with REAL git repos in a temp dir:
 *   - framework-zone diff selection (QA files are never targets)
 *   - UNIVERSAL three-way merge: dirty worktree NEVER blocks; local edits are
 *     merged (committed or not), untracked collisions become add/add conflicts
 *   - safety snapshot: pre-apply checkpoint via custom refs, restorable, pruned
 *   - --commit: provenance commit on clean sync (never with conflicts)
 *   - committed base pointer (.upgrade-base.json) + legacy state precedence
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
import { readUpgradeBase, writeUpgradeBase, UPGRADE_BASE_FILE } from '../upgrade-base';
import { createUpgradeSnapshot, listSnapshotRefs, SNAPSHOT_KEEP } from '../upgrade-snapshot';
import {
  acquireUpgradeLock,
  checkCommitAllowed,
  readUpgradeLock,
  releaseUpgradeLock,
  UPGRADE_COMMIT_ENV,
  UPGRADE_LOCK_FILE,
  UpgradeLockError,
} from '../upgrade-commit-guard';
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

/** Build a QA repo that is a template copy of `upstream` at its current main. */
function makeQaClone(upstreamPath: string, qaPath: string): void {
  fs.mkdirSync(qaPath, { recursive: true });
  git(qaPath, ['init', '-q', '-b', 'main']);
  git(qaPath, ['config', 'user.email', 'q@t.local']);
  git(qaPath, ['config', 'user.name', 'Q']);
  git(qaPath, ['remote', 'add', 'origin', upstreamPath]);
  git(qaPath, ['fetch', '-q', 'origin', 'main']);
  git(qaPath, ['reset', '-q', '--hard', 'FETCH_HEAD']);
  git(qaPath, ['remote', 'remove', 'origin']);
  // The engine's dependency step runs `npm install` inside the QA repo. On
  // Linux CI that SUCCEEDS and creates untracked npm artifacts; on some dev
  // machines it fails fast (EALLOWSCRIPTS) and creates nothing. Ignore them so
  // worktree-cleanliness assertions and snapshots are OS-deterministic.
  write(qaPath, '.gitignore', 'node_modules/\npackage-lock.json\n');
}

/**
 * Worktree must be clean apart from npm's own side effects. The QA repos
 * gitignore `package-lock.json` / `node_modules` (see makeQaClone); this
 * filter is the second belt so an unknown npm artifact can never flip the
 * assertion on one OS but not another.
 */
function assertWorktreeCleanApartFromNpm(cwd: string): void {
  const dirt = parsePorcelain(git(cwd, ['status', '--porcelain']).stdout)
    .filter((e) => e.file !== 'package-lock.json' && !e.file.startsWith('node_modules'))
    .map((e) => `${e.status} ${e.file}`);
  assert.deepEqual(dirt, [], 'worktree clean apart from npm side effects');
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

check('packageVersion / firstChangelogSection / parseUpgradeArgs', () => {
  assert.equal(packageVersion('{"version":"1.2.3"}'), '1.2.3');
  assert.equal(packageVersion('not json'), null);
  assert.equal(
    firstChangelogSection('# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n'),
    '## [Unreleased]',
  );
  const options = parseUpgradeArgs([
    '--check',
    '--source',
    '/tmp/upstream',
    '--ref',
    'v1',
    '--commit',
  ]);
  assert.deepEqual(options, {
    checkOnly: true,
    source: '/tmp/upstream',
    ref: 'v1',
    json: false,
    commit: true,
  });
  assert.equal(parseUpgradeArgs([])?.checkOnly, false);
  assert.equal(parseUpgradeArgs([])?.commit, false);
  assert.equal(parseUpgradeArgs(['--help']), null);
  assert.throws(() => parseUpgradeArgs(['--bogus']), UpgradeError);
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

// ─── Committed base pointer (.upgrade-base.json) ─────────────────────────────

process.stdout.write('\ncommitted base pointer\n');

check('base file round-trips and tolerates a corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-basefile-'));
  try {
    assert.equal(readUpgradeBase(dir), null); // absent
    writeUpgradeBase(dir, {
      schemaVersion: 1,
      upstream: 'up',
      ref: 'main',
      syncedCommit: 'abc123',
      syncedAt: '2026-10-06T00:00:00.000Z',
    });
    const back = readUpgradeBase(dir);
    assert.equal(back?.syncedCommit, 'abc123');
    assert.equal(back?.ref, 'main');

    fs.writeFileSync(path.join(dir, UPGRADE_BASE_FILE), '{ not json', 'utf-8');
    assert.equal(readUpgradeBase(dir), null); // corrupt → null, never throws

    fs.writeFileSync(path.join(dir, UPGRADE_BASE_FILE), '{"schemaVersion":2}', 'utf-8');
    assert.equal(readUpgradeBase(dir), null); // wrong schema → null
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('resolveBase: committed base file > legacy per-machine state > null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-baseprec-'));
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'a@b.c']);
    git(dir, ['config', 'user.name', 't']);
    write(dir, 'a.txt', 'x\n');
    commitAll(dir, 'c1');
    const sha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();

    assert.equal(resolveBase(dir, null, null), null); // nothing recorded → null
    // Stale SHA (commit does not exist here) degrades to null, never throws.
    assert.equal(
      resolveBase(
        dir,
        { schemaVersion: 1, upstream: '', ref: '', syncedCommit: 'deadbeef', syncedAt: '' },
        null,
      ),
      null,
    );
    assert.equal(
      resolveBase(
        dir,
        { schemaVersion: 1, upstream: '', ref: '', syncedCommit: sha, syncedAt: '' },
        null,
      ),
      sha,
    );
    // Precedence: a stale base FILE falls through to a valid legacy state.
    assert.equal(
      resolveBase(
        dir,
        { schemaVersion: 1, upstream: '', ref: '', syncedCommit: 'deadbeef', syncedAt: '' },
        { schemaVersion: 1, upstream: '', ref: '', syncedCommit: sha, syncedAt: '' },
      ),
      sha,
    );
    // …and a valid base FILE beats a stale legacy state.
    assert.equal(
      resolveBase(
        dir,
        { schemaVersion: 1, upstream: '', ref: '', syncedCommit: sha, syncedAt: '' },
        { schemaVersion: 1, upstream: '', ref: '', syncedCommit: 'deadbeef', syncedAt: '' },
      ),
      sha,
    );
    assert.equal(commitExists(dir, sha), true);
    assert.equal(commitExists(dir, 'deadbeefdeadbeef'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Safety snapshot (non-destructive checkpoint) ────────────────────────────

process.stdout.write('\nsafety snapshot\n');

check('snapshot: null when clean; ref exists and restores dirty content when dirty; pruned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-snap-'));
  try {
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'a@b.c']);
    git(dir, ['config', 'user.name', 't']);
    write(dir, 'src/snap.txt', 'v1\n');
    commitAll(dir, 'c1');

    // Nothing dirty → no snapshot.
    assert.equal(createUpgradeSnapshot(dir, []), null);
    assert.equal(createUpgradeSnapshot(dir, ['src/snap.txt']), null); // worktree == HEAD

    // Dirty: tracked modification + an untracked file — BOTH must be captured.
    write(dir, 'src/snap.txt', 'v2 LOCAL\n');
    write(dir, 'src/untracked-snap.txt', 'untracked content\n');
    const snap = createUpgradeSnapshot(dir, ['src/snap.txt', 'src/untracked-snap.txt']);
    assert.ok(snap, 'dirty files produce a snapshot');
    assert.ok(listSnapshotRefs(dir).includes(snap.ref), 'ref is listed');

    // Restore the tracked file from the snapshot → back to the dirty content.
    git(dir, ['checkout', '--', 'src/snap.txt']); // revert to v1 first
    assert.equal(read(dir, 'src/snap.txt'), 'v1\n');
    git(dir, ['checkout', snap.commit, '--', 'src/snap.txt']);
    assert.equal(read(dir, 'src/snap.txt'), 'v2 LOCAL\n');
    // The untracked file is in the snapshot too.
    const shown = git(dir, ['show', `${snap.commit}:src/untracked-snap.txt`]);
    assert.equal(shown.stdout.replace(/\r\n/g, '\n'), 'untracked content\n');

    // Prune: more snapshots than KEEP → oldest refs deleted.
    for (let i = 0; i < SNAPSHOT_KEEP + 3; i += 1) {
      write(dir, 'src/snap.txt', `v2 LOCAL round ${i}\n`);
      createUpgradeSnapshot(dir, ['src/snap.txt']);
    }
    const remaining = listSnapshotRefs(dir).length;
    assert.ok(remaining > 0, 'at least the newest snapshot survives');
    assert.ok(remaining <= SNAPSHOT_KEEP, `pruned to <= ${SNAPSHOT_KEEP} (got ${remaining})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check(
  'findRiskyLocalFrameworkCommits (advisory): local customization flagged, synced upstream content not',
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

      makeQaClone(up, qa2);

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
  makeQaClone(upstream, qa);

  // QA owns a spec (tracked, upstream never has it) + a local env-like gitignored file.
  write(qa, 'tests/mine.spec.ts', 'export const mine = "qa-owned";\n');
  write(qa, '.gitignore', 'config/environments/*.env\nnode_modules/\npackage-lock.json\n');
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

  check('untracked file in the zone that upstream does NOT touch is left alone', () => {
    write(qa, 'src/local-probe.ts', 'local scratch\n');
    const outcome = runUpgrade(qa, { checkOnly: false, source: upstream, ref: 'main' });
    assert.ok(fs.existsSync(path.join(qa, 'src/local-probe.ts')), 'file survives');
    assert.equal(read(qa, 'src/local-probe.ts'), 'local scratch\n');
    assert.ok(!outcome.updated.includes('src/local-probe.ts'));
    assert.ok(!outcome.conflicts.some((c) => c.file === 'src/local-probe.ts'));
    // Clean up: drop the probe, the applied-but-staged v2, AND the base records
    // this apply wrote — later checks start base-less from the v1 worktree.
    fs.rmSync(path.join(qa, 'src/local-probe.ts'));
    fs.rmSync(path.join(qa, '.upgrade-state.json'), { force: true });
    fs.rmSync(path.join(qa, UPGRADE_BASE_FILE), { force: true });
    git(qa, ['reset', '-q', '--hard', 'HEAD']);
  });

  check('--check previews zone files only and touches nothing', () => {
    const beforeRefs = listSnapshotRefs(qa).length;
    const preview = runUpgrade(qa, { checkOnly: true, source: upstream, ref: 'main' });
    assert.ok(preview.updated.includes('src/x.ts'));
    assert.ok(preview.updated.includes('src/new.ts'));
    assert.ok(preview.updated.includes('docs/y.md'));
    assert.ok(preview.updated.includes('requirements/_TEMPLATE.md'));
    assert.ok(!preview.updated.includes('requirements/user-qa.md'));
    assert.equal(preview.fromVersion, '0.1.0');
    assert.equal(preview.toVersion, '0.1.0');
    assert.equal(preview.snapshot, null, '--check never snapshots');

    assert.equal(read(qa, 'src/x.ts'), 'export const x = "v1";\n');
    assertWorktreeCleanApartFromNpm(qa);
    assert.equal(listSnapshotRefs(qa).length, beforeRefs, '--check creates no snapshot refs');
  });

  check('--check still previews on a dirty worktree (no writes)', () => {
    write(qa, 'src/x.ts', 'export const x = "local edit";\n');
    const preview = runUpgrade(qa, { checkOnly: true, source: upstream, ref: 'main' });
    assert.ok(preview.updated.includes('src/x.ts'));
    // The local edit is still there — preview never writes.
    assert.equal(read(qa, 'src/x.ts'), 'export const x = "local edit";\n');
    git(qa, ['checkout', '--', 'src/x.ts']);
  });

  check(
    'apply stages framework files, deletes upstream-removed files, leaves QA files alone',
    () => {
      const diff = git(qa, [
        'diff',
        '--name-status',
        'HEAD',
        'FETCH_HEAD',
        '--',
        ...FRAMEWORK_PATHS,
      ]);
      const zone = computeZoneDiff(diff.stdout);
      const result = applyZoneDiff(qa, zone);

      assert.ok(result.applied.includes('src/x.ts'));
      assert.equal(read(qa, 'src/x.ts'), 'export const x = "v2";\n');
      assert.ok(fs.existsSync(path.join(qa, 'src/new.ts')));
      assert.equal(read(qa, 'docs/y.md'), '# y v2\n');
      assert.equal(read(qa, 'requirements/_TEMPLATE.md'), 'template v2\n');

      // Upstream removed docs/old.md; QA never touched it → safe-deleted + staged.
      // (docs/old.md IS in upstream history; QA's own .gitignore is NOT → kept.)
      assert.ok(zone.deleted.includes('docs/old.md'));
      assert.ok(
        !fs.existsSync(path.join(qa, 'docs/old.md')),
        'safe-deleted even without a recorded base',
      );
      assert.ok(
        result.kept.includes('.gitignore'),
        'QA-added file inside the zone is never safe-deleted',
      );
      assert.equal(
        read(qa, '.gitignore'),
        'config/environments/*.env\nnode_modules/\npackage-lock.json\n',
      );

      // QA-owned + gitignored files untouched.
      assert.equal(read(qa, 'tests/mine.spec.ts'), 'export const mine = "qa-owned";\n');
      assert.ok(!fs.existsSync(path.join(qa, 'requirements/user-qa.md')));
      assert.equal(read(qa, 'config/environments/local.env'), 'SECRET=qa-local\n');

      // Changes are STAGED, not committed.
      const staged = git(qa, ['diff', '--cached', '--name-only']).stdout;
      assert.ok(staged.includes('src/x.ts'));
      assert.equal(git(qa, ['log', '-1', '--format=%s']).stdout.trim(), 'qa spec');
    },
  );

  check('second apply run with staged results present proceeds (dirty never blocks)', () => {
    const outcome = runUpgrade(qa, { checkOnly: false, source: upstream, ref: 'main' });
    assert.ok(Array.isArray(outcome.updated));
    assert.equal(read(qa, 'src/x.ts'), 'export const x = "v2";\n', 'worktree intact');
  });

  check('after sync: committed base pointer is written and staged, legacy state too', () => {
    commitAll(qa, 'sync upstream v2');
    const baseRec = readUpgradeBase(qa);
    assert.ok(baseRec, '.upgrade-base.json written');
    assert.equal(baseRec?.syncedCommit, git(qa, ['rev-parse', 'FETCH_HEAD']).stdout.trim());
    const state = readUpgradeState(qa);
    assert.ok(state, '.upgrade-state.json (legacy cache) also written');
    // Tracked: git ls-files lists the committed pointer.
    assert.ok(git(qa, ['ls-files', UPGRADE_BASE_FILE]).stdout.includes(UPGRADE_BASE_FILE));
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

  check('up to date: after syncing everything, the next run reports no framework changes', () => {
    commitAll(qa, 'sync auth template');
    // The auth-template upstream commit has not been synced yet (base is one
    // commit behind) — sync it now, then a follow-up preview must be up-to-date.
    runUpgrade(qa, { checkOnly: false, source: upstream, ref: 'main' });
    const outcome = runUpgrade(qa, { checkOnly: true, source: upstream, ref: 'main' });
    assert.deepEqual(outcome.updated, []);
    assert.deepEqual(outcome.preserved, []);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─── Upgrade state (legacy per-machine cache) ────────────────────────────────

process.stdout.write('\nupgrade state (legacy cache)\n');

check('legacy state round-trips and tolerates a corrupt file', () => {
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

// ─── Integration: universal merge on a DIRTY worktree ────────────────────────

process.stdout.write('\nintegration: universal merge (dirty never blocks)\n');

const tmpDirty = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-upgrade-dirty-'));
const upDirty = path.join(tmpDirty, 'upstream');
const qaDirty = path.join(tmpDirty, 'qa');

try {
  // upstream v1
  fs.mkdirSync(upDirty, { recursive: true });
  git(upDirty, ['init', '-q', '-b', 'main']);
  git(upDirty, ['config', 'user.email', 'm@t.local']);
  git(upDirty, ['config', 'user.name', 'M']);
  write(upDirty, 'package.json', '{"name":"qa-playwright-kit","version":"0.1.0"}');
  write(upDirty, 'src/m.ts', 'l1\nl2\nl3\nl4\n'); // regions A (l1) and B (l4)
  commitAll(upDirty, 'v1');

  makeQaClone(upDirty, qaDirty);
  const dirtyBaseSha = git(qaDirty, ['rev-parse', 'HEAD']).stdout.trim();
  writeUpgradeBase(qaDirty, {
    schemaVersion: 1,
    upstream: upDirty,
    ref: 'main',
    syncedCommit: dirtyBaseSha,
    syncedAt: new Date().toISOString(),
  });

  // QA work-in-progress — UNCOMMITTED: edits m.ts region A and owns an untracked
  // file at a path upstream is about to ADD.
  write(qaDirty, 'src/m.ts', 'QA-A\nl2\nl3\nl4\n');
  write(qaDirty, 'src/add.ts', 'qa untracked add\n');

  // upstream v2: edit m.ts region B (disjoint) + add src/add.ts (collides).
  write(upDirty, 'src/m.ts', 'l1\nl2\nl3\nUP-B\n');
  write(upDirty, 'src/add.ts', 'upstream added\n');
  commitAll(upDirty, 'v2');

  check('uncommitted QA edit merges with the upstream edit — nothing blocks, both survive', () => {
    const outcome = runUpgrade(qaDirty, { checkOnly: false, source: upDirty, ref: 'main' });
    assert.ok(outcome.snapshot, 'dirty files were snapshotted before apply');
    const merged = read(qaDirty, 'src/m.ts');
    assert.ok(merged.includes('QA-A'), 'uncommitted QA edit survives');
    assert.ok(merged.includes('UP-B'), 'upstream edit survives');
    assert.ok(!merged.includes('<<<<<<<'), 'disjoint edits merge cleanly');
    const staged = git(qaDirty, ['diff', '--cached', '--name-only']).stdout;
    assert.ok(staged.includes('src/m.ts'), 'merged file is staged');
  });

  check(
    'untracked local file colliding with an upstream-added file → add/add conflict, no truncation',
    () => {
      assert.ok(
        !fs.existsSync(path.join(qaDirty, 'src/add.ts')) === false,
        'collision file still exists on disk',
      );
      const content = read(qaDirty, 'src/add.ts');
      assert.ok(content.includes('qa untracked add'), 'QA content preserved in markers');
      assert.ok(content.includes('upstream added'), 'upstream content preserved in markers');
      const staged = git(qaDirty, ['diff', '--cached', '--name-only']).stdout;
      assert.ok(!staged.includes('src/add.ts'), 'conflicted file is NOT staged');
    },
  );

  check('snapshot recorded for the dirty files and is restorable', () => {
    const ref = runUpgradeSnapshotOf(qaDirty);
    assert.ok(ref, 'snapshot ref exists for this repo');
    // The snapshot captured the PRE-merge content of the uncommitted edit.
    const shown = git(qaDirty, ['show', `${ref}:src/m.ts`]).stdout.replace(/\r\n/g, '\n');
    assert.ok(shown.includes('QA-A'), 'pre-merge QA content is in the snapshot');
    assert.ok(!shown.includes('UP-B'), 'snapshot predates the merge');
  });

  check('toJsonResult carries the new contract fields', () => {
    const outcome = runUpgrade(qaDirty, { checkOnly: true, source: upDirty, ref: 'main' });
    const json = toJsonResult(outcome);
    assert.equal(json.snapshot, null, 'checkOnly never snapshots');
    assert.equal(json.commit, null, 'no --commit requested');
    assert.ok(listSnapshotRefs(qaDirty).length > 0, 'apply-mode snapshot refs still exist');
    assert.equal(JSON.stringify(json).includes('\n'), false, 'single line');
  });
} finally {
  fs.rmSync(tmpDirty, { recursive: true, force: true });
}

/** Latest snapshot ref of a repo (null when none) — helper for the checks above. */
function runUpgradeSnapshotOf(repoRoot: string): string | null {
  const refs = listSnapshotRefs(repoRoot);
  return refs.length > 0 ? refs[0] : null;
}

// ─── Integration: --commit (auto-commit on clean sync, never with conflicts) ─

process.stdout.write('\nintegration: --commit\n');

const tmpCommit = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-upgrade-commit-'));
const upCommit = path.join(tmpCommit, 'upstream');
const qaCommit = path.join(tmpCommit, 'qa');

try {
  fs.mkdirSync(upCommit, { recursive: true });
  git(upCommit, ['init', '-q', '-b', 'main']);
  git(upCommit, ['config', 'user.email', 'm@t.local']);
  git(upCommit, ['config', 'user.name', 'M']);
  write(upCommit, 'package.json', '{"name":"qa-playwright-kit","version":"1.0.0"}');
  write(upCommit, 'src/c.ts', 'v1\n');
  commitAll(upCommit, 'v1');

  makeQaClone(upCommit, qaCommit);
  write(qaCommit, 'tests/qa.spec.ts', 'qa owns this\n');
  commitAll(qaCommit, 'qa spec');

  // Clean sync WITH --commit: durable immediately.
  write(upCommit, 'src/c.ts', 'v2\n');
  commitAll(upCommit, 'v2');

  check('--commit on a clean sync creates the provenance commit (base + trailer)', () => {
    const outcome = runUpgrade(qaCommit, {
      checkOnly: false,
      source: upCommit,
      ref: 'main',
      commit: true,
    });
    assert.ok(outcome.commit, 'commit SHA returned');
    assert.equal(outcome.nextAction, 'nothing');
    const subject = git(qaCommit, ['log', '-1', '--format=%s']).stdout.trim();
    assert.equal(subject, 'chore: sync framework zone');
    const body = git(qaCommit, ['log', '-1', '--format=%B']).stdout;
    const head12 = outcome.syncedCommit?.slice(0, 12) ?? '';
    assert.ok(body.includes(`Upstream-Sync: ${head12}`), 'provenance trailer present');
    // The committed base pointer is part of the commit.
    assert.ok(
      git(qaCommit, ['ls-files', UPGRADE_BASE_FILE]).stdout.includes(UPGRADE_BASE_FILE),
      '.upgrade-base.json is tracked',
    );
    const baseRec = readUpgradeBase(qaCommit);
    assert.equal(baseRec?.syncedCommit, outcome.syncedCommit);
    // Nothing left staged: the sync is durable.
    assert.equal(git(qaCommit, ['diff', '--cached', '--name-only']).stdout.trim(), '');
    // QA files untouched by the commit.
    assert.equal(read(qaCommit, 'tests/qa.spec.ts'), 'qa owns this\n');
  });

  check('--commit is IGNORED when conflicts exist (never auto-commit a broken sync)', () => {
    const headBefore = git(qaCommit, ['rev-parse', 'HEAD']).stdout.trim();
    // QA edits the same line upstream is about to change — uncommitted.
    write(qaCommit, 'src/c.ts', 'QA-C\n');
    write(upCommit, 'src/c.ts', 'v3\n');
    commitAll(upCommit, 'v3');

    const outcome = runUpgrade(qaCommit, {
      checkOnly: false,
      source: upCommit,
      ref: 'main',
      commit: true,
    });
    assert.ok(outcome.conflicts.length > 0, 'conflict reported');
    assert.equal(outcome.commit, null, 'no commit created');
    assert.equal(outcome.nextAction, 'resolve-conflicts');
    assert.equal(
      git(qaCommit, ['rev-parse', 'HEAD']).stdout.trim(),
      headBefore,
      'HEAD did not move',
    );
    assert.ok(read(qaCommit, 'src/c.ts').includes('<<<<<<<'), 'markers on disk for resolution');
  });
} finally {
  fs.rmSync(tmpCommit, { recursive: true, force: true });
}

// ─── Integration: marker-aware preserve (uncommitted, never blocks) ──────────

process.stdout.write('\nmarker-aware preserve\n');

check('marker-bearing auth.setup.ts is preserved by runUpgrade even when uncommitted', () => {
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

    makeQaClone(up, qa3);

    // Upstream changes the template; QA customizes locally WITH the marker, uncommitted.
    write(up, GENERATED_AUTH_SETUP, 'generated v2\n');
    commitAll(up, 'v2');
    write(qa3, GENERATED_AUTH_SETUP, '// CUSTOM_AUTH_FLOW\ngenerated v1 + QA steps\n');

    // Upgrade proceeds; apply preserves the QA file.
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

// ─── Integration: base-aware apply + safe-delete ─────────────────────────────

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

  makeQaClone(upB, qaB);
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

  check('base is recorded (committed pointer + legacy state) and reused on the next run', () => {
    const state = readUpgradeState(qaB);
    assert.ok(state, 'state written');
    assert.notEqual(state?.syncedCommit, baseSha, 'advanced to the new upstream head');
    const baseRec = readUpgradeBase(qaB);
    assert.ok(baseRec, 'committed pointer written');
    assert.equal(baseRec?.syncedCommit, state?.syncedCommit, 'both records agree');
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
    assert.ok('snapshot' in round, 'snapshot field present');
    assert.ok('commit' in round, 'commit field present');
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

  makeQaClone(upBin, qaBin);
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

// ─── Commit guard (mechanical enforcement) ───────────────────────────────────

process.stdout.write('\ncommit guard\n');

check(
  'commit guard: allow unlocked, deny live lock, allow tool env, stale lock auto-clears',
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-guardlock-'));
    try {
      git(dir, ['init', '-q', '-b', 'main']);
      git(dir, ['config', 'user.email', 'a@b.c']);
      git(dir, ['config', 'user.name', 't']);
      write(dir, 'a.txt', 'x\n');
      commitAll(dir, 'c1');

      assert.equal(checkCommitAllowed(dir), 'allow', 'no lock → allow');

      acquireUpgradeLock(dir);
      assert.equal(checkCommitAllowed(dir), 'deny', 'live lock → deny');
      assert.equal(
        checkCommitAllowed(dir, { [UPGRADE_COMMIT_ENV]: '1' }),
        'allow',
        "the upgrade tool's own --commit passes",
      );
      assert.throws(() => acquireUpgradeLock(dir), UpgradeLockError, 'no second holder');
      releaseUpgradeLock(dir);
      assert.equal(readUpgradeLock(dir), null, 'released');

      // Stale lock: pid that can never exist → auto-cleared, allow.
      fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, UPGRADE_LOCK_FILE),
        JSON.stringify({ pid: 2147483000, startedAt: '2020-01-01T00:00:00.000Z' }),
      );
      assert.equal(checkCommitAllowed(dir), 'stale-cleared');
      assert.equal(readUpgradeLock(dir), null, 'stale lock removed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

check('runUpgrade apply mode releases the lock when it finishes', () => {
  const tmpLock = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-lockrun-'));
  const up = path.join(tmpLock, 'up');
  const qa = path.join(tmpLock, 'qa');
  try {
    fs.mkdirSync(up, { recursive: true });
    git(up, ['init', '-q', '-b', 'main']);
    git(up, ['config', 'user.email', 'm@t.local']);
    git(up, ['config', 'user.name', 'M']);
    write(up, 'package.json', '{"name":"x","version":"1.0.0"}');
    write(up, 'src/a.ts', 'v1\n');
    commitAll(up, 'v1');
    makeQaClone(up, qa);

    runUpgrade(qa, { checkOnly: false, source: up, ref: 'main' }); // up-to-date
    assert.equal(readUpgradeLock(qa), null, 'lock released after the run');
  } finally {
    fs.rmSync(tmpLock, { recursive: true, force: true });
  }
});

check('--json and --commit are accepted by the arg parser', () => {
  const opts = parseUpgradeArgs(['--json', '--commit']);
  assert.equal(opts?.json, true);
  assert.equal(opts?.commit, true);
  const plain = parseUpgradeArgs([]);
  assert.equal(plain?.json, false);
  assert.equal(plain?.commit, false);
});

process.stdout.write(`\n${passed} checks passed\n`);
