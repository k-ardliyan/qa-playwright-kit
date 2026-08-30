import { buildHashRouterJs } from '../build-hash-router';

/**
 * Hash router export bridge for client subsystem.
 */
export function buildRouterJs(): string {
  return buildHashRouterJs();
}
