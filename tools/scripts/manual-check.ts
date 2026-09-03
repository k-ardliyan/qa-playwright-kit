/// <reference types="node" />

/**
 * manual-check — list semua skenario (@manual) dari semua requirement files.
 *
 * Usage:
 *   npm run manual:check
 *   npm run manual:check -- --req-id REQ-AUTH-001
 *
 * Output: grouped by requirement file, dengan status done/pending
 * (status saat ini selalu 'pending' sampai dashboard interaktif tersedia).
 *
 * @module scripts/manual-check
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EXIT } from './exit-codes';
import { friendly, printOk, printInfo, printWarn, withFriendlyErrors } from './format-error';

const REPO_MARKERS = ['config/qa-kit.workspace.json', 'tools/mcp', 'package.json'];
const MAX_HOPS = 12;

function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  for (let i = 0; i < MAX_HOPS; i++) {
    if (REPO_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ManualScenario {
  scenarioId: string;
  title: string;
  reason: string;
  lineNumber: number;
}

interface RequirementManual {
  reqId: string;
  filePath: string;
  scenarios: ManualScenario[];
}

interface CliArgs {
  reqId: string | null;
  jsonOutput: boolean;
}

// ─── File collector ───────────────────────────────────────────────────────────

/**
 * Recursively collect all .md files under a directory, excluding files whose
 * basename starts with '_' (templates) or is README.md (any depth).
 */
function collectRequirementFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRequirementFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.md') &&
      !entry.name.startsWith('_') &&
      entry.name.toLowerCase() !== 'readme.md'
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { reqId: null, jsonOutput: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.jsonOutput = true;
    else if (arg === '--req-id' && argv[i + 1]) {
      args.reqId = argv[++i];
    }
  }
  return args;
}

/**
 * Parse satu requirement file dan extract semua scenario (@manual).
 */
function parseRequirementFile(filePath: string): RequirementManual | null {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/\r/g, '');
  const lines = content.split('\n');

  // Find REQ ID dari judul (line 1 atau baris pertama non-empty)
  let reqId = '';
  for (const line of lines) {
    const m = line.match(/^#\s*(REQ-[A-Z0-9-]+):/);
    if (m) {
      reqId = m[1];
      break;
    }
  }
  if (!reqId) return null;

  const scenarios: ManualScenario[] = [];
  let currentScenario: { scenarioId: string; title: string; lineNumber: number } | null = null;
  let currentHasilLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect scenario heading: ### SC-XX: Title (@manual)
    const headingMatch = line.match(/^###\s+(SC-\d+):\s+(.+)$/);
    if (headingMatch) {
      // Save previous scenario if it was @manual
      if (currentScenario && currentScenario.title.includes('(@manual)')) {
        scenarios.push({
          scenarioId: currentScenario.scenarioId,
          title: currentScenario.title,
          lineNumber: currentScenario.lineNumber,
          reason: extractReason(currentHasilLines),
        });
      }
      const id = (headingMatch[1] ?? '').trim();
      const rawTitle = (headingMatch[2] ?? '').trim();
      const isManual = /\(@manual\)/.test(rawTitle);
      if (id && isManual) {
        currentScenario = { scenarioId: id, title: rawTitle, lineNumber: i + 1 };
      } else {
        currentScenario = null;
      }
      currentHasilLines = [];
      continue;
    }

    // Collect Hasil content for reason extraction
    // Label yang dikenali: `**Hasil:**` (legacy) dan `**Hasil yang Diharapkan:**` (template saat ini)
    if (currentScenario && /^\*\*(Hasil|Hasil yang Diharapkan):\*\*/.test(line)) {
      currentHasilLines = [];
    } else if (currentScenario && currentHasilLines !== null && line.trim()) {
      currentHasilLines.push(line);
    }

    // End of Hasil section: next ### or ##
    if (currentScenario && /^##\s+/.test(line)) {
      if (currentScenario.title) {
        scenarios.push({
          scenarioId: currentScenario.scenarioId,
          title: currentScenario.title,
          lineNumber: currentScenario.lineNumber,
          reason: extractReason(currentHasilLines),
        });
      }
      currentScenario = null;
      currentHasilLines = [];
    }
  }

  // Handle last scenario
  if (currentScenario && currentScenario.title) {
    scenarios.push({
      scenarioId: currentScenario.scenarioId,
      title: currentScenario.title,
      lineNumber: currentScenario.lineNumber,
      reason: extractReason(currentHasilLines),
    });
  }

  if (scenarios.length === 0) return null;

  return {
    reqId,
    filePath: path.relative(findRepoRoot(__dirname), filePath).replace(/\\/g, '/'),
    scenarios,
  };
}

/**
 * Extract reason dari Hasil section — biasanya ada di baris yang menyebut
 * "verifikasi manual", "butuh", "tidak bisa di-automate", dll.
 */
function extractReason(hasilLines: string[]): string {
  const keywords = [
    'verifikasi manual',
    'manual diperlukan',
    'tidak bisa di-automate',
    'butuh otp',
    'butuh captcha',
    'butuh email',
    'butuh akses',
    'butuh kartu',
    'butuh hp',
    'butuh perangkat',
    'tidak bisa diotomatisasi',
  ];
  for (const line of hasilLines) {
    const lower = line.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return line
          .replace(/^[-*]\s*/, '')
          .trim()
          .slice(0, 120);
      }
    }
  }
  // Fallback: ambil baris non-empty pertama
  const firstNonEmpty = hasilLines.find((l) => l.trim() && !/^[-*]\s*$/.test(l));
  return firstNonEmpty
    ? firstNonEmpty
        .replace(/^[-*]\s*/, '')
        .trim()
        .slice(0, 120)
    : '(tidak ada alasan di Hasil)';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await withFriendlyErrors(async () => {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = findRepoRoot(__dirname);
    const requirementsDir = path.join(repoRoot, 'requirements');

    if (!fs.existsSync(requirementsDir)) {
      throw friendly({
        title: 'Folder requirements/ tidak ditemukan',
        detail: `Expected at: ${requirementsDir}`,
        hint: 'Pastikan Anda menjalankan dari repo root.',
        exitCode: EXIT.ESCALATE,
      });
    }

    const reqFiles = collectRequirementFiles(requirementsDir);

    const results: RequirementManual[] = [];
    for (const file of reqFiles) {
      const parsed = parseRequirementFile(file);
      if (!parsed) continue;
      if (args.reqId && parsed.reqId !== args.reqId) continue;
      results.push(parsed);
    }

    // Sort by REQ ID
    results.sort((a, b) => a.reqId.localeCompare(b.reqId));

    // ─── JSON output mode ───
    if (args.jsonOutput) {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
      process.exit(EXIT.OK);
    }

    // ─── Human-friendly output ───
    if (results.length === 0) {
      if (args.reqId) {
        printInfo(`Tidak ada skenario (@manual) untuk ${args.reqId}`);
      } else {
        printOk('🎉 Tidak ada skenario (@manual) di semua requirement');
        printInfo('Semua skenario automatable. Bagus!');
      }
      process.exit(EXIT.OK);
    }

    process.stdout.write('╔════════════════════════════════════════════════════════╗\n');
    process.stdout.write('║  📋 Manual Scenarios Summary                           ║\n');
    process.stdout.write('╚════════════════════════════════════════════════════════╝\n\n');

    let totalScenarios = 0;
    let totalNoReason = 0;

    for (const req of results) {
      process.stdout.write(`[${req.reqId}] ${req.filePath}\n`);
      process.stdout.write('─'.repeat(56) + '\n');
      for (const sc of req.scenarios) {
        totalScenarios++;
        const reasonShort =
          sc.reason === '(tidak ada alasan di Hasil)'
            ? sc.reason
            : sc.reason.length > 80
              ? sc.reason.slice(0, 77) + '...'
              : sc.reason;

        const statusEmoji = sc.reason === '(tidak ada alasan di Hasil)' ? '⚠' : '☐';
        if (sc.reason === '(tidak ada alasan di Hasil)') totalNoReason++;

        process.stdout.write(`  ${statusEmoji} ${sc.scenarioId}: ${sc.title}\n`);
        process.stdout.write(`     💡 ${reasonShort}\n`);
        process.stdout.write(`     📍 ${req.filePath}:${sc.lineNumber}\n`);
      }
      process.stdout.write('\n');
    }

    process.stdout.write('═'.repeat(56) + '\n');
    process.stdout.write(`📊 Total: ${totalScenarios} manual scenario`);
    if (totalNoReason > 0) {
      process.stdout.write(
        ` (⚠ ${totalNoReason} tanpa alasan di Hasil — lihat docs/MANUAL-SCENARIOS.md)`,
      );
    }
    process.stdout.write('\n\n');

    if (totalNoReason > 0) {
      printWarn(
        `${totalNoReason} skenario (@manual) tidak punya alasan di Hasil. Tambahkan penjelasan di bagian **Hasil:** requirement.`,
      );
      printInfo('Lihat: docs/MANUAL-SCENARIOS.md untuk best practice');
      process.exit(EXIT.FIXABLE);
    }

    printOk('Semua skenario (@manual) punya alasan jelas. Pipeline aman dijalankan.');
    process.exit(EXIT.OK);
  });
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(EXIT.ESCALATE);
});
