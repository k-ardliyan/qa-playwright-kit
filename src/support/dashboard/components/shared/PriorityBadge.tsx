/** @jsxImportSource @kitajs/html */
export interface PriorityBadgeProps {
  priority?: string;
}

export function PriorityBadge({ priority = 'medium' }: PriorityBadgeProps) {
  const p = (priority || 'medium').toLowerCase();
  const cls = `priority-badge priority-badge--${p}`;
  const label = (priority || 'MEDIUM').toUpperCase();

  return (
    <span class={cls} role="img" aria-label={`Priority: ${label}`} safe>
      {label}
    </span>
  );
}
