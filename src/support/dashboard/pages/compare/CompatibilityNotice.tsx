/** @jsxImportSource @kitajs/html */
import type { ComparisonCompatibility } from '../../domain/comparison';
import { IconCheck, IconInfo, IconAlert, IconCross, IconSwap } from '../../components/shared/icons';

export interface CompatibilityNoticeProps {
  compatibility?: ComparisonCompatibility;
  isCandidateOlder?: boolean;
  baselineRunId?: string;
  candidateRunId?: string;
}

export function CompatibilityNotice({
  compatibility,
  isCandidateOlder = false,
  baselineRunId,
  candidateRunId,
}: CompatibilityNoticeProps) {
  if (!compatibility) return null;

  const { level, reasons, overlapRatio } = compatibility;
  const overlapPercent = Math.round(overlapRatio * 100);

  const levelClass =
    level === 'exact'
      ? 'notice-success'
      : level === 'compatible'
        ? 'notice-info'
        : level === 'partial'
          ? 'notice-warning'
          : 'notice-danger';

  const levelIcon =
    level === 'exact' ? (
      <IconCheck size={20} class="icon-success" />
    ) : level === 'compatible' ? (
      <IconInfo size={20} class="icon-info" />
    ) : level === 'partial' ? (
      <IconAlert size={20} class="icon-warning" />
    ) : (
      <IconCross size={20} class="icon-danger" />
    );

  const levelTitle =
    level === 'exact'
      ? 'Exact Match — High Confidence Comparison'
      : level === 'compatible'
        ? 'Compatible Test Runs'
        : level === 'partial'
          ? 'Partial Scenario Overlap'
          : 'Suite Scope Mismatch — Low Confidence';

  const swapUrl =
    baselineRunId && candidateRunId
      ? `/compare?baseline=${encodeURIComponent(candidateRunId)}&candidate=${encodeURIComponent(baselineRunId)}`
      : 'javascript:swapPickerRuns && swapPickerRuns()';

  return (
    <div class={`compatibility-notice ${levelClass}`} id="compatibility-notice">
      <div class="compatibility-notice__head">
        <span class="compatibility-notice__icon">{levelIcon}</span>
        <div>
          <h4 class="compatibility-notice__title">{levelTitle}</h4>
          <p class="compatibility-notice__overlap muted">
            Scenario Overlap: <strong class="font-mono">{overlapPercent}%</strong>
          </p>
        </div>
      </div>

      {reasons && reasons.length > 0 ? (
        <ul class="compatibility-notice__reasons">
          {reasons.map((reason) => (
            <li safe>{reason}</li>
          ))}
        </ul>
      ) : null}

      {isCandidateOlder ? (
        <div class="compatibility-notice__warning">
          <div class="warning-text">
            <IconAlert size={15} class="icon-warning" />
            <span>Candidate was executed before Baseline (reversed chronological order).</span>
          </div>
          <a href={swapUrl} class="btn-sm btn-swap-action">
            <IconSwap size={13} />
            <span>Swap to Chronological Order</span>
          </a>
        </div>
      ) : null}
    </div>
  );
}
