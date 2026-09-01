#!/usr/bin/env npx tsx
/**
 * Archive CLI — save, view, compare, and delete archived test runs.
 *
 * Usage:
 *   npm run archive:save                                # Interactive
 *   npm run archive:save -- --decision=APPROVE          # Non-interactive
 *   npm run archive:save -- --decision=APPROVE --yes    # Skip confirm
 *   npm run archive:view                                # List all
 *   npm run archive:view -- --run=run-20260730-125523   # Detail
 *   npm run archive:view -- --run=run-20260730-125523 --verbose  # Full test cases
 *   npm run archive:compare                             # Latest vs previous
 *   npm run archive:compare -- --baseline=<id> --current=<id>  # Explicit runs
 *
 * @module src/cli/archive-cli
 */

import * as path from 'node:path';
import * as readline from 'node:readline';
import { applyArtifactRetention } from '../shared/evidence/retention';
import {
  saveLatestRun,
  listArchivedRunIds,
  loadArchivedSummary,
  loadArchivedMetadata,
  deleteArchivedReport,
  getLatestRunInfo,
  isLatestRunArchived,
  getArchiveDir,
  type QaDecision,
} from '../agents/reporter/report-archive';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_DECISIONS: QaDecision[] = [
  'APPROVE',
  'FILE_BUG',
  'REVISE_REQUIREMENT',
  'FIX_TEST',
  'FIX_ENV',
  'MARK_BLOCKED',
];

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    // Support both --key=value and --key value
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const key = arg.slice(2, eqIdx);
      result[key] = arg.slice(eqIdx + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      i++;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  } catch {
    return iso;
  }
}

// ─── Save Command ────────────────────────────────────────────────────────────

async function saveCommand(args: Record<string, string | boolean>): Promise<void> {
  // Check if there's a latest run to save
  const latestRun = getLatestRunInfo();
  if (!latestRun) {
    console.error('❌ No test run found. Run tests first with: npm run test');
    process.exit(1);
  }

  // Check if already archived
  if (isLatestRunArchived()) {
    console.log('ℹ️  This run has already been saved to history.');
    process.exit(0);
  }

  // Display latest run info
  console.log('\n📊 Latest test run:');
  console.log(`   Ran at:    ${formatTimestamp(latestRun.timestamp)}`);
  console.log(`   Total:     ${latestRun.total}`);
  console.log(`   Passed:    ${latestRun.passed} ✅`);
  console.log(`   Failed:    ${latestRun.failed} ${latestRun.failed > 0 ? '❌' : ''}`);
  console.log(`   Skipped:   ${latestRun.skipped} ⏭️`);
  console.log(`   Pass Rate: ${latestRun.passRate}%`);
  console.log(`   Mode:      ${latestRun.reportMode}`);

  // Parse decision and metadata from args
  let decision = args.decision as string | undefined;
  let notes = args.notes as string | undefined;
  const label = args.label as string | undefined;
  const series = args.series as string | undefined;
  const requirementId = args['requirement-id'] as string | undefined;
  const requirementTitle = args['requirement-title'] as string | undefined;
  const yes = args.yes === true;

  // Interactive mode
  if (!decision) {
    const answer = await askQuestion('\n💾 Save this run to history? (y/N): ');
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('Cancelled. Run not saved.');
      process.exit(0);
    }

    console.log(`\n   QA Decision options: ${VALID_DECISIONS.join(' | ')}`);
    const decisionInput = await askQuestion('   Decision: ');
    if (!VALID_DECISIONS.includes(decisionInput as QaDecision)) {
      console.error(
        `❌ Invalid decision: ${decisionInput}. Must be one of: ${VALID_DECISIONS.join(', ')}`,
      );
      process.exit(1);
    }
    decision = decisionInput;
  }

  // Validate decision
  if (!VALID_DECISIONS.includes(decision as QaDecision)) {
    console.error(
      `❌ Invalid decision: ${decision}. Must be one of: ${VALID_DECISIONS.join(', ')}`,
    );
    process.exit(1);
  }

  // Notes — skip prompt when --yes (non-interactive / CI)
  if (notes === undefined) {
    if (yes) {
      notes = '';
    } else {
      notes = (await askQuestion('   Notes (optional): ')) || '';
    }
  }

  // Confirm — skip when --yes
  if (!yes) {
    console.log(`\n   Decision: ${decision}`);
    if (label) console.log(`   Label:    ${label}`);
    if (series) console.log(`   Series:   ${series}`);
    console.log(`   Notes:    ${notes || '(none)'}`);
    const confirm = await askQuestion('   Confirm save? (y/N): ');
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log('Cancelled. Run not saved.');
      process.exit(0);
    }
  }

  // Save
  try {
    const result = saveLatestRun({
      qaDecision: decision as QaDecision,
      qaNotes: notes,
      displayName: label,
      testSeriesId: series,
      requirementId,
      requirementTitle,
      triggerSource: 'cli',
    });
    console.log(`\n✅ Run saved to history!`);
    console.log(`   Run ID:  ${result.runId}`);
    console.log(`   Archive: ${path.relative(process.cwd(), result.archivePath)}`);
  } catch (err) {
    console.error(`❌ Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── View Command ────────────────────────────────────────────────────────────

async function viewCommand(args: Record<string, string | boolean>): Promise<void> {
  const runId = args.run as string | undefined;
  const verbose = args.verbose === true;

  // List mode
  if (!runId) {
    const runIds = listArchivedRunIds();
    if (runIds.length === 0) {
      console.log('No archived runs found. Save a run with: npm run archive:save');
      return;
    }

    console.log(`\n📋 Archived Runs (${runIds.length} total):\n`);
    console.log(
      '  Testing Label / Run ID                  Saved At              Decision    Pass%   Tests',
    );
    console.log(
      '  ─────────────────────────────────────── ───────────────────── ─────────── ─────── ──────',
    );

    for (const id of runIds) {
      const metadata = loadArchivedMetadata(id);
      const summary = loadArchivedSummary(id);
      const savedAt = metadata ? formatTimestamp(metadata.savedAt) : '—';
      const decision = metadata?.qaDecision ?? '—';
      const total = (summary?.total as number) ?? '?';
      const passed = (summary?.passed as number) ?? -1;
      const failed = (summary?.failed as number) ?? -1;
      const passRate = (summary?.passRate as number) ?? -1;
      const statusIcon = failed === 0 ? '✅' : failed < 0 ? '❓' : '⚠️';
      const labelOrId = (metadata?.displayName || id).slice(0, 39);

      console.log(
        `  ${labelOrId.padEnd(39)} ${savedAt.padEnd(21)} ${decision.padEnd(11)} ${String(passRate).padStart(5)}%   ${String(total).padStart(2)} (${passed}✅ ${failed}❌) ${statusIcon}`,
      );
      if (metadata?.displayName && metadata.displayName !== id) {
        console.log(`    ↳ ${id} (${metadata.testSeriesId || 'default-series'})`);
      }
    }
    console.log('');
    return;
  }

  // Detail mode
  const summary = loadArchivedSummary(runId);
  const metadata = loadArchivedMetadata(runId);

  if (!summary && !metadata) {
    console.error(`❌ Run not found: ${runId}`);
    process.exit(1);
  }

  console.log(`\n📋 Run Detail: ${runId}`);
  console.log('─'.repeat(60));

  if (metadata) {
    if (metadata.displayName) {
      console.log(`  Label:      ${metadata.displayName}`);
    }
    if (metadata.testSeriesId) {
      console.log(`  Series:     ${metadata.testSeriesId}`);
    }
    console.log(`  Ran at:     ${formatTimestamp(metadata.ranAt)}`);
    console.log(`  Saved at:   ${formatTimestamp(metadata.savedAt)}`);
    console.log(`  Decision:   ${metadata.qaDecision}`);
    console.log(`  Notes:      ${metadata.qaNotes || '(none)'}`);
    console.log(
      `  Env:        ${metadata.appEnv}${metadata.baseUrl ? ` / ${metadata.baseUrl}` : ''}`,
    );
    console.log(`  Mode:       ${metadata.reportMode ?? '—'}`);
    if (metadata.requirementPath) {
      console.log(`  Requirement:${metadata.requirementPath}`);
    }
  }

  if (summary) {
    console.log('\n  Summary:');
    console.log(
      `    Total: ${summary.total} | Passed: ${summary.passed} ✅ | Failed: ${summary.failed} ❌ | Skipped: ${summary.skipped} ⏭️`,
    );
    console.log(`    Pass Rate: ${summary.passRate}%`);
    console.log(`    Mode: ${summary.reportMode ?? '—'}`);

    if (summary.rolesInScope) {
      console.log(`    Roles: ${(summary.rolesInScope as string[]).join(', ')}`);
    }

    const summaryByRole = summary.summaryByRole as
      Record<string, { passing: number; failing: number; skipped: number }> | undefined;
    if (summaryByRole && Object.keys(summaryByRole).length > 0) {
      console.log('\n  By Role:');
      for (const [role, data] of Object.entries(summaryByRole)) {
        console.log(`    ${role}: ${data.passing}✅ ${data.failing}❌ ${data.skipped}⏭️`);
      }
    }

    const summaryByModule = summary.summaryByModule as
      | Record<string, { features: Record<string, { passing: number; failing: number }> }>
      | undefined;
    if (summaryByModule && Object.keys(summaryByModule).length > 0) {
      console.log('\n  By Module:');
      for (const [mod, data] of Object.entries(summaryByModule)) {
        const features = Object.entries(data.features);
        if (features.length > 0) {
          console.log(`    ${mod}:`);
          for (const [feat, fdata] of features) {
            console.log(`      ${feat}: ${fdata.passing}✅ ${fdata.failing}❌`);
          }
        }
      }
    }
  }

  // Test cases (verbose mode)
  const testCases = Array.isArray(summary?.testCases)
    ? (summary?.testCases as Array<Record<string, unknown>>)
    : [];
  if (verbose && testCases.length > 0) {
    console.log('\n  Test Cases:');
    for (const sc of testCases) {
      const status = (sc.status as string) || 'skipped';
      const icon = status === 'passed' ? '✅' : status === 'failed' ? '❌' : '⏭️';
      const duration = sc.duration ? ` (${sc.duration}ms)` : '';
      const scId = (sc.testId as string) || (sc.scenarioId as string) || '-';
      const title = (sc.title as string) || (sc.name as string) || '';
      console.log(`    ${icon} ${scId} — ${title}${duration}`);
      if (sc.errorMessage) {
        console.log(`       Error: ${sc.errorMessage}`);
      }
    }
  }

  // Unresolved failures
  const unresolved = Array.isArray(summary?.unresolvedFailures)
    ? (summary?.unresolvedFailures as Array<Record<string, unknown>>)
    : [];
  if (unresolved.length > 0) {
    console.log('\n  Unresolved Failures:');
    for (const f of unresolved) {
      console.log(`    ❌ ${f['scenarioId'] || '-'} (${f['failureSource'] || 'unknown'})`);
      console.log(`       ${f['errorMessage'] || ''}`);
      if (f['screenshotPath']) {
        console.log(`       Screenshot: ${f['screenshotPath']}`);
      }
      if (f['tracePath']) {
        console.log(`       Trace: ${f['tracePath']}`);
      }
    }
  }

  console.log('');
}

// ─── Delete Command ──────────────────────────────────────────────────────────

async function deleteCommand(args: Record<string, string | boolean>): Promise<void> {
  const runId = args.run as string | undefined;
  const yes = args.yes === true;

  if (!runId) {
    console.error('❌ Provide --run=<runId> to delete.');
    process.exit(1);
  }

  if (!yes) {
    const answer = await askQuestion(`⚠️  Delete archive ${runId}? This cannot be undone. (y/N): `);
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  const deleted = deleteArchivedReport(runId);
  if (deleted) {
    console.log(`✅ Deleted archive: ${runId}`);
  } else {
    console.error(`❌ Run not found: ${runId}`);
    process.exit(1);
  }
}

// ─── Compare Command ──────────────────────────────────────────────────────────

async function compareCommand(args: Record<string, string | boolean>): Promise<void> {
  const { compareLatestVsPrevious, compareReports, generateComparisonSummary } =
    await import('../agents/reporter/report-compare');

  const baseline = args['baseline'] as string | undefined;
  const current = args['current'] as string | undefined;

  let result;
  if (baseline && current) {
    console.log(`\nComparing ${baseline} → ${current}…\n`);
    result = compareReports(baseline, current);
  } else {
    console.log('\nComparing latest vs previous archived run…\n');
    result = compareLatestVsPrevious();
  }

  if ('error' in result) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }

  console.log(generateComparisonSummary(result));
  console.log(`\n  Baseline:   ${result.baselineRunId}  (${result.baselinePassRate}% pass)`);
  console.log(`  Comparison: ${result.comparisonRunId}  (${result.comparisonPassRate}% pass)`);
  const delta = result.passRateDelta;
  const deltaStr = delta > 0 ? `+${delta}%` : `${delta}%`;
  const deltaIcon = delta > 0 ? '📈' : delta < 0 ? '📉' : '➡️';
  console.log(`  Delta:      ${deltaIcon} ${deltaStr}\n`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

// Only dispatch when executed directly (not when imported by tests).
async function cleanCommand(args: Record<string, string | boolean>): Promise<void> {
  const daysStr = (args['days'] as string) ?? (args['max-age-days'] as string) ?? '30';
  const days = parseInt(daysStr, 10);
  if (isNaN(days) || days < 1) {
    console.error('❌ Invalid --days argument. Must be a positive integer.');
    process.exit(1);
  }

  const archiveDirectory = getArchiveDir();
  console.log(`\n🧹 Cleaning archives older than ${days} days in: ${archiveDirectory}`);

  const result = applyArtifactRetention(archiveDirectory, { maxAgeDays: days });
  const freedMb = (result.freedBytes / (1024 * 1024)).toFixed(2);

  console.log(`✅ Cleanup completed:`);
  console.log(`   - Deleted files/directories: ${result.deletedFiles.length}`);
  console.log(`   - Retained items: ${result.retainedCount}`);
  console.log(`   - Freed disk space: ${freedMb} MB\n`);
}

// tsx runs this as CJS (package.json has no "type":"module"), so the
// require.main check works; avoid import.meta (breaks CJS test transpile).
const isMain = typeof require !== 'undefined' && require.main === module;
if (isMain) {
  const args = parseArgs(process.argv);
  const command = process.argv[2]?.startsWith('--') ? null : process.argv[2];

  switch (command) {
    case 'save':
      saveCommand(args).catch((err) => {
        console.error(err);
        process.exit(1);
      });
      break;
    case 'view':
      viewCommand(args).catch((err) => {
        console.error(err);
        process.exit(1);
      });
      break;
    case 'delete':
      deleteCommand(args).catch((err) => {
        console.error(err);
        process.exit(1);
      });
      break;
    case 'compare':
      compareCommand(args).catch((err) => {
        console.error(err);
        process.exit(1);
      });
      break;
    case 'clean':
      cleanCommand(args).catch((err) => {
        console.error(err);
        process.exit(1);
      });
      break;
    default:
      console.log(`
archive-cli — Save, view, compare, clean, and delete archived test runs

Usage:
  npm run archive:save                                # Interactive save
  npm run archive:save -- --decision=APPROVE          # Non-interactive
  npm run archive:save -- --decision=APPROVE --yes    # Skip confirm
  npm run archive:save -- --decision=APPROVE --notes="Clean run"
  npm run archive:view                                # List all saved runs
  npm run archive:view -- --run=<runId>               # View run detail
  npm run archive:view -- --run=<runId> --verbose     # Full test cases
  npm run archive:delete -- --run=<runId>             # Delete archive
  npm run archive:clean -- --days=30                  # Prune archives older than N days
  npm run archive:compare                             # Latest vs previous
  npm run archive:compare -- --baseline=<id> --current=<id>  # Explicit runs

QA Decisions:
  APPROVE | FILE_BUG | REVISE_REQUIREMENT | FIX_TEST | FIX_ENV | MARK_BLOCKED
`);
  }
}
