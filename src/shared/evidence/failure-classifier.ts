import type { ExtendedFailureCategory, EvidenceManifest } from './evidence-types';

export interface ClassifiedFailureResult {
  category: ExtendedFailureCategory;
  reason: string;
  confidence: number;
  isHealable: boolean;
  recommendedAction: string;
}

/**
 * Classify a failure using evidence manifest, error messages, and network/console signals.
 */
export function classifyFailureFromEvidence(
  errorMessage: string,
  manifest?: Partial<EvidenceManifest>,
): ClassifiedFailureResult {
  const msg = `${errorMessage || ''} ${manifest?.errorMessage || ''}`.toLowerCase();

  // 1. Application defect checks (Highest priority guard). Bare \b5\d\d\b so a
  // "503 Service Unavailable" or "504 Gateway Timeout" text is classified as an
  // application defect rather than falling through to network/unknown.
  const has5xxStatus = manifest?.networkRequests?.some((req) => req.status >= 500);
  const appInMessage =
    /\b5\d\d\b|internal server error|database error|sqlstate|unhandled exception|status 5\d\d/i.test(
      msg,
    );

  if (has5xxStatus || appInMessage) {
    return {
      category: 'application',
      reason: 'Application backend returned 5xx server error during execution',
      confidence: 0.95,
      isHealable: false,
      recommendedAction:
        'FILE BUG: Keep test as regression guard; report backend defect to developers',
    };
  }

  // 2. Authentication / Session failures
  // Deliberately NO bare /auth/ match: the word appears inside many locator and
  // content errors (e.g. an element named "auth submit") and would misroute a
  // healable locator failure into a non-healable auth category.
  if (
    manifest?.storageDiagnostic?.exists === false ||
    manifest?.storageDiagnostic?.valid === false ||
    /storage.?state|unauthorized|401|403|login required|session expired|redirected to login|sign in required|credentials expired/i.test(
      msg,
    )
  ) {
    return {
      category: 'auth',
      reason:
        manifest?.storageDiagnostic?.reason ||
        'Authentication session is missing, invalid, or expired',
      confidence: 0.9,
      isHealable: false,
      recommendedAction:
        'FIX ENVIRONMENT: Re-run auth setup (npm run auth:setup) or refresh credentials',
    };
  }

  // 3. Network infrastructure failures
  if (/econnrefused|enotfound|net::err_|err_connection|dns|gateway timeout|504|503/i.test(msg)) {
    return {
      category: 'network',
      reason: 'Network connectivity or target host unreachable',
      confidence: 0.85,
      isHealable: false,
      recommendedAction: 'FIX ENVIRONMENT: Ensure BASE_URL and backend mock servers are running',
    };
  }

  // 4. Locator / Selector drift — checked BEFORE timing and console-error so a
  // locator timeout or a console-error-with-locator-signal is healed as a
  // locator issue, not mislabeled timing/application.
  const strongLocator =
    /locator\.|getby|strict mode violation|waiting for locator|tobevisible/i.test(msg);
  if (strongLocator) {
    return {
      category: 'locator',
      reason: 'Selector target changed or element not found in current DOM/accessibility tree',
      confidence: 0.85,
      isHealable: true,
      recommendedAction:
        'HEAL LOCATOR: Perform live exploration and reconcile with semantic locator',
    };
  }

  // 5. Frontend application JS exception (only when no locator signal).
  // 'unhandled exception' moved here from the 5xx branch so bare 5xx text still
  // maps to application but a plain JS crash is also captured.
  const hasConsoleError = manifest?.consoleLogs?.some(
    (c) =>
      c.type === 'error' &&
      /uncaught|exception|typeerror|referenceerror|failed to load/i.test(c.text),
  );
  if (
    hasConsoleError ||
    /unhandled exception|uncaught exception|typeerror:|referenceerror:/i.test(msg)
  ) {
    return {
      category: 'application',
      reason: 'Uncaught frontend application JavaScript exception detected in console',
      confidence: 0.9,
      isHealable: false,
      recommendedAction: 'FILE BUG: Application frontend crashed; report defect to developers',
    };
  }

  // 6. Timing / Timeout failures (locator-suffixed timeouts already returned at step 4)
  if (/timeout \d+ms exceeded|timed out waiting for/i.test(msg)) {
    return {
      category: 'timing',
      reason: 'Asynchronous operation or page load timed out',
      confidence: 0.8,
      isHealable: true,
      recommendedAction: 'FIX TEST: Adjust explicit wait condition or verify load performance',
    };
  }

  // 7. Visual / Canvas fallback
  if (/canvas|webgl|screenshot comparison|visual regression/i.test(msg)) {
    return {
      category: 'visual',
      reason: 'Visual assertion mismatch or non-semantic canvas element',
      confidence: 0.75,
      isHealable: true,
      recommendedAction: 'TRIAGE: Review screenshot diff or update baseline visual snapshot',
    };
  }

  return {
    category: 'unknown',
    reason: 'Failure cause could not be determined automatically from available evidence',
    confidence: 0.5,
    isHealable: false,
    recommendedAction: 'TRIAGE: Inspect test trace and logs manually',
  };
}
