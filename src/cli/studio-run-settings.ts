/**
 * Studio run settings — the browser knobs a non-coder can set before a run.
 *
 * Three knobs, each mapping to a real Playwright env var the execution layer
 * already reads (`config/playwright/base.ts`):
 *   - slowMo   → SLOW_MO       (ms delay per action; 0 = off; CI forces 0)
 *   - headless → HEADLESS      (true/false)
 *   - viewport → QA_VIEWPORT   (WIDTHxHEIGHT)
 *
 * Two ways to apply them (the Studio UI offers both):
 *   - Per-run: pass `env` to the spawned Playwright child, nothing written.
 *   - Persist: `runSettingsEnvUpserts` returns the KEY=value bag for
 *     `upsertEnvContent` so the active `config/environments/<APP_ENV>.env`
 *     carries them for future runs and the CLI too.
 *
 * Pure (no I/O, no spawn) so both paths share one validator.
 *
 * @module src/cli/studio-run-settings
 */

export interface StudioRunSettings {
  slowMo?: number;
  headless?: boolean;
  viewport?: string;
  /** Run specs one at a time (`--workers=1`) instead of the default parallel. */
  serial?: boolean;
}

export interface NormalizedRunSettings {
  /** Env KEY=value bag to merge into the spawn env / env file. Empty when unset. */
  env: Record<string, string>;
  /** Human-readable warnings for values that were dropped (never thrown). */
  warnings: string[];
}

const VIEWPORT_RE = /^(\d{3,5})x(\d{3,5})$/i;

/** Validate a viewport string. Returns normalized `WIDTHxHEIGHT` or null. */
export function normalizeViewport(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = VIEWPORT_RE.exec(raw.trim());
  if (!m) return null;
  const width = Number.parseInt(m[1], 10);
  const height = Number.parseInt(m[2], 10);
  // Same floor the runtime enforces in resolveViewport().
  if (width < 320 || height < 240) return null;
  return `${width}x${height}`;
}

/**
 * Turn loose settings (from a request body) into a validated env bag.
 * Unknown/invalid values are dropped with a warning — a bad knob never blocks
 * a run, it just isn't applied.
 */
export function normalizeRunSettings(settings: StudioRunSettings): NormalizedRunSettings {
  const env: Record<string, string> = {};
  const warnings: string[] = [];

  if (settings.slowMo !== undefined) {
    const n = Number(settings.slowMo);
    if (Number.isFinite(n) && n >= 0 && n <= 10_000) {
      env.SLOW_MO = String(Math.floor(n));
    } else {
      warnings.push(`slow-mo diabaikan (harus 0–10000 ms, dapat '${settings.slowMo}')`);
    }
  }

  if (settings.headless !== undefined) {
    if (typeof settings.headless === 'boolean') {
      env.HEADLESS = settings.headless ? 'true' : 'false';
    } else {
      warnings.push('headless diabaikan (harus boolean)');
    }
  }

  if (settings.viewport !== undefined) {
    const vp = normalizeViewport(settings.viewport);
    if (vp) env.QA_VIEWPORT = vp;
    else
      warnings.push(
        `viewport diabaikan (format harus WIDTHxHEIGHT, min 320x240; dapat '${settings.viewport}')`,
      );
  }

  if (settings.serial !== undefined && typeof settings.serial !== 'boolean') {
    warnings.push('mode jalankan diabaikan (harus boolean)');
  }

  return { env, warnings };
}

/** Viewport from two numeric fields (the Studio's width × height inputs). */
export function viewportFromNumbers(width: unknown, height: unknown): string | null {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return normalizeViewport(`${Math.floor(w)}x${Math.floor(h)}`);
}

/** Env KEY=value bag for persisting settings into the active env file. */
export function runSettingsEnvUpserts(settings: StudioRunSettings): Record<string, string> {
  return normalizeRunSettings(settings).env;
}
