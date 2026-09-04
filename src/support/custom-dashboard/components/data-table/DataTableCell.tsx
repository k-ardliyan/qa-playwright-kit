/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';

export interface DataTableCellProps {
  isHeader?: boolean;
  class?: string;
  colspan?: number;
  rowspan?: number;
  title?: string;
  onclick?: string;
  'data-col'?: string;
  safe?: boolean;
  scope?: string;
  children?: Children;
}

export function DataTableCell({
  isHeader = false,
  class: className = '',
  colspan,
  rowspan,
  title,
  onclick,
  'data-col': dataCol,
  safe,
  scope,
  children,
}: DataTableCellProps) {
  if (isHeader) {
    return (
      <th
        class={className || undefined}
        colspan={colspan}
        rowspan={rowspan}
        title={title}
        onclick={onclick}
        data-col={dataCol}
        scope={scope}
        safe={safe}
      >
        {children}
      </th>
    );
  }
  return (
    <td
      class={className || undefined}
      colspan={colspan}
      rowspan={rowspan}
      title={title}
      onclick={onclick}
      data-col={dataCol}
      safe={safe}
    >
      {children}
    </td>
  );
}
