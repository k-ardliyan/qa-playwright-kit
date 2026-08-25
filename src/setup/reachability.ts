/**
 * Setup Wizard — shared reachability predicate.
 *
 * Single source: prompt (wizard-prompts.ts) + validation (wizard-validate.ts)
 * must agree on what "alive" means. Was duplicated before; now centralized.
 *
 * @module src/setup/reachability
 */

/** True when an HTTP status proves the app is alive. */
export function isReachableStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 302 || status === 304 || status === 401;
}

/** HEAD check with 5s timeout; network failure → false. */
export async function checkReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return isReachableStatus(res.status);
  } catch {
    return false;
  }
}
