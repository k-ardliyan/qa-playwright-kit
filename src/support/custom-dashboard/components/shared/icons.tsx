/** @jsxImportSource @kitajs/html */

/*
 * Lucide icon set (ISC licensed) — geometry inlined from lucide-static so
 * the dashboard keeps zero runtime dependencies and renders offline.
 *
 * Every icon inherits `currentColor` and takes an explicit pixel size, so a
 * caller can tint it by setting `color` on the icon or any ancestor.
 *
 * Generated file — do not hand-edit individual paths.
 */

export interface IconProps {
  size?: number;
  class?: string;
}

const SVG_BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.75',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

export function IconActivity({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-activity${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </svg>
  );
}

export function IconArrowLeft({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-arrow-left${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function IconArrowRight({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-arrow-right${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function IconArrowRightLeft({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-arrow-right-left${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </svg>
  );
}

export function IconArrowUpDown({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-arrow-up-down${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m21 16-4 4-4-4" />
      <path d="M17 20V4" />
      <path d="m3 8 4-4 4 4" />
      <path d="M7 4v16" />
    </svg>
  );
}

export function IconBadgeCheck({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-badge-check${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m16 9-5.5 5.5L8 12" />
    </svg>
  );
}

export function IconBadgeX({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-badge-x${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <line x1="15" x2="9" y1="9" y2="15" />
      <line x1="9" x2="15" y1="9" y2="15" />
    </svg>
  );
}

export function IconBan({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-ban${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M4.929 4.929 19.07 19.071" />
    </svg>
  );
}

export function IconBell({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-bell${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </svg>
  );
}

export function IconBoxes({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-boxes${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" />
      <path d="m7 16.5-4.74-2.85" />
      <path d="m7 16.5 5-3" />
      <path d="M7 16.5v5.17" />
      <path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" />
      <path d="m17 16.5-5-3" />
      <path d="m17 16.5 4.74-2.85" />
      <path d="M17 16.5v5.17" />
      <path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" />
      <path d="M12 8 7.26 5.15" />
      <path d="m12 8 4.74-2.85" />
      <path d="M12 13.5V8" />
    </svg>
  );
}

export function IconBug({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-bug${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 20v-9" />
      <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
      <path d="M14.12 3.88 16 2" />
      <path d="M21 21a4 4 0 0 0-3.81-4" />
      <path d="M21 5a4 4 0 0 1-3.55 3.97" />
      <path d="M22 13h-4" />
      <path d="M3 21a4 4 0 0 1 3.81-4" />
      <path d="M3 5a4 4 0 0 0 3.55 3.97" />
      <path d="M6 13H2" />
      <path d="m8 2 1.88 1.88" />
      <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
    </svg>
  );
}

export function IconCalendar({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-calendar${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
    </svg>
  );
}

export function IconChartPie({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-chart-pie${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" />
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    </svg>
  );
}

export function IconCheck({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-check${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconChevronDown({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-chevron-down${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconChevronRight({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-chevron-right${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function IconChevronUp({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-chevron-up${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

export function IconCircleAlert({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-circle-alert${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

export function IconCircleCheck({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-circle-check${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m16 9-5.5 5.5L8 12" />
    </svg>
  );
}

export function IconCircleCheckBig({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-circle-check-big${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M21.801 10A10 10 0 1 1 17 3.335" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

export function IconCircleDot({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-circle-dot${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

export function IconCircleHelp({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-circle-help${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function IconCirclePause({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-circle-pause${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="10" x2="10" y1="15" y2="9" />
      <line x1="14" x2="14" y1="15" y2="9" />
    </svg>
  );
}

export function IconCircleSlash2({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-circle-slash-2${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M22 2 2 22" />
    </svg>
  );
}

export function IconCircleX({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-circle-x${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

export function IconClock({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-clock${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

export function IconColumns3({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-columns-3${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </svg>
  );
}

export function IconCommand({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-command${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
    </svg>
  );
}

export function IconCopy({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-copy${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function IconCornerDownRight({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-corner-down-right${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m15 10 5 5-5 5" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </svg>
  );
}

export function IconCrosshair({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-crosshair${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="22" x2="18" y1="12" y2="12" />
      <line x1="6" x2="2" y1="12" y2="12" />
      <line x1="12" x2="12" y1="6" y2="2" />
      <line x1="12" x2="12" y1="22" y2="18" />
    </svg>
  );
}

export function IconDatabase({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-database${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5" />
      <path d="M3 12A9 3 0 0 0 21 12" />
    </svg>
  );
}

export function IconDownload({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-download${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

export function IconEllipsis({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-ellipsis${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

export function IconExternalLink({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-external-link${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function IconEye({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-eye${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconFileArchive({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-file-archive${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M8 12v-1" />
      <path d="M8 18v-2" />
      <path d="M8 7V6" />
      <circle cx="8" cy="20" r="2" />
    </svg>
  );
}

export function IconFileCode({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-file-code${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 12.5 8 15l2 2.5" />
      <path d="m14 12.5 2 2.5-2 2.5" />
    </svg>
  );
}

export function IconFileDown({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-file-down${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M12 18v-6" />
      <path d="m9 15 3 3 3-3" />
    </svg>
  );
}

export function IconFileJson({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-file-json${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />
      <path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />
    </svg>
  );
}

export function IconFileSpreadsheet({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-file-spreadsheet${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </svg>
  );
}

export function IconFileText({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-file-text${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

export function IconFilter({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-filter${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
    </svg>
  );
}

export function IconFlame({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-flame${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />
    </svg>
  );
}

export function IconFolder({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-folder${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

export function IconFolderOpen({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-folder-open${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function IconFolderTree({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-folder-tree${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M3 5a2 2 0 0 0 2 2h3" />
      <path d="M3 3v13a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function IconGauge({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-gauge${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}

export function IconGitBranch({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-git-branch${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M15 6a9 9 0 0 0-9 9V3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
    </svg>
  );
}

export function IconGitCommit({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-git-commit${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <line x1="3" x2="9" y1="12" y2="12" />
      <line x1="15" x2="21" y1="12" y2="12" />
    </svg>
  );
}

export function IconGithub({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-github${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

export function IconGlobe({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-globe${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

export function IconHash({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-hash${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  );
}

export function IconHeartPulse({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-heart-pulse${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
      <path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </svg>
  );
}

export function IconHistory({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-history${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function IconImage({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-image${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

export function IconInfo({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-info${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function IconKeyboard({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-keyboard${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M10 8h.01" />
      <path d="M12 12h.01" />
      <path d="M14 8h.01" />
      <path d="M16 12h.01" />
      <path d="M18 8h.01" />
      <path d="M6 8h.01" />
      <path d="M7 16h10" />
      <path d="M8 12h.01" />
      <rect width="20" height="16" x="2" y="4" rx="2" />
    </svg>
  );
}

export function IconLayers({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-layers${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </svg>
  );
}

export function IconLayoutDashboard({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-layout-dashboard${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

export function IconList({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-list${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M3 5h.01" />
      <path d="M3 12h.01" />
      <path d="M3 19h.01" />
      <path d="M8 5h13" />
      <path d="M8 12h13" />
      <path d="M8 19h13" />
    </svg>
  );
}

export function IconListChecks({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-list-checks${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
    </svg>
  );
}

export function IconListFilter({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-list-filter${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M2 5h20" />
      <path d="M6 12h12" />
      <path d="M9 19h6" />
    </svg>
  );
}

export function IconLoaderCircle({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-loader-circle${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export function IconLock({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-lock${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function IconMapPin({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-map-pin${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function IconMaximize2({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-maximize-2${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
      <path d="M9 21H3v-6" />
    </svg>
  );
}

export function IconMenu({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-menu${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
    </svg>
  );
}

export function IconMilestone({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-milestone${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 13v8" />
      <path d="M12 3v3" />
      <path d="M18.172 6a2 2 0 0 1 1.414.586l2.06 2.06a1.207 1.207 0 0 1 0 1.708l-2.06 2.06a2 2 0 0 1-1.414.586H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function IconMinimize2({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-minimize-2${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m14 10 7-7" />
      <path d="M20 10h-6V4" />
      <path d="m3 21 7-7" />
      <path d="M4 14h6v6" />
    </svg>
  );
}

export function IconMinus({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-minus${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconMonitor({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-monitor${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

export function IconMoon({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-moon${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </svg>
  );
}

export function IconMousePointerClick({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-mouse-pointer-click${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M14 4.1 12 6" />
      <path d="m5.1 8-2.9-.8" />
      <path d="m6 12-1.9 2" />
      <path d="M7.2 2.2 8 5.1" />
      <path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" />
    </svg>
  );
}

export function IconMoveHorizontal({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-move-horizontal${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m18 8 4 4-4 4" />
      <path d="M2 12h20" />
      <path d="m6 8-4 4 4 4" />
    </svg>
  );
}

export function IconNetwork({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-network${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </svg>
  );
}

export function IconOctagonAlert({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-octagon-alert${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 16h.01" />
      <path d="M12 8v4" />
      <path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" />
    </svg>
  );
}

export function IconPackage({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-package${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <path d="m7.5 4.27 9 5.15" />
    </svg>
  );
}

export function IconPaintbrush({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-paintbrush${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m14.622 17.897-10.68-2.913" />
      <path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z" />
      <path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15" />
    </svg>
  );
}

export function IconPalette({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-palette${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

export function IconPanelLeft({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-panel-left${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function IconPaperclip({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-paperclip${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
    </svg>
  );
}

export function IconPencil({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-pencil${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function IconPercent({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-percent${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <line x1="19" x2="5" y1="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

export function IconPlay({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-play${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
    </svg>
  );
}

export function IconPlus({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-plus${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function IconRadar({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-radar${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
      <path d="M4 6h.01" />
      <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
      <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
      <path d="M12 18h.01" />
      <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
      <circle cx="12" cy="12" r="2" />
      <path d="m13.41 10.59 5.66-5.66" />
    </svg>
  );
}

export function IconRefreshCw({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-refresh-cw${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export function IconRotateCcw({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-rotate-ccw${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function IconRuler({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-ruler${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
      <path d="m14.5 12.5 2-2" />
      <path d="m11.5 9.5 2-2" />
      <path d="m8.5 6.5 2-2" />
      <path d="m17.5 15.5 2-2" />
    </svg>
  );
}

export function IconSave({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-save${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </svg>
  );
}

export function IconScan({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-scan${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}

export function IconSearch({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-search${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </svg>
  );
}

export function IconSeparatorHorizontal({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-separator-horizontal${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m16 16-4 4-4-4" />
      <path d="M3 12h18" />
      <path d="m8 8 4-4 4 4" />
    </svg>
  );
}

export function IconServer({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-server${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </svg>
  );
}

export function IconShieldAlert({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-shield-alert${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function IconShieldCheck({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-shield-check${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function IconSignal({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-signal${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M2 20h.01" />
      <path d="M7 20v-4" />
      <path d="M12 20v-8" />
      <path d="M17 20V8" />
      <path d="M22 4v16" />
    </svg>
  );
}

export function IconSkipForward({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-skip-forward${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M21 4v16" />
      <path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z" />
    </svg>
  );
}

export function IconSlidersHorizontal({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-sliders-horizontal${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M10 5H3" />
      <path d="M12 19H3" />
      <path d="M14 3v4" />
      <path d="M16 17v4" />
      <path d="M21 12h-9" />
      <path d="M21 19h-5" />
      <path d="M21 5h-7" />
      <path d="M8 10v4" />
      <path d="M8 12H3" />
    </svg>
  );
}

export function IconSparkles({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-sparkles${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
      <path d="M20 2v4" />
      <path d="M22 4h-4" />
      <circle cx="4" cy="20" r="2" />
    </svg>
  );
}

export function IconSquareCheck({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-square-check${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="m16 9-5.5 5.5L8 12" />
    </svg>
  );
}

export function IconSquarePen({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-square-pen${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </svg>
  );
}

/**
 * Hammer — "under construction", the semantic mark for planned-but-unbuilt
 * work. The pencil (IconSquarePen) is reserved for its literal meaning (edit a
 * note); borrowing it for not-implemented made QA read the status as "editable".
 * Geometry inlined from lucide-static `hammer` (ISC).
 */
export function IconHammer({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-hammer${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9" />
      <path d="m18 15 4-4" />
      <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
    </svg>
  );
}

export function IconSquareX({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-square-x${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

export function IconSun({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-sun${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

export function IconTable({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-table${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 3v18" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
    </svg>
  );
}

export function IconTarget({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-target${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

export function IconTerminal({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-terminal${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 19h8" />
      <path d="m4 17 6-6-6-6" />
    </svg>
  );
}

export function IconTestTube({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-test-tube${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5c-1.4 0-2.5-1.1-2.5-2.5V2" />
      <path d="M8.5 2h7" />
      <path d="M14.5 16h-5" />
    </svg>
  );
}

export function IconTimer({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-timer${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <line x1="10" x2="14" y1="2" y2="2" />
      <line x1="12" x2="15" y1="14" y2="11" />
      <circle cx="12" cy="14" r="8" />
    </svg>
  );
}

export function IconTrash2({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-trash-2${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function IconTrendingDown({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-trending-down${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M16 17h6v-6" />
      <path d="m22 17-8.5-8.5-5 5L2 7" />
    </svg>
  );
}

export function IconTrendingUp({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-trending-up${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M16 7h6v6" />
      <path d="m22 7-8.5 8.5-5-5L2 17" />
    </svg>
  );
}

export function IconTriangleAlert({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-triangle-alert${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function IconTrophy({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-trophy${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2" />
      <path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2" />
      <path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3" />
      <path d="M4 22h16" />
      <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />
      <path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" />
    </svg>
  );
}

export function IconUser({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-user${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function IconVideo({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-video${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

export function IconWaves({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-waves${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M2 12q2.5 2 5 0t5 0 5 0 5 0" />
      <path d="M2 19q2.5 2 5 0t5 0 5 0 5 0" />
      <path d="M2 5q2.5 2 5 0t5 0 5 0 5 0" />
    </svg>
  );
}

export function IconWaypoints({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-waypoints${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="m10.586 5.414-5.172 5.172" />
      <path d="m18.586 13.414-5.172 5.172" />
      <path d="M6 12h12" />
      <circle cx="12" cy="20" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="20" cy="12" r="2" />
      <circle cx="4" cy="12" r="2" />
    </svg>
  );
}

export function IconWifiOff({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-wifi-off${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M12 20h.01" />
      <path d="M8.5 16.429a5 5 0 0 1 7 0" />
      <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
      <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
      <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
      <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function IconWorkflow({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-workflow${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <rect width="8" height="8" x="3" y="3" rx="2" />
      <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect width="8" height="8" x="13" y="13" rx="2" />
    </svg>
  );
}

export function IconX({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-x${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function IconZap({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      {...SVG_BASE}
      width={size}
      height={size}
      class={`icon-svg icon-zap${className ? ' ' + className : ''}`}
      aria-hidden="true"
    >
      <path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" />
    </svg>
  );
}

/* Aliases kept for existing call sites. */
export const IconAlert = IconTriangleAlert;
export const IconCross = IconCircleX;
export const IconSkip = IconCircleSlash2;
export const IconEdit = IconSquarePen;
export const IconTrash = IconTrash2;
export const IconReset = IconRotateCcw;
export const IconSwap = IconArrowRightLeft;
export const IconCompare = IconArrowRightLeft;
export const IconHealed = IconHeartPulse;
export const IconFlaskConical = IconTestTube;
