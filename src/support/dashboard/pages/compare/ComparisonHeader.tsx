/** @jsxImportSource @kitajs/html */
import type { ComparisonRunIdentity } from '../../domain/comparison';

export interface ComparisonHeaderProps {
  baseline?: ComparisonRunIdentity;
  candidate?: ComparisonRunIdentity;
  passRateDelta: number;
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta.toFixed(1)}%`;
  if (delta < 0) return `${delta.toFixed(1)}%`;
  return '0.0%';
}

export function ComparisonHeader({ baseline, candidate, passRateDelta }: ComparisonHeaderProps) {
  if (!baseline || !candidate) return null;

  const deltaStr = formatDelta(passRateDelta);
  const deltaClass =
    passRateDelta > 0 ? 'delta-positive' : passRateDelta < 0 ? 'delta-negative' : 'delta-neutral';

  return (
    <div class="comparison-hero">
      <div class="comparison-run-card baseline-card">
        <span class="run-role-label">BASELINE</span>
        <h3 class="run-name" title={baseline.displayName} safe>
          {baseline.displayName}
        </h3>
        <div class="run-meta-row">
          <span class="env-tag" safe>
            {baseline.appEnv}
          </span>
          <span class="run-date muted">
            {baseline.ranAt ? new Date(baseline.ranAt).toLocaleDateString('en-GB') : ''}
          </span>
        </div>
        <div class="run-pass-rate">
          <strong class="font-mono">{baseline.passRate}%</strong>{' '}
          <span class="muted font-mono">({baseline.totalTests} tests)</span>
        </div>
        <div class="run-id-subtle muted font-mono" safe>
          {baseline.runId}
        </div>
      </div>

      <div class={`comparison-vs-badge ${deltaClass}`}>
        <span class="vs-label">VS</span>
        <span class="delta-value font-mono" safe>
          {deltaStr}
        </span>
        <span class="delta-subtext">
          {passRateDelta > 0 ? 'Improvement' : passRateDelta < 0 ? 'Regression' : 'No Change'}
        </span>
      </div>

      <div class="comparison-run-card candidate-card">
        <span class="run-role-label">CANDIDATE</span>
        <h3 class="run-name" title={candidate.displayName} safe>
          {candidate.displayName}
        </h3>
        <div class="run-meta-row">
          <span class="env-tag" safe>
            {candidate.appEnv}
          </span>
          <span class="run-date muted">
            {candidate.ranAt ? new Date(candidate.ranAt).toLocaleDateString('en-GB') : ''}
          </span>
        </div>
        <div class="run-pass-rate">
          <strong class="font-mono">{candidate.passRate}%</strong>{' '}
          <span class="muted font-mono">({candidate.totalTests} tests)</span>
        </div>
        <div class="run-id-subtle muted font-mono" safe>
          {candidate.runId}
        </div>
      </div>
    </div>
  );
}
