import { type FailureRootCause } from '../contracts/traceability-contract';

export interface ClassifiedFailure {
  category: 'application' | 'auth' | 'network' | 'locator' | 'timing' | 'visual' | 'unknown';
  source: FailureRootCause;
  reason: string;
  confidence: number;
  isHealable: boolean;
}

/**
 * Classify a test failure message into a FailureRootCause category:
 * 'app' | 'test' | 'requirement' | 'env' | 'ai_generation' | 'unknown'
 */
export function classifyFailureError(errorMessage?: string): ClassifiedFailure {
  const msg = (errorMessage || '').toLowerCase();

  // 1. Application backend defect
  if (/\b5\d\d\b|internal server error|database error|sqlstate|status 5\d\d/i.test(msg)) {
    return {
      category: 'application',
      source: 'app',
      reason: 'Application backend returned 5xx server error during execution',
      confidence: 0.95,
      isHealable: false,
    };
  }

  // 2. Auth / Environment
  if (
    /storage.?state|unauthorized|401|403|login required|session expired|redirected to login|sign in required|credentials expired/i.test(
      msg,
    )
  ) {
    return {
      category: 'auth',
      source: 'env',
      reason: 'Authentication session is missing, invalid, or expired',
      confidence: 0.9,
      isHealable: false,
    };
  }

  // 3. Network infrastructure / Environment
  if (/econnrefused|enotfound|net::err_|err_connection|dns|gateway timeout/i.test(msg)) {
    return {
      category: 'network',
      source: 'env',
      reason: 'Network connectivity or target host unreachable',
      confidence: 0.85,
      isHealable: false,
    };
  }

  // 4. Strong locator failure -> 'test'
  if (/locator\.|getby|strict mode violation|waiting for locator|tobevisible/i.test(msg)) {
    return {
      category: 'locator',
      source: 'test',
      reason: 'Selector target changed or element not found in current DOM',
      confidence: 0.85,
      isHealable: true,
    };
  }

  // 5. Uncaught frontend JS exception -> 'app'
  if (/unhandled exception|uncaught exception|typeerror:|referenceerror:/i.test(msg)) {
    return {
      category: 'application',
      source: 'app',
      reason: 'Uncaught frontend application JavaScript exception detected',
      confidence: 0.9,
      isHealable: false,
    };
  }

  // 6. Timing / Timeout -> 'test'
  if (/timeout \d+ms exceeded|timed out waiting for/i.test(msg)) {
    return {
      category: 'timing',
      source: 'test',
      reason: 'Asynchronous operation or page load timed out',
      confidence: 0.8,
      isHealable: true,
    };
  }

  // 7. Visual / Canvas -> 'test'
  if (/canvas|webgl|screenshot comparison|visual regression/i.test(msg)) {
    return {
      category: 'visual',
      source: 'test',
      reason: 'Visual assertion mismatch or non-semantic canvas element',
      confidence: 0.75,
      isHealable: true,
    };
  }

  return {
    category: 'unknown',
    source: 'unknown',
    reason: 'Failure cause could not be determined automatically from message',
    confidence: 0.5,
    isHealable: false,
  };
}
