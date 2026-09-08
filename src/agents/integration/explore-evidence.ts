/**
 * Auto-discovery of durable Explore evidence — Agent AI Integration Layer
 *
 * Locates selector-catalog evidence for a requirement on disk so the Explore
 * policy can be satisfied without re-capturing. Matched catalogs are returned
 * as evidence references (paths + hashes) — never raw DOM or browser refs.
 *
 * @module agents/integration/explore-evidence
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeSourceHash } from '@/contracts';
import type { EvidenceReference } from './explore-policy';

export interface ExploreCatalogMatch {
  evidence: EvidenceReference[];
  /** Catalogs that exist on disk but were already captured with auth for a
   *  different role than expected — callers may re-capture with the role. */
  roleMismatch: string[];
  /** Feature slug derived from the requirement filename. */
  feature: string;
}

const ALLOWED_FEATURE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function deriveFeatureSlug(requirementPath: string): string {
  const stem = path.basename(requirementPath).replace(/\.md$/i, '').toLowerCase();
  const sanitized = stem.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return ALLOWED_FEATURE_PATTERN.test(sanitized) ? sanitized : 'feature';
}

/**
 * Discover selector-catalog evidence for a requirement.
 *
 * Strategy:
 * 1. Look under `{repoRoot}/artifacts/selector-catalog/<feature>/` (feature slug
 *    from the requirement filename) plus an optional `page-map.json`.
 * 2. When role-aware, restrict candidates to catalogs whose path names the
 *    role; catalog files under a different role directory are reported as a
 *    role mismatch so the pipeline can re-capture instead of guessing.
 * 3. Return durable paths + content hashes. No evidence → empty list, which
 *    the Explore policy turns into `required`.
 */
export function discoverExploreEvidence(
  requirementPath: string,
  role?: string,
  repoRoot: string = process.cwd(),
): ExploreCatalogMatch {
  const feature = deriveFeatureSlug(requirementPath);
  const dir = path.join(repoRoot, 'artifacts', 'selector-catalog', feature);
  const evidence: EvidenceReference[] = [];
  const roleMismatch: string[] = [];

  if (!fs.existsSync(dir)) {
    return { evidence, roleMismatch, feature };
  }

  const candidates: string[] = [];
  const pageMap = path.join(dir, 'page-map.json');
  if (fs.existsSync(pageMap)) candidates.push(pageMap);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(json|yaml|yml)$/i.test(entry.name)) {
      if (entry.name === 'page-map.json') continue;
      candidates.push(path.join(dir, entry.name));
    } else if (entry.isDirectory()) {
      for (const f of fs.readdirSync(path.join(dir, entry.name))) {
        if (/\.(json|yaml|yml)$/i.test(f)) {
          candidates.push(path.join(dir, entry.name, f));
        }
      }
    }
  }

  for (const candidate of candidates) {
    const rel = path.relative(repoRoot, candidate).replace(/\\/g, '/');
    if (role) {
      const lower = rel.toLowerCase();
      const roleMatch = lower.includes(role.toLowerCase());
      if (!roleMatch) {
        // Catalogs captured with another role are a mismatch — never reuse them.
        roleMismatch.push(rel);
        continue;
      }
    }

    let hash: string;
    try {
      hash = computeSourceHash(fs.readFileSync(candidate, 'utf-8'));
    } catch {
      continue;
    }
    evidence.push({ path: rel, expectedHash: hash, ...(role ? { expectedRole: role } : {}) });
  }

  return { evidence, roleMismatch, feature };
}
