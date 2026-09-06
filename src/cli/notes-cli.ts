#!/usr/bin/env npx tsx
/**
 * Test Notes CLI — set/list per-test QA notes in the report notes sidecar.
 *
 * Complements the dashboard editor (serve mode) for static/file:// workflows.
 *
 * Usage:
 *   npm run note:set -- --scenario=SC-03 --note="Butuh seed data invoice X"
 *   npm run note:set -- --scenario=SC-03 --role=finance --note="..."
 *   npm run note:set -- --test-id=TC-LOGIN-001 --note="..." --run=run-20260905-165649-530
 *   npm run note:set -- --scenario=SC-03 --note=""        # clear the note
 *   npm run note:list                                     # latest run
 *   npm run note:list -- --run=run-20260905-165649-530    # archived run
 *
 * @module src/cli/notes-cli
 */

import { getLatestRunInfo } from '../agents/reporter/report-archive';
import { resolveCurrentRunIdentity } from '../agents/reporter/run-context';
import {
  testNoteKey,
  upsertArchivedTestNote,
  upsertLatestTestNote,
  loadLatestTestNotes,
  loadArchivedTestNotes,
  latestTestNotesPath,
  isValidRunIdFormat,
  MAX_TEST_NOTE_LENGTH,
} from '../agents/reporter/test-notes';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      result[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
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

function setCommand(args: Record<string, string | boolean>): void {
  const scenarioId = typeof args.scenario === 'string' ? args.scenario : '';
  const testId = typeof args['test-id'] === 'string' ? args['test-id'] : '';
  const role = typeof args.role === 'string' ? args.role : '';
  const run = typeof args.run === 'string' ? args.run : '';
  const note = typeof args.note === 'string' ? args.note : undefined;

  if (!scenarioId && !testId) {
    console.error('❌ --scenario (preferred) or --test-id is required to identify the test row.');
    process.exit(1);
  }
  if (note === undefined) {
    console.error('❌ --note is required (use --note="" to clear the note).');
    process.exit(1);
  }
  if (note.length > MAX_TEST_NOTE_LENGTH) {
    console.error(`❌ --note exceeds the maximum of ${MAX_TEST_NOTE_LENGTH} characters.`);
    process.exit(1);
  }

  let key: string;
  try {
    key = testNoteKey(scenarioId, testId, role);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  try {
    if (run) {
      if (!isValidRunIdFormat(run)) {
        console.error(`❌ Invalid runId "${run}". Expected pattern run-YYYYMMDD-HHmmss-SSS.`);
        process.exit(1);
      }
      upsertArchivedTestNote(run, key, { qaNotes: note });
      console.log(`✅ QA note set for ${key} in archived run ${run}.`);
      return;
    }

    // Stamp the latest sidecar with the current run identity — pending
    // pipeline run first, then the latest summary (same resolver as MCP).
    const runId = resolveCurrentRunIdentity()?.runId ?? undefined;
    upsertLatestTestNote(key, { qaNotes: note }, { runId });
    console.log(`✅ QA note set for ${key} in ${latestTestNotesPath()}.`);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function listCommand(args: Record<string, string | boolean>): void {
  const run = typeof args.run === 'string' ? args.run : '';
  const notes = run ? loadArchivedTestNotes(run) : loadLatestTestNotes();
  const keys = Object.keys(notes.notes).sort();

  if (!run) console.log('📝 Latest run notes (artifacts/reports/test-notes.json):');
  else console.log(`📝 Notes for archived run ${run}:`);

  if (keys.length === 0) {
    console.log('   (empty — no per-test notes recorded)');
    return;
  }
  for (const key of keys) {
    const entry = notes.notes[key]!;
    console.log(`\n   ${key}`);
    if (entry.qaNotes.trim()) console.log(`     QA: ${entry.qaNotes.replace(/\n/g, ' | ')}`);
    if (entry.aiNotes.trim()) console.log(`     AI: ${entry.aiNotes.replace(/\n/g, ' | ')}`);
  }
  console.log('');
}

const [command] = process.argv.slice(2);
const args = parseArgs(process.argv);

if (command === 'set') setCommand(args);
else if (command === 'list') listCommand(args);
else {
  console.log('Usage:');
  console.log('  npm run note:set -- --scenario=SC-03 --note="..." [--role=...] [--run=run-...]');
  console.log('  npm run note:list [--run=run-...]');
  process.exit(command ? 1 : 0);
}
