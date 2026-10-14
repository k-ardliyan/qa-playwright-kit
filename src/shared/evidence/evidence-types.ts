import type { NormalizedNetworkEvidence } from '../types/network-evidence.types';

export type ExtendedFailureCategory =
  | 'locator'
  | 'auth'
  | 'network'
  | 'timing'
  | 'application'
  | 'environment'
  | 'visual'
  | 'unknown';

export interface NormalizedConsoleEntry {
  type: 'error' | 'warning' | 'info' | 'log';
  text: string;
  timestamp: string;
  location?: string;
}

export interface VideoChapter {
  title: string;
  timestampMs: number;
}

export interface StorageDiagnosticEvidence {
  role?: string;
  environment?: string;
  storagePath?: string;
  exists: boolean;
  valid?: boolean;
  reason?: string;
}

export interface EvidenceManifest {
  version: '1.0';
  runId: string;
  testId: string;
  testTitle?: string;
  attempt: number;
  environment: string;
  role?: string;
  failureCategory: ExtendedFailureCategory;
  failureReason?: string;
  errorMessage?: string;
  snapshotPath?: string;
  screenshotPath?: string;
  tracePath?: string;
  videoPath?: string;
  videoChapters?: VideoChapter[];
  renderedPdfPath?: string;
  consoleLogs?: NormalizedConsoleEntry[];
  networkRequests?: NormalizedNetworkEvidence[];
  storageDiagnostic?: StorageDiagnosticEvidence;
  timestamp: string;
}

export interface HealerProvenanceRecord {
  healed: boolean;
  reason: string;
  failureCategory: ExtendedFailureCategory;
  oldTarget?: string;
  newTarget?: string;
  liveVerified: boolean;
  evidencePaths: string[];
  appliedAt: string;
}
