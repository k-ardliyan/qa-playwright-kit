/// <reference types="node" />
/**
 * Friendly error formatter untuk semua CLI scripts.
 *
 * Output ramah non-coder: emoji + pesan jelas + hint actionable + link ke docs.
 *
 * @module scripts/format-error
 */

import { EXIT, type ExitCode } from './exit-codes';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Structured error yang akan di-format jadi output ramah pemula.
 */
export interface FriendlyError {
  /** Judul singkat (1 baris) — apa yang gagal. */
  title: string;
  /** Detail (1-3 baris) — kenapa gagal. Boleh multiline. */
  detail: string;
  /** Hint actionable — apa yang harus dilakukan untuk fix. */
  hint?: string;
  /** Link ke troubleshooting di docs (relative path atau URL). */
  docsLink?: string;
  /** Exit code. Default EXIT.FIXABLE. */
  exitCode?: ExitCode;
}

/** Custom Error class yang membungkus FriendlyError agar bisa di-throw. */
export class FriendlyErrorInstance extends Error {
  public readonly friendly: FriendlyError;
  public readonly exitCode: ExitCode;

  constructor(friendly: FriendlyError) {
    super(friendly.title);
    this.name = 'FriendlyError';
    this.friendly = friendly;
    this.exitCode = friendly.exitCode ?? EXIT.FIXABLE;
  }
}

// ─── Printers ─────────────────────────────────────────────────────────────────

/**
 * GitHub Actions workflow command escaping (per actions/toolkit docs).
 * Strips %, \r, \n so data cannot inject fake annotations.
 */
function ghEscape(msg: string): string {
  return msg.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** True when running inside GitHub Actions (workflow logs get real annotations). */
function inGithubActions(): boolean {
  return process.env.GITHUB_ACTIONS === 'true';
}

/**
 * Emit a native GitHub Actions annotation (::error / ::warning / ::notice)
 * so quality-gate failures appear inline on the PR instead of grey logs.
 */
function ghAnnotation(level: 'error' | 'warning' | 'notice', msg: string): void {
  if (!inGithubActions()) return;
  process.stdout.write(`::${level}::${ghEscape(msg)}\n`);
}

/**
 * Print success message dengan emoji ✓ dan warna hijau (jika terminal support).
 */
export function printOk(msg: string): void {
  process.stdout.write(`\u001b[32m✓\u001b[0m ${msg}\n`);
}

/**
 * Print warning message dengan emoji ⚠ dan warna kuning.
 * Di GitHub Actions juga memancarkan ::warning annotation.
 */
export function printWarn(msg: string): void {
  process.stdout.write(`\u001b[33m⚠\u001b[0m ${msg}\n`);
  ghAnnotation('warning', msg);
}

/**
 * Print info message dengan emoji ℹ dan warna biru.
 */
export function printInfo(msg: string): void {
  process.stdout.write(`\u001b[34mℹ\u001b[0m ${msg}\n`);
}

/**
 * Print step header (untuk multi-step CLI seperti qa:run).
 */
export function printStep(step: number, total: number, label: string): void {
  process.stdout.write(`\n\u001b[1m[${step}/${total}] ${label}\u001b[0m\n`);
}

/**
 * Print FriendlyError dalam format yang ramah non-coder.
 * Di GitHub Actions juga memancarkan ::error annotation.
 */
export function printError(err: FriendlyError): void {
  const code = err.exitCode ?? EXIT.FIXABLE;
  const emoji = code === EXIT.ESCALATE ? '\u001b[31m🆘\u001b[0m' : '\u001b[31m✗\u001b[0m';

  process.stderr.write(`${emoji} ${err.title}\n`);
  ghAnnotation('error', [err.title, err.detail].filter(Boolean).join(' — '));
  if (err.detail) {
    const detailLines = err.detail.split('\n');
    for (const line of detailLines) {
      process.stderr.write(`  ${line}\n`);
    }
  }
  if (err.hint) {
    process.stderr.write(`\n\u001b[33m💡 ${err.hint}\u001b[0m\n`);
  }
  if (err.docsLink) {
    process.stderr.write(`\u001b[36m📖 ${err.docsLink}\u001b[0m\n`);
  }
}

// ─── Wrappers ─────────────────────────────────────────────────────────────────

/**
 * Cek apakah thrown value adalah FriendlyErrorInstance.
 */
export function isFriendlyError(value: unknown): value is FriendlyErrorInstance {
  return value instanceof FriendlyErrorInstance;
}

/**
 * Helper untuk throw FriendlyError dengan syntax ringkas.
 *
 * @example
 *   throw friendly({
 *     title: 'Environment file tidak ditemukan',
 *     detail: 'config/environments/local.env does not exist',
 *     hint: 'Salin: cp config/environments/local.env.example config/environments/local.env',
 *     docsLink: 'docs/GUIDE.md#setup-lokal',
 *   });
 */
export function friendly(err: FriendlyError): FriendlyErrorInstance {
  return new FriendlyErrorInstance(err);
}

/**
 * Wrap async function dengan friendly error handling.
 * Tangkap FriendlyErrorInstance → print + exit. Re-throw unknown errors.
 *
 * @example
 *   await withFriendlyErrors(async () => {
 *     await doSomething();
 *     if (bad) throw friendly({ title: '...', detail: '...' });
 *   });
 */
export async function withFriendlyErrors(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (e: unknown) {
    if (isFriendlyError(e)) {
      printError(e.friendly);
      process.exit(e.exitCode);
    }
    // Unknown error — print stack dan exit FIXABLE
    const msg = e instanceof Error ? e.message : String(e);
    printError({
      title: 'Unexpected error',
      detail: msg,
      hint: 'Hubungi Framework Maintainer jika ini berulang.',
      exitCode: EXIT.ESCALATE,
    });
    if (e instanceof Error && e.stack) {
      process.stderr.write(`\n${e.stack}\n`);
    }
    process.exit(EXIT.ESCALATE);
  }
}

/**
 * Format error ke string (untuk testing atau logging).
 */
export function formatErrorString(err: FriendlyError): string {
  const lines: string[] = [`${err.title}`];
  if (err.detail) lines.push(`  ${err.detail}`);
  if (err.hint) lines.push(`💡 ${err.hint}`);
  if (err.docsLink) lines.push(`📖 ${err.docsLink}`);
  return lines.join('\n');
}
