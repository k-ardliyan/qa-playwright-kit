/**
 * Explore Policy & Evidence Resolver — Agent AI Integration Layer
 *
 * Decides whether live UI exploration is required before Model can proceed.
 * The resolver verifies durable evidence (selector catalog / page-map paths)
 * from disk; the policy never talks to a browser itself. Live snapshots are
 * delegated to the existing snapshot_page / discover_pages MCP tools.
 *
 * @module agents/integration/explore-policy
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeSourceHash } from '@/contracts';
import { ExploreDecision } from './types';

/**
 * Evidence outcome vocabulary used by the resolver.
 */
export type EvidenceResolution =
  | { outcome: 'matched'; hashes: Record<string, string> }
  | { outcome: 'missing' }
  | { outcome: 'stale'; hashes: Record<string, string> }
  | { outcome: 'role-mismatch'; hashes: Record<string, string> }
  | { outcome: 'invalid' };

/**
 * A piece of durable UI evidence to resolve.
 */
export interface EvidenceReference {
  /** Absolute or repo-relative path to the artifact. */
  path: string;
  /** Expected content hash when freshness matters. */
  expectedHash?: string;
  /** Expected role when the artifact is role-scoped (catalog pages). */
  expectedRole?: string;
}

/**
 * Options steering Explore policy evaluation.
 */
export interface ExplorePolicyContext {
  requirementPath: string;
  /** Workspace root used for deterministic evidence resolution. */
  repoRoot?: string;
  /** Evidence references recorded by a previous run (resume path). */
  evidence?: EvidenceReference[];
  /** When set, Explore is blocked outright with this reason. */
  blockedReason?: string;
  /** Flags that make live Explore recommended even with valid evidence. */
  flags?: {
    newFeature?: boolean;
    changed?: boolean;
    highRisk?: boolean;
  };
}

/**
 * Resolve evidence references against disk, computing content hashes.
 *
 * Outcomes:
 * - `matched` — every reference exists and its hash matches the expectation.
 * - `missing` — at least one referenced file does not exist.
 * - `stale` — every file exists but at least one hash differs.
 * - `role-mismatch` — a role-scoped artifact was captured for another role.
 * - `invalid` — no evidence references were provided at all.
 */
export function resolveEvidence(refs: EvidenceReference[], repoRoot: string): EvidenceResolution {
  if (refs.length === 0) {
    return { outcome: 'invalid' };
  }

  const hashes: Record<string, string> = {};
  let anyMissing = false;
  let anyStale = false;
  let anyRoleMismatch = false;

  for (const ref of refs) {
    const abs = path.isAbsolute(ref.path) ? ref.path : path.resolve(repoRoot, ref.path);
    if (!fs.existsSync(abs)) {
      anyMissing = true;
      continue;
    }
    let hash: string;
    try {
      hash = computeSourceHash(fs.readFileSync(abs, 'utf-8'));
    } catch {
      anyMissing = true;
      continue;
    }
    hashes[ref.path] = hash;
    if (ref.expectedHash !== undefined && ref.expectedHash !== hash) {
      anyStale = true;
    }
    if (ref.expectedRole !== undefined && !isRoleEvidenceMatch(abs, ref.expectedRole)) {
      anyRoleMismatch = true;
    }
  }

  if (anyRoleMismatch) return { outcome: 'role-mismatch', hashes };
  if (anyMissing) return { outcome: 'missing' };
  if (anyStale) return { outcome: 'stale', hashes };
  return { outcome: 'matched', hashes };
}

/**
 * Best-effort role check: a catalog file or its parent dir that names another
 * role (e.g. `artifacts/selector-catalog/<feature>/admin/` for `finance`) is
 * a mismatch.
 */
function isRoleEvidenceMatch(absPath: string, expectedRole: string): boolean {
  const needle = expectedRole.toLowerCase();
  const segs = absPath.split(/[\\/]/);
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].toLowerCase().includes(needle)) return true;
  }
  return false;
}

/**
 * Evaluate the Explore policy.
 *
 * Outcomes:
 * - `required` — evidence missing/stale/invalid; live exploration is mandatory.
 * - `recommended` — evidence valid but the feature is new/changed/high-risk.
 * - `satisfied` — evidence valid and fresh enough to proceed.
 * - `skipped` — evidence deliberately skipped (recorded reason).
 * - `blocked` — exploration cannot run (e.g. no session for a protected route).
 */
export function evaluateExplorePolicy(context: ExplorePolicyContext): ExploreDecision {
  const checkedAt = new Date().toISOString();
  const refs = context.evidence ?? [];
  const flags = context.flags ?? {};

  // Explicit block overrides everything: the caller states why exploration
  // cannot run. Set by the protocol layer when auth/session is missing.
  if (context.blockedReason !== undefined) {
    return {
      status: 'blocked',
      reason: context.blockedReason,
      evidencePaths: [],
      evidenceHashes: {},
      checkedAt,
    };
  }

  const resolution = resolveEvidence(refs, context.repoRoot ?? process.cwd());
  switch (resolution.outcome) {
    case 'invalid':
      return {
        status: 'required',
        reason:
          'No Explore evidence on record. Live exploration (snapshot_page/discover_pages) is required before Model.',
        evidencePaths: [],
        evidenceHashes: {},
        checkedAt,
      };
    case 'missing':
      return {
        status: 'required',
        reason:
          'Explore evidence is missing on disk (catalog references do not exist). Re-run exploration.',
        evidencePaths: [],
        evidenceHashes: {},
        checkedAt,
      };
    case 'stale':
      return {
        status: 'required',
        reason:
          'Explore evidence is stale (content hash changed since capture). Re-run exploration.',
        evidencePaths: [],
        evidenceHashes: resolution.hashes,
        checkedAt,
      };
    case 'role-mismatch':
      return {
        status: 'required',
        reason:
          'Explore evidence was captured for a different role. Re-capture with the role session.',
        evidencePaths: [],
        evidenceHashes: resolution.hashes,
        checkedAt,
      };
    case 'matched': {
      if (flags.newFeature || flags.changed || flags.highRisk) {
        return {
          status: 'recommended',
          reason:
            'Evidence is valid but the feature is flagged new/changed/high-risk — live exploration is recommended.',
          evidencePaths: refs.map((r) => r.path),
          evidenceHashes: resolution.hashes,
          checkedAt,
        };
      }
      return {
        status: 'satisfied',
        reason:
          'Selector catalog evidence exists and hashes match. Live exploration can be skipped.',
        evidencePaths: refs.map((r) => r.path),
        evidenceHashes: resolution.hashes,
        checkedAt,
      };
    }
  }
}
