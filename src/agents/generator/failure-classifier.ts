/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 * Catatan: bagian dari triple-duplikasi classifier.
 *
 * Failure Classification Module for Generator Agent.
 *
 * Classifies generation errors into exactly one FailureClassification category
 * using a precedence-ordered rule chain. The classification determines whether
 * the retry engine should retry, skip, or fallback.
 *
 * Classification precedence order:
 *   app_unavailable → transient_network → auth_required →
 *   selector_not_found → timeout → structural_error
 *
 * @module agents/generator/failure-classifier
 * @requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8
 */

import { FailureClassification } from '../../shared/types';

/**
 * Represents an error encountered during test generation.
 */
export interface GenerationError {
  /** Error message describing what went wrong */
  message: string;
  /** Optional error code (e.g., ECONNREFUSED, ETIMEDOUT) */
  code?: string;
  /** Optional HTTP status code if the error originated from an HTTP response */
  statusCode?: number;
}

// ─── Pattern Definitions ──────────────────────────────────────────────────────

/** Patterns indicating transient network issues */
const TRANSIENT_NETWORK_PATTERN = /ECONNREFUSED|ETIMEDOUT|fetch\s+failed/i;

/** Patterns indicating Playwright locator-not-found errors */
const SELECTOR_NOT_FOUND_PATTERN =
  /waiting for locator|resolved to 0 elements|no element matches|locator.*not found/i;

/** Patterns indicating HTTP 5xx status codes */
const HTTP_5XX_PATTERN = /\b5\d{2}\b/;

/** Patterns indicating authentication/authorization failures */
const AUTH_PATTERN = /\b(401|403)\b/;

/** Patterns indicating redirect to login/auth pages */
const AUTH_REDIRECT_PATTERN = /redirect.*(login|auth)/i;

/** Patterns indicating timeout (without transient network keywords) */
const TIMEOUT_PATTERN = /timeout|exceeded/i;

// ─── Classification Logic ─────────────────────────────────────────────────────

/**
 * Classifies a generation error into exactly one FailureClassification category.
 *
 * The function evaluates rules in strict precedence order:
 * 1. app_unavailable — HTTP 5xx or ECONNREFUSED to base URL
 * 2. transient_network — ECONNREFUSED, ETIMEDOUT, or "fetch failed"
 * 3. auth_required — 401/403 or login redirect
 * 4. selector_not_found — Playwright locator-not-found indicators
 * 5. timeout — "timeout" or "exceeded" without network keywords
 * 6. structural_error — fallback for anything else (including empty messages)
 *
 * @param error - The generation error to classify. Must be non-null.
 * @returns Exactly one FailureClassification variant (function is total).
 */
export function classifyFailure(error: GenerationError): FailureClassification {
  const message = error.message ?? '';

  // Requirement 15.8: empty/undefined message → structural_error
  if (!message || message.trim().length === 0) {
    return 'structural_error';
  }

  const statusCode = error.statusCode;

  // ── 1. app_unavailable (highest precedence) ──
  // Requirement 15.3: HTTP 5xx or ECONNREFUSED referencing base URL
  if (isAppUnavailable(message, statusCode)) {
    return 'app_unavailable';
  }

  // ── 2. transient_network ──
  // Requirement 15.1: ECONNREFUSED, ETIMEDOUT, or "fetch failed"
  if (TRANSIENT_NETWORK_PATTERN.test(message)) {
    return 'transient_network';
  }

  // ── 3. auth_required ──
  // Requirement 15.4: 401/403 or redirect to login/auth
  if (isAuthRequired(message, statusCode)) {
    return 'auth_required';
  }

  // ── 4. selector_not_found ──
  // Requirement 15.2: Playwright locator-not-found indicators
  if (SELECTOR_NOT_FOUND_PATTERN.test(message)) {
    return 'selector_not_found';
  }

  // ── 5. timeout ──
  // Requirement 15.5: "timeout"/"exceeded" without transient network keywords
  if (TIMEOUT_PATTERN.test(message) && !TRANSIENT_NETWORK_PATTERN.test(message)) {
    return 'timeout';
  }

  // ── 6. structural_error (fallback) ──
  // Requirement 15.6: anything that doesn't match above rules
  return 'structural_error';
}

/**
 * Determines if a classification is retryable.
 *
 * Retryable classifications: transient_network, selector_not_found,
 * app_unavailable, timeout.
 *
 * Non-retryable classifications: auth_required, structural_error.
 *
 * @param classification - The failure classification to check.
 * @returns true if the failure type is retryable, false otherwise.
 */
export function isRetryable(classification: FailureClassification): boolean {
  switch (classification) {
    case 'transient_network':
    case 'selector_not_found':
    case 'app_unavailable':
    case 'timeout':
      return true;
    case 'auth_required':
    case 'structural_error':
      return false;
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Checks if an error indicates the application is unavailable.
 * Matches HTTP 5xx status codes or ECONNREFUSED with base URL context.
 */
function isAppUnavailable(message: string, statusCode?: number): boolean {
  // Direct HTTP 5xx status code
  if (statusCode !== undefined && statusCode >= 500 && statusCode <= 599) {
    return true;
  }

  // HTTP 5xx mentioned in message with base URL context indicators
  if (HTTP_5XX_PATTERN.test(message) && hasBaseUrlContext(message)) {
    return true;
  }

  // ECONNREFUSED specifically referencing the base/configured URL
  if (/ECONNREFUSED/i.test(message) && hasBaseUrlContext(message)) {
    return true;
  }

  return false;
}

/**
 * Heuristic to determine if an error message references the configured base URL
 * or the application server (as opposed to external services).
 *
 * Looks for indicators like "base", "localhost", "127.0.0.1", "baseURL",
 * server-related terms, or common app URL patterns.
 */
function hasBaseUrlContext(message: string): boolean {
  return /base\s*url|baseurl|localhost|127\.0\.0\.1|0\.0\.0\.0|server|app.*url|target.*url/i.test(
    message,
  );
}

/**
 * Checks if an error indicates authentication is required.
 * Matches 401/403 status codes or login/auth redirect patterns.
 */
function isAuthRequired(message: string, statusCode?: number): boolean {
  // Direct HTTP 401 or 403 status code
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }

  // 401/403 mentioned in message
  if (AUTH_PATTERN.test(message)) {
    return true;
  }

  // Redirect to login/auth URL
  if (AUTH_REDIRECT_PATTERN.test(message)) {
    return true;
  }

  return false;
}
