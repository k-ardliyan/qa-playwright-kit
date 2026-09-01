import { healthCheck } from '../mcp/src/tools/health-check';
import { bootstrapMcpEnvironment } from './mcp-bootstrap';
import { EXIT } from './exit-codes';
import { printError, printOk, printWarn, withFriendlyErrors } from './format-error';

/**
 * Map check name → friendly hint + docs link.
 * Supaya QA non-coder dapat actionable fix saat check fail.
 */
const HINTS: Record<string, { hint: string; docs: string; severity: 'fixable' | 'escalate' }> = {
  node: {
    hint: 'Install Node.js 20 LTS dari https://nodejs.org (minimum 20.19.0)',
    docs: 'docs/GUIDE.md#setup-lokal',
    severity: 'fixable',
  },
  mcp_build: {
    hint: 'Jalankan: npm run mcp:build',
    docs: 'docs/GUIDE.md#setup-lokal',
    severity: 'fixable',
  },
  playwright_mcp: {
    hint: 'Jalankan: npm install @playwright/mcp@0.0.80',
    docs: 'docs/GUIDE.md#setup-lokal',
    severity: 'fixable',
  },
  playwright_test: {
    hint: 'Upgrade Playwright: npm install @playwright/test@latest (minimum 1.56)',
    docs: 'docs/GUIDE.md#troubleshooting-health-check',
    severity: 'fixable',
  },
  environment: {
    hint: 'Salin template: cp config/environments/local.env.example config/environments/<APP_ENV>.env (local|dev|staging|…) lalu isi BASE_URL + kredensial. Cek: npm run env:status',
    docs: 'docs/GUIDE.md#setup-lokal',
    severity: 'fixable',
  },
  base_url: {
    hint: 'Set BASE_URL di config/environments/{APP_ENV}.env aktif (npm run env:status). Contoh: BASE_URL=https://staging.app.com',
    docs: 'docs/GUIDE.md#setup-lokal',
    severity: 'fixable',
  },
  json_results: {
    hint: 'Normal sebelum test pertama. Jalankan: npm test',
    docs: 'docs/GUIDE.md#troubleshooting-health-check',
    severity: 'fixable',
  },
};

async function main(): Promise<void> {
  await withFriendlyErrors(async () => {
    bootstrapMcpEnvironment(__dirname);
    const output = healthCheck();

    let failCount = 0;
    let warnCount = 0;

    for (const check of output.checks) {
      if (check.status === 'ok') {
        printOk(`[${check.name}] ${check.message}`);
      } else if (check.status === 'warn') {
        warnCount++;
        const hint = HINTS[check.name];
        printWarn(`[${check.name}] ${check.message}`);
        if (hint) {
          process.stdout.write(`  💡 ${hint.hint}\n`);
          process.stdout.write(`  📖 ${hint.docs}\n`);
        }
      } else {
        failCount++;
        const hint = HINTS[check.name];
        printError({
          title: check.name,
          detail: check.message,
          hint: hint?.hint,
          docsLink: hint?.docs,
          exitCode: hint?.severity === 'escalate' ? EXIT.ESCALATE : EXIT.FIXABLE,
        });
      }
    }

    process.stdout.write('\n');
    if (failCount === 0 && warnCount === 0) {
      printOk(`🎉 ${output.message}`);
      process.exit(EXIT.OK);
    } else if (failCount === 0) {
      printWarn(`${output.message} (${warnCount} warning)`);
      process.exit(EXIT.OK);
    } else {
      process.stderr.write(
        `\n❌ ${failCount} check gagal, ${warnCount} warning. Perbaiki yang gagal lalu coba lagi.\n`,
      );
      process.exit(EXIT.FIXABLE);
    }
  });
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(EXIT.ESCALATE);
});
