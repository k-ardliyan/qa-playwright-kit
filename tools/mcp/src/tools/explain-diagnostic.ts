import { DIAGNOSTIC_CATALOG, DIAGNOSTIC_CATALOG_ENTRIES } from '../contracts/diagnostic-catalog';

export interface ExplainDiagnosticOutput {
  status: 'success' | 'error';
  /** The code exactly as requested (trimmed, upper-cased). */
  code: string;
  /** Catalog entry, when the code is known. */
  entry?: {
    lay: string;
    suggestion: string;
  };
  /** Loose matches when the exact code is unknown (prefix/suffix search). */
  candidates?: Array<{ code: string; lay: string; suggestion: string }>;
  message: string;
  error?: { code: string; message: string };
}

/**
 * MCP tool `explain_diagnostic` — turn a DiagnosticCode into a lay-language
 * explanation plus the remediation the agent can execute now. Closes the
 * "agent gets PLAN_SEED_UNPROVISIONED and must grep the source" gap: every
 * code emitted by the pipeline has one canonical catalog entry
 * (src/contracts/diagnostic-catalog.ts).
 *
 * Unknown codes return prefix/suffix candidates instead of a bare error, so a
 * partially-remembered code ("PLAN_SEED") still lands somewhere useful.
 */
export function explainDiagnostic(
  args: Record<string, unknown> | undefined,
): ExplainDiagnosticOutput {
  const raw = typeof args?.['code'] === 'string' ? args['code'].trim() : '';
  if (!raw) {
    return {
      status: 'error',
      code: '',
      message:
        'Provide the diagnostic code to explain, e.g. { "code": "PLAN_SEED_UNPROVISIONED" }. Codes appear in the `code` field of every diagnostic from validate_plan / compile_requirement / pipeline stages.',
      error: {
        code: 'INVALID_INPUT',
        message: 'Missing required string parameter: code.',
      },
    };
  }
  const code = raw.toUpperCase();

  const exact = DIAGNOSTIC_CATALOG[code];
  if (exact) {
    return {
      status: 'success',
      code,
      entry: { lay: exact.lay, suggestion: exact.suggestion },
      message: `${code}: ${exact.lay}`,
    };
  }

  // Loose match: same family prefix or shared word, capped to keep responses small.
  const family = code.split('_')[0];
  const needle = code.replace(/_/g, ' ').toLowerCase();
  const candidates = DIAGNOSTIC_CATALOG_ENTRIES.filter(({ code: c, lay }) => {
    if (c === code) return false;
    return (
      c.startsWith(family + '_') ||
      needle.split(' ').some((w) => w.length > 3 && c.replace(/_/g, ' ').toLowerCase().includes(w))
    );
  })
    .slice(0, 8)
    .map(({ code: c, lay, suggestion }) => ({ code: c, lay, suggestion }));

  return {
    status: 'success',
    code,
    ...(candidates.length > 0
      ? {
          candidates,
          message: `Code "${code}" is not in the catalog. Closest known codes (${candidates.length}) — if none matches, the code may be new: check src/contracts/diagnostic-catalog.ts.`,
        }
      : {
          message: `Code "${code}" is not in the catalog and no similar code matched. It may be newer than this catalog — check src/contracts/diagnostics.ts and src/contracts/diagnostic-catalog.ts.`,
        }),
  };
}
