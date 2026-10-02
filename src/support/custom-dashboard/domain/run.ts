/**
 * Domain types and helpers for Test Runs and Archives.
 *
 * Implements the Triple Identity Model:
 * - runId: Machine ID / storage key / immutable folder name
 * - displayName: Human-readable QA label (e.g. "Login Regression — Staging RC12")
 * - testSeriesId: Logical test suite grouping for safe comparisons (e.g. "auth-login-regression")
 *
 * @module src/support/custom-dashboard/domain/run
 */

import type { QaDecision, TriggerSource } from '../../../agents/reporter/report-archive';

/**
 * Derives a human-readable display name for a run if not explicitly provided.
 */
export function deriveDisplayName(options: {
  displayName?: string;
  requirementTitle?: string;
  requirementPath?: string;
  appEnv?: string;
  ranAt?: string;
}): string {
  if (options.displayName?.trim()) {
    return options.displayName.trim();
  }

  const baseTitle =
    options.requirementTitle?.trim() ||
    (options.requirementPath
      ? options.requirementPath.replace(/^.*[\\/]/, '').replace(/\.md$/, '')
      : 'Test Run');

  const env = options.appEnv ? ` — ${options.appEnv}` : '';
  const dateStr = options.ranAt
    ? ` — ${new Date(options.ranAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : '';

  return `${baseTitle}${env}${dateStr}`;
}

/**
 * Derives a normalized testSeriesId from requirement metadata or title.
 */
export function deriveTestSeriesId(options: {
  testSeriesId?: string;
  requirementId?: string;
  requirementPath?: string;
  requirementTitle?: string;
}): string {
  if (options.testSeriesId?.trim()) {
    return options.testSeriesId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
  }

  if (options.requirementId?.trim()) {
    return options.requirementId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
  }

  if (options.requirementPath?.trim()) {
    return options.requirementPath
      .replace(/^.*[\\/]/, '')
      .replace(/\.md$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
  }

  if (options.requirementTitle?.trim()) {
    return options.requirementTitle
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-');
  }

  return 'default-series';
}
