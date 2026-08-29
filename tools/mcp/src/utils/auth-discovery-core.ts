export interface AuthenticatedDiscoveryOptions {
  enabled: boolean;
  role: string;
  environment: string;
  rootUrl: string;
  allowedOrigins: string[];
  maxPages?: number;
  skipLogoutPatterns?: string[];
}

export interface DiscoverySafetyEvaluation {
  safe: boolean;
  violations: string[];
}

const DEFAULT_SKIP_PATTERNS = [
  /\/logout/i,
  /\/signout/i,
  /\/delete/i,
  /\/destroy/i,
  /\/reset/i,
  /\/drop/i,
];

/**
 * Validate authenticated page discovery options against safety contract.
 */
export function evaluateDiscoverySafety(
  options: AuthenticatedDiscoveryOptions,
): DiscoverySafetyEvaluation {
  const violations: string[] = [];

  if (!options.enabled) {
    violations.push('Authenticated discovery requires explicit opt-in (enabled: true)');
  }

  if (!options.role || options.role.trim().length === 0) {
    violations.push('Authenticated discovery requires a specific auth role');
  }

  if (!options.allowedOrigins || options.allowedOrigins.length === 0) {
    violations.push(
      'Allowed origins must be explicitly specified to prevent crawling outside target scope',
    );
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/**
 * Check if a URL should be skipped to prevent destructive or logout actions during discovery.
 */
export function isDestructiveOrLogoutUrl(url: string, customPatterns?: string[]): boolean {
  const patterns = [
    ...DEFAULT_SKIP_PATTERNS,
    ...(customPatterns ? customPatterns.map((p) => new RegExp(p, 'i')) : []),
  ];
  return patterns.some((p) => p.test(url));
}
