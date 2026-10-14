/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';
import type { ReportComparison } from '../../domain/comparison';
import {
  IconCross,
  IconCheck,
  IconAlert,
  IconSwap,
  IconFlame,
  IconTrash,
} from '../../components/shared/icons';

export interface ComparisonStatsProps {
  summary: ReportComparison['summary'];
}

export function ComparisonStats({ summary }: ComparisonStatsProps) {
  const items: Array<{
    count: number;
    label: string;
    icon: Children;
    cls: string;
  }> = [
    {
      count: summary.regressed,
      label: 'Regressions',
      icon: <IconCross size={14} />,
      cls: 'stat-regressed',
    },
    { count: summary.fixed, label: 'Fixes', icon: <IconCheck size={14} />, cls: 'stat-fixed' },
    {
      count: summary.stableFailures,
      label: 'Stable Failures',
      icon: <IconAlert size={14} />,
      cls: 'stat-stable',
    },
    { count: summary.flaky, label: 'Flaky', icon: <IconSwap size={14} />, cls: 'stat-flaky' },
    { count: summary.new, label: 'New', icon: <IconFlame size={14} />, cls: 'stat-new' },
    {
      count: summary.removed,
      label: 'Removed',
      icon: <IconTrash size={14} />,
      cls: 'stat-removed',
    },
  ];

  return (
    <div class="comparison-stats-row">
      {items.map((item) => (
        <div
          class={`comparison-stat-card ${item.cls} ${item.count > 0 ? 'has-count' : 'zero-count'}`}
        >
          <span class="comparison-stat-card__icon">{item.icon}</span>
          <span class="comparison-stat-card__count font-mono">{item.count}</span>
          <span class="comparison-stat-card__label" safe>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
