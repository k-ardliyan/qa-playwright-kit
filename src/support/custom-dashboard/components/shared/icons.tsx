/** @jsxImportSource @kitajs/html */

export interface IconProps {
  size?: number;
  class?: string;
}

export function IconCheck({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-check ${className}`}
      aria-hidden="true"
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function IconCross({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-cross ${className}`}
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconSkip({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-skip ${className}`}
      aria-hidden="true"
    >
      <path d="M3 4l6 4-6 4V4zM11 4v8" />
    </svg>
  );
}

export function IconHealed({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-healed ${className}`}
      aria-hidden="true"
    >
      <rect x="2" y="5" width="12" height="6" rx="3" />
      <path d="M6 8h4M8 6v4" />
    </svg>
  );
}

export function IconDashboard({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-dashboard ${className}`}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

export function IconHistory({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-history ${className}`}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5l2.5 1.5" />
    </svg>
  );
}

export function IconCompare({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-compare ${className}`}
      aria-hidden="true"
    >
      <path d="M4 12V4M4 4l-2 2M4 4l2 2M12 4v8M12 12l-2-2M12 12l2-2" />
    </svg>
  );
}

export function IconSave({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-save ${className}`}
      aria-hidden="true"
    >
      <path d="M3 2h8l3 3v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M5 2v3h6V2M5 14v-4h6v4" />
    </svg>
  );
}

export function IconEdit({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-edit ${className}`}
      aria-hidden="true"
    >
      <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H2v-3L11.5 2.5z" />
    </svg>
  );
}

export function IconTrash({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-trash ${className}`}
      aria-hidden="true"
    >
      <path d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M6 7v5M10 7v5M3.5 4l.8 9.5a1 1 0 001 .9h5.4a1 1 0 001-.9L12.5 4" />
    </svg>
  );
}

export function IconSearch({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-search ${className}`}
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

export function IconSwap({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-swap ${className}`}
      aria-hidden="true"
    >
      <path d="M11 3L14 6M14 6L11 9M14 6H4M5 13L2 10M2 10L5 7M2 10H12" />
    </svg>
  );
}

export function IconSun({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-sun ${className}`}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" />
    </svg>
  );
}

export function IconMoon({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-moon ${className}`}
      aria-hidden="true"
    >
      <path d="M13.5 9.5A6 6 0 116.5 2.5a4.8 4.8 0 007 7z" />
    </svg>
  );
}

export function IconAlert({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-alert ${className}`}
      aria-hidden="true"
    >
      <path d="M8 2l6 11H2L8 2zM8 6v3.5M8 12h.01" />
    </svg>
  );
}

export function IconInfo({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-info ${className}`}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4M8 5h.01" />
    </svg>
  );
}

export function IconTrend({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-trend ${className}`}
      aria-hidden="true"
    >
      <path d="M2 11l4-4 3 3 5-6" />
      <path d="M10 4h4v4" />
    </svg>
  );
}

export function IconFlame({ size = 16, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-flame ${className}`}
      aria-hidden="true"
    >
      <path d="M8 1c0 3-3 4-3 7a5 5 0 0010 0c0-3-2-4-2-7-1 2-2 3-5 0z" />
    </svg>
  );
}

export function IconCamera({ size = 14, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-camera ${className}`}
      aria-hidden="true"
    >
      <rect x="2" y="4" width="12" height="9" rx="2" />
      <circle cx="8" cy="8.5" r="2.2" />
      <path d="M5.5 4l.8-1.5h3.4l.8 1.5" />
    </svg>
  );
}

export function IconClock({ size = 14, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-clock ${className}`}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5v3.8l2.5 1.5" />
    </svg>
  );
}

export function IconTrace({ size = 14, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-trace ${className}`}
      aria-hidden="true"
    >
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="7" cy="12" r="2" />
      <path d="M5.5 5.5l5 1.5M6 10.5l-1-4.5M8.5 11l2.5-3.5" />
    </svg>
  );
}

export function IconReset({ size = 14, class: className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon-svg icon-reset ${className}`}
      aria-hidden="true"
    >
      <path d="M2.5 2.5v4h4" />
      <path d="M3.2 10a5.5 5.5 0 101.4-5.4L2.5 6.5" />
    </svg>
  );
}
