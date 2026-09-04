/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';

export interface DataTableRowProps {
  class?: string;
  onclick?: string;
  onkeydown?: string;
  tabindex?: number;
  role?: string;
  id?: string;
  'data-run-id'?: string;
  'data-test-id'?: string;
  'data-status'?: string;
  'data-display-name'?: string;
  'data-series'?: string;
  'data-req'?: string;
  'data-decision'?: string;
  'data-notes'?: string;
  children: Children;
  [key: string]: unknown;
}

export function DataTableRow({
  class: className = '',
  onclick,
  onkeydown,
  tabindex,
  role,
  id,
  children,
  ...rest
}: DataTableRowProps) {
  return (
    <tr
      class={className || undefined}
      onclick={onclick}
      onkeydown={onkeydown}
      tabindex={tabindex}
      role={role}
      id={id}
      {...rest}
    >
      {children}
    </tr>
  );
}
