/**
 * Toast — a succinct, temporary status message (shadcn/Base-UI Toast anatomy,
 * hand-styled against our tokens so it needs no runtime dependency).
 *
 * Markup contract (one shared viewport, toasts appended into it):
 *   <div class="toast-viewport" id="toast-viewport" aria-live="polite"> … </div>
 * A toast is `<div class="toast toast--{type}" role="status">` with an optional
 * icon, `.toast__title`, `.toast__desc`, `.toast__close`.
 *
 * Client API: `window.studioToast({ type, title, desc })` — see client/toast.ts.
 * Types: success | info | warning | error | loading (same set as Base UI).
 */
export function Toaster() {
  return <div class="toast-viewport" id="toast-viewport" aria-live="polite" aria-atomic="false" />;
}
