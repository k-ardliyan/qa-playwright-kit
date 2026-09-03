/**
 * Healer Pattern Database — CRUD Operations
 *
 * Manages persistent storage of heal patterns in `heal-patterns.json`.
 * Patterns map failure signatures to known fix templates with confidence tracking.
 *
 * Key behaviors:
 * - Store new patterns with confidence 1.0, successCount 1, failureCount 0
 * - Update confidence on success/failure: confidence = S / (S + F)
 * - Enforce 500-pattern capacity, pruning lowest-confidence first
 * - Expire patterns not applied within 30 days
 * - Auto-expire patterns with confidence < 0.3 and failureCount > 3
 * - Prevent duplicates via exact signature matching
 *
 * @module agents/healer/pattern-database
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { FailureSignature, FixTemplate, HealPattern } from '@/shared/types';
import type { HealPatternDatabase, HealPatternRecord } from '@/shared/types/heal-patterns.schema';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DB_PATH = path.join('artifacts', 'reports', 'heal-patterns.json');
const MAX_PATTERNS = 500;
const EXPIRY_DAYS = 30;
const LOW_CONFIDENCE_THRESHOLD = 0.3;
const LOW_CONFIDENCE_FAILURE_THRESHOLD = 3;

// ─── Public Functions ─────────────────────────────────────────────────────────

/**
 * Loads the heal pattern database from disk.
 *
 * On file-not-found: creates a new empty database without backup or warning (Req 14.4).
 * On JSON parse or schema validation failure: backs up the corrupted file as
 * `heal-patterns.backup.json` in the same directory, initializes a fresh empty database
 * with version '1.0' and empty patterns array, and logs a warning with the backup path
 * (Req 14.1, 14.2, 14.3).
 *
 * @param dbPath - Optional path override for the database file
 * @returns The loaded or freshly initialized database
 */
export function loadDatabase(dbPath?: string): HealPatternDatabase {
  const filePath = dbPath ?? DEFAULT_DB_PATH;

  // Req 14.4: File not found → create fresh empty database without backup or warning
  if (!fs.existsSync(filePath)) {
    return createEmptyDatabase();
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as HealPatternDatabase;

    // Basic schema validation
    if (!isValidDatabase(parsed)) {
      // Schema validation failure → treat as corruption
      return handleCorruptedDatabase(filePath);
    }

    return parsed;
  } catch {
    // JSON parse error → treat as corruption
    return handleCorruptedDatabase(filePath);
  }
}

/**
 * Handles a corrupted database file by creating a backup, logging a warning,
 * and returning a fresh empty database.
 *
 * Requirements: 14.1, 14.2, 14.3
 *
 * @param filePath - Path to the corrupted database file
 * @returns A fresh empty database
 */
function handleCorruptedDatabase(filePath: string): HealPatternDatabase {
  const dir = path.dirname(filePath);
  const backupPath = path.join(dir, 'heal-patterns.backup.json');

  // Req 14.1: Backup the corrupted file (overwriting any previous backup)
  fs.copyFileSync(filePath, backupPath);

  // Req 14.3: Log warning with backup file path
  console.warn(
    `[healer] Pattern database corrupted. Backup saved to: ${backupPath}. Initializing fresh database.`,
  );

  // Req 14.2: Initialize fresh empty database with version '1.0' and empty patterns array
  return createEmptyDatabase();
}

/**
 * Saves the database to disk, creating parent directories if needed.
 *
 * @param db - The database to persist
 * @param dbPath - Optional path override for the database file
 */
export function saveDatabase(db: HealPatternDatabase, dbPath?: string): void {
  const filePath = dbPath ?? DEFAULT_DB_PATH;
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const updated: HealPatternDatabase = {
    ...db,
    lastUpdated: new Date().toISOString(),
    statistics: computeStatistics(db.patterns),
  };

  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
}

/**
 * Stores a new pattern or updates an existing one.
 *
 * Behavior:
 * - If exact signature match exists → record outcome (success/failure)
 * - If new → create with confidence 1.0, successCount 1, failureCount 0
 * - Prune expired patterns (30-day inactivity, low confidence auto-expiry)
 * - Enforce 500 capacity limit by removing lowest-confidence patterns
 *
 * @param db - Current database state
 * @param signature - The failure signature to store
 * @param fix - The fix template that resolved the failure
 * @param success - Whether the fix was applied successfully
 * @returns A new database instance with the pattern stored
 */
export function storePattern(
  db: HealPatternDatabase,
  signature: FailureSignature,
  fix: FixTemplate,
  success: boolean,
): HealPatternDatabase {
  const now = new Date();
  let patterns = [...db.patterns];

  // Check for exact signature match (Req 5.8)
  const existingIndex = patterns.findIndex((p) => signaturesMatch(p.signature, signature));

  if (existingIndex >= 0) {
    // Update existing pattern
    const existing = patterns[existingIndex];
    const updatedSuccessCount = existing.successCount + (success ? 1 : 0);
    const updatedFailureCount = existing.failureCount + (success ? 0 : 1);
    const updatedConfidence = updatedSuccessCount / (updatedSuccessCount + updatedFailureCount);

    const updated: HealPatternRecord = {
      ...existing,
      fix, // Update fix template to latest
      confidence: updatedConfidence,
      successCount: updatedSuccessCount,
      failureCount: updatedFailureCount,
      lastApplied: now.toISOString(),
      expiresAt: computeExpiryDate(now).toISOString(),
    };

    patterns[existingIndex] = updated;
  } else {
    // Create new pattern (Req 5.1)
    const newPattern: HealPatternRecord = {
      id: crypto.randomUUID(),
      signature,
      fix,
      confidence: 1.0,
      successCount: 1,
      failureCount: 0,
      createdAt: now.toISOString(),
      lastApplied: now.toISOString(),
      expiresAt: computeExpiryDate(now).toISOString(),
      tags: inferTags(signature),
      metadata: {
        createdBy: 'healer',
      },
    };

    patterns.push(newPattern);
  }

  // Prune expired patterns (Req 5.6, 5.7)
  patterns = pruneExpiredPatterns(patterns, now);

  // Enforce capacity limit (Req 5.5)
  patterns = enforceCapacityLimit(patterns);

  return {
    ...db,
    version: '1.0',
    lastUpdated: now.toISOString(),
    patterns,
    statistics: computeStatistics(patterns),
  };
}

/**
 * Records a success or failure outcome for an existing pattern.
 *
 * Updates confidence = successCount / (successCount + failureCount).
 *
 * @param db - Current database state
 * @param patternId - The ID of the pattern to update
 * @param success - Whether the pattern application succeeded
 * @returns A new database instance with updated confidence
 */
export function recordPatternOutcome(
  db: HealPatternDatabase,
  patternId: string,
  success: boolean,
): HealPatternDatabase {
  const now = new Date();
  const patterns = db.patterns.map((p) => {
    if (p.id !== patternId) return p;

    const updatedSuccessCount = p.successCount + (success ? 1 : 0);
    const updatedFailureCount = p.failureCount + (success ? 0 : 1);
    const updatedConfidence = updatedSuccessCount / (updatedSuccessCount + updatedFailureCount);

    return {
      ...p,
      confidence: updatedConfidence,
      successCount: updatedSuccessCount,
      failureCount: updatedFailureCount,
      lastApplied: now.toISOString(),
      expiresAt: computeExpiryDate(now).toISOString(),
    };
  });

  return {
    ...db,
    version: '1.0',
    lastUpdated: now.toISOString(),
    patterns,
    statistics: computeStatistics(patterns),
  };
}

/**
 * Prunes expired and low-confidence patterns from the database.
 *
 * Removes:
 * - Patterns not applied within 30 days (Req 5.6)
 * - Patterns with confidence < 0.3 and failureCount > 3 (Req 5.7)
 * - Lowest-confidence patterns when over 500 capacity (Req 5.5)
 *
 * @param db - Current database state
 * @returns A new database instance with expired patterns removed
 */
export function prunePatterns(db: HealPatternDatabase): HealPatternDatabase {
  const now = new Date();
  let patterns = pruneExpiredPatterns([...db.patterns], now);
  patterns = enforceCapacityLimit(patterns);

  return {
    ...db,
    version: '1.0',
    lastUpdated: now.toISOString(),
    patterns,
    statistics: computeStatistics(patterns),
  };
}

/**
 * Finds an existing pattern with an exact signature match.
 *
 * "Exact match" means errorType, errorPattern, selectorType, and pageContext all match.
 *
 * @param db - Current database state
 * @param signature - The failure signature to search for
 * @returns The matching pattern, or null if none found
 */
export function findBySignature(
  db: HealPatternDatabase,
  signature: FailureSignature,
): HealPattern | null {
  return db.patterns.find((p) => signaturesMatch(p.signature, signature)) ?? null;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Creates a fresh empty database conforming to the schema.
 */
export function createEmptyDatabase(): HealPatternDatabase {
  return {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    patterns: [],
    statistics: {
      totalPatterns: 0,
      totalApplications: 0,
      overallSuccessRate: 0,
    },
  };
}

/**
 * Checks whether two failure signatures are an exact match.
 *
 * Matches on: errorType, errorPattern, selectorType, and pageContext.
 */
function signaturesMatch(a: FailureSignature, b: FailureSignature): boolean {
  return (
    a.errorType === b.errorType &&
    a.errorPattern === b.errorPattern &&
    (a.selectorType ?? '') === (b.selectorType ?? '') &&
    (a.pageContext ?? '') === (b.pageContext ?? '')
  );
}

/**
 * Computes the expiry date as 30 days from the given date.
 */
function computeExpiryDate(from: Date): Date {
  const expiry = new Date(from);
  expiry.setDate(expiry.getDate() + EXPIRY_DAYS);
  return expiry;
}

/**
 * Removes patterns that are expired by time (30-day inactivity)
 * or by auto-expiry rules (confidence < 0.3 and failureCount > 3).
 */
function pruneExpiredPatterns(patterns: HealPatternRecord[], now: Date): HealPatternRecord[] {
  return patterns.filter((p) => {
    // Req 5.6: Expired if not applied within 30 days
    const expiresAt = new Date(p.expiresAt);
    if (now > expiresAt) {
      return false;
    }

    // Req 5.7: Auto-expire if confidence < 0.3 and failureCount > 3
    if (
      p.confidence < LOW_CONFIDENCE_THRESHOLD &&
      p.failureCount > LOW_CONFIDENCE_FAILURE_THRESHOLD
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Enforces the 500-pattern capacity limit by removing lowest-confidence patterns first.
 */
function enforceCapacityLimit(patterns: HealPatternRecord[]): HealPatternRecord[] {
  if (patterns.length <= MAX_PATTERNS) {
    return patterns;
  }

  // Sort by confidence descending — keep highest confidence patterns
  const sorted = [...patterns].sort((a, b) => b.confidence - a.confidence);
  return sorted.slice(0, MAX_PATTERNS);
}

/**
 * Computes aggregate statistics for the pattern collection.
 */
function computeStatistics(patterns: HealPatternRecord[]): HealPatternDatabase['statistics'] {
  const totalPatterns = patterns.length;
  const totalApplications = patterns.reduce((sum, p) => sum + p.successCount + p.failureCount, 0);
  const totalSuccesses = patterns.reduce((sum, p) => sum + p.successCount, 0);
  const overallSuccessRate = totalApplications > 0 ? totalSuccesses / totalApplications : 0;

  return {
    totalPatterns,
    totalApplications,
    overallSuccessRate,
  };
}

/**
 * Infers categorization tags from the failure signature.
 */
function inferTags(signature: FailureSignature): string[] {
  const tags: string[] = [];

  switch (signature.errorType) {
    case 'timeout':
      tags.push('timing');
      break;
    case 'locator':
      tags.push('locator-drift');
      break;
    case 'assertion':
      tags.push('state');
      break;
    case 'state':
      tags.push('state');
      break;
    default:
      tags.push(signature.errorType);
  }

  if (signature.selectorType) {
    tags.push(`selector:${signature.selectorType}`);
  }

  return tags;
}

/**
 * Basic schema validation for a loaded database object.
 */
function isValidDatabase(obj: unknown): obj is HealPatternDatabase {
  if (typeof obj !== 'object' || obj === null) return false;

  const db = obj as Record<string, unknown>;

  if (db.version !== '1.0') return false;
  if (typeof db.lastUpdated !== 'string') return false;
  if (!Array.isArray(db.patterns)) return false;
  if (typeof db.statistics !== 'object' || db.statistics === null) return false;

  return true;
}
