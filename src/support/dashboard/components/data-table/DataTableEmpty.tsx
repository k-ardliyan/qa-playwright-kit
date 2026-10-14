/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';

export interface DataTableEmptyProps {
  message?: string;
  submessage?: string;
  icon?: Children;
  children?: Children;
}

export function DataTableEmpty({
  message = 'No data available.',
  submessage,
  icon,
  children,
}: DataTableEmptyProps) {
  return (
    <div class="empty-state">
      {icon ? (
        <div class="empty-state__icon" safe>
          {icon}
        </div>
      ) : null}
      <p class="empty-state__msg" safe>
        {message}
      </p>
      {submessage ? (
        <p class="empty-state__submsg muted" safe>
          {submessage}
        </p>
      ) : null}
      {children || null}
    </div>
  );
}
