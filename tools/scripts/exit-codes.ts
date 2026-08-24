/**
 * Standard exit codes for all QA Playwright Kit CLI scripts.
 *
 * Konsisten di seluruh CLI agar predictable untuk scripting, CI, dan non-coder QA.
 * Lihat docs/EXIT-CODES.md untuk referensi lengkap.
 *
 * @module scripts/exit-codes
 */

/**
 * Exit codes untuk semua CLI commands.
 *
 * - 0 = success
 * - 1 = fixable error (QA bisa self-fix dengan baca pesan error)
 * - 2 = eskalasi (hubungi Framework Maintainer)
 * - 3 = usage error (argumen salah / file tidak ditemukan oleh script)
 */
export const EXIT = {
  /** Success. Pipeline / command selesai tanpa masalah. */
  OK: 0,
  /** Fixable error. QA bisa perbaiki sendiri dengan mengikuti hint di pesan. */
  FIXABLE: 1,
  /** Eskalasi. Bug di framework / config rusak yang butuh Framework Maintainer. */
  ESCALATE: 2,
  /** Usage error. Argumen CLI salah atau path yang diberikan tidak valid. */
  USAGE: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * Human-readable label untuk setiap exit code (untuk log/debug).
 */
export const EXIT_LABELS: Record<ExitCode, string> = {
  [EXIT.OK]: 'OK',
  [EXIT.FIXABLE]: 'FIXABLE_ERROR',
  [EXIT.ESCALATE]: 'ESCALATE_TO_MAINTAINER',
  [EXIT.USAGE]: 'USAGE_ERROR',
};

/**
 * Mapping sederhana: string name → exit code.
 * Berguna untuk parsing dari config atau external scripts.
 */
export function exitCodeFromName(name: string): ExitCode | undefined {
  const upper = name.toUpperCase();
  switch (upper) {
    case 'OK':
    case 'SUCCESS':
    case '0':
      return EXIT.OK;
    case 'FIXABLE':
    case 'FIXABLE_ERROR':
    case '1':
      return EXIT.FIXABLE;
    case 'ESCALATE':
    case 'ESCALATE_TO_MAINTAINER':
    case '2':
      return EXIT.ESCALATE;
    case 'USAGE':
    case 'USAGE_ERROR':
    case '3':
      return EXIT.USAGE;
    default:
      return undefined;
  }
}
