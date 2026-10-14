/**
 * Domain types and comparison safety guards for Cross-Run Report Comparison.
 *
 * @module src/support/dashboard/domain/comparison
 */

export interface ComparisonRunIdentity {
  runId: string;
  displayName: string;
  testSeriesId?: string;
  requirementId?: string;
  appEnv: string;
  ranAt: string;
  passRate: number;
  totalTests: number;
}

export type CompatibilityLevel = 'exact' | 'compatible' | 'partial' | 'mismatch';

export interface ComparisonCompatibility {
  level: CompatibilityLevel;
  reasons: string[];
  overlapRatio: number;
  scenarioIntersectionCount: number;
  scenarioUnionCount: number;
  sameTestSeries: boolean;
  sameEnvironment: boolean;
}

export interface ScenarioDiff {
  scenarioId: string;
  name: string;
  role?: string;
  module?: string;
  feature?: string;
  previousStatus: string;
  currentStatus: string;
  /** 'regression' | 'fix' | 'stable' | 'flaky' | 'new' | 'removed' | 'unchanged' */
  change: string;
  failureSource?: string;
  previousError?: string;
  currentError?: string;
}

export interface ReportComparison {
  baselineRunId: string;
  comparisonRunId: string;
  baselineTimestamp: string;
  comparisonTimestamp: string;
  baselinePassRate: number;
  comparisonPassRate: number;
  passRateDelta: number;
  baseline?: ComparisonRunIdentity;
  candidate?: ComparisonRunIdentity;
  compatibility?: ComparisonCompatibility;
  isCandidateOlder?: boolean;
  regressions: ScenarioDiff[];
  fixes: ScenarioDiff[];
  newScenarios: ScenarioDiff[];
  removedScenarios: ScenarioDiff[];
  stableFailures: ScenarioDiff[];
  flakyScenarios: ScenarioDiff[];
  summary: {
    totalScenarios: number;
    regressed: number;
    fixed: number;
    new: number;
    removed: number;
    stableFailures: number;
    flaky: number;
  };
}
