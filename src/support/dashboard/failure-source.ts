import type { FailureSource } from './types';

const VALID: ReadonlySet<string> = new Set([
  'app',
  'test',
  'requirement',
  'env',
  'ai_generation',
  'unknown',
]);

const UNHEALTHY = new Set(['failed', 'timedOut', 'interrupted']);

/** Normalize annotation / free text into FailureSource or undefined. */
export function normalizeFailureSource(raw: string | undefined | null): FailureSource | undefined {
  if (!raw) return undefined;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (VALID.has(key)) return key as FailureSource;
  // common aliases
  if (key === 'application' || key === 'bug') return 'app';
  if (key === 'spec' || key === 'selector' || key === 'automation') return 'test';
  if (key === 'environment' || key === 'infra') return 'env';
  if (key === 'generator' || key === 'ai') return 'ai_generation';
  if (key === 'req' || key === 'spec_gap') return 'requirement';
  return undefined;
}

/**
 * Heuristic failure source for unhealthy tests when annotation is absent.
 * Labeled "suggested" in the UI — not ground truth.
 */
export function suggestFailureSource(input: {
  status: string;
  errorMessage: string;
  title?: string;
}): FailureSource | undefined {
  if (!UNHEALTHY.has(input.status)) return undefined;

  const msg = `${input.errorMessage || ''} ${input.title || ''}`.toLowerCase();

  if (
    /storage.?state|auth|unauthorized|401|403|login required|econnrefused|enotfound|net::err_|err_connection|base_?url|certificate|ssl|dns/.test(
      msg,
    )
  ) {
    return 'env';
  }

  if (
    /locator\.|getby|strict mode violation|tobevisible|tohavetext|tohaveurl|expect\(|timeout \d+ms exceeded|waiting for/.test(
      msg,
    )
  ) {
    return 'test';
  }

  if (
    /status 5\d\d|internal server error|whoops|exception|stack trace|typeerror:|referenceerror:/.test(
      msg,
    )
  ) {
    return 'app';
  }

  // HTTP 4xx (except auth codes already caught above) → likely app validation/logic bug
  if (/status 4\d\d|http 4\d\d|response code 4\d\d/.test(msg)) {
    return 'app';
  }

  if (/not implemented|todo|requirement|acceptance criteria|expected result/.test(msg)) {
    return 'requirement';
  }

  if (/generated|ai_generation|healer|skeleton/.test(msg)) {
    return 'ai_generation';
  }

  return 'unknown';
}

export function resolveFailureSource(opts: {
  status: string;
  errorMessage: string;
  title?: string;
  annotation?: string;
}): FailureSource | undefined {
  if (!UNHEALTHY.has(opts.status)) return undefined;
  return (
    normalizeFailureSource(opts.annotation) ||
    suggestFailureSource({
      status: opts.status,
      errorMessage: opts.errorMessage,
      title: opts.title,
    }) ||
    'unknown'
  );
}

/** Map failure source → suggested QA exit decision label. */
export function decisionHintFor(source: FailureSource | undefined): string {
  switch (source) {
    case 'app':
      return 'FILE BUG';
    case 'test':
      return 'FIX TEST';
    case 'ai_generation':
      return 'FIX TEST/GENERATOR';
    case 'requirement':
      return 'REVISE REQUIREMENT';
    case 'env':
      return 'FIX ENVIRONMENT';
    case 'unknown':
    default:
      return 'TRIAGE';
  }
}

/**
 * Ultra-short visible blurb under decision (always on-screen, not hover-only).
 * When errorMessage is provided, prefer a concrete Playwright error explanation.
 */
export function decisionHintBlurbFor(
  source: FailureSource | undefined,
  errorMessage?: string,
): string {
  const explained = errorMessage ? explainFailure(errorMessage) : undefined;
  if (explained) return explained;

  switch (source) {
    case 'app':
      return 'Bug di aplikasi → buat ticket';
    case 'test':
      return 'Selector/assertion test rusak';
    case 'ai_generation':
      return 'Generated test perlu diperbaiki';
    case 'requirement':
      return 'Requirement/expected tidak cocok';
    case 'env':
      return 'Auth / env / seed bermasalah';
    case 'unknown':
    default:
      return 'Perlu investigasi manual';
  }
}

/**
 * One-line plain-language explanation of common Playwright / env errors for QA.
 * Returns undefined when no confident pattern matches (keep generic blurb).
 */
export function explainFailure(errorMessage: string | undefined | null): string | undefined {
  if (!errorMessage) return undefined;
  const msg = errorMessage.toLowerCase();

  if (/strict mode violation|resolved to \d+ elements/.test(msg)) {
    return 'Selector ketemu lebih dari 1 elemen — buat lebih spesifik';
  }
  if (/econnrefused|net::err_|err_connection|enotfound|getaddrinfo/.test(msg)) {
    return 'App/URL tidak bisa dihubungi — cek BASE_URL & server';
  }
  if (/storage.?state|unauthorized|401|403|login required/.test(msg)) {
    return 'Auth/session bermasalah — jalankan auth:setup';
  }
  if (/timeout \d+ms exceeded|waiting for (locator|selector|getby)/.test(msg)) {
    return 'Elemen tidak muncul tepat waktu — cek selector/timing';
  }
  if (/tobevisible|not visible|tobehidden/.test(msg)) {
    return 'Elemen tidak terlihat seperti yang diharapkan';
  }
  if (/tohaveurl|unexpected url|page\.url/.test(msg)) {
    return 'URL halaman tidak sesuai expected';
  }
  if (/tohavetext|tohavevalue|expected string|expected pattern/.test(msg)) {
    return 'Teks/nilai di UI tidak cocok expected';
  }
  if (/enoent|no such file|fixture path|setinputfiles/.test(msg)) {
    return 'File fixture/path tidak ditemukan';
  }
  if (/download|waiting for event ['"]download['"]/.test(msg)) {
    return 'Download tidak terpicu — cek tombol/export';
  }
  if (/status 5\d\d|internal server error/.test(msg)) {
    return 'Server error 5xx — kemungkinan bug backend';
  }
  if (/status 4\d\d|http 4\d\d/.test(msg)) {
    return 'HTTP 4xx dari API — cek validasi/akses';
  }

  return undefined;
}

/**
 * Full plain-language meaning for QA (HTML title tooltip).
 * Shown on hover over the SOURCE cell.
 */
export function decisionHintTooltipFor(
  source: FailureSource | undefined,
  errorMessage?: string,
): string {
  const explained = errorMessage ? explainFailure(errorMessage) : undefined;
  const base = (() => {
    switch (source) {
      case 'app':
        return 'Bug di aplikasi — buat defect ticket; simpan test sebagai regression guard';
      case 'test':
        return 'Masalah di kode test (selector/assertion) — perbaiki test lalu rerun';
      case 'ai_generation':
        return 'Test generated AI bermasalah — perbaiki generator/input, regenerate, rerun';
      case 'requirement':
        return 'Requirement/expected tidak cocok — revisi requirement, plan ulang, regenerate';
      case 'env':
        return 'Masalah auth/env/seed/network — perbaiki environment, rerun dari Execute';
      case 'unknown':
      default:
        return 'Sumber belum jelas — investigasi trace/screenshot dulu (triage manual)';
    }
  })();

  if (!explained) return base;
  return `${explained}. ${base}`;
}
