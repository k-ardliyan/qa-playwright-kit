/**
 * Toast client — appends shadcn-style toasts into the shared viewport.
 *
 * Icons are inlined Lucide paths (no emoji, no network), tinted by the toast
 * type via CSS. Auto-dismisses; the close button is always available. Mirrors
 * the Base UI / shadcn toast API surface we need: type, title, description,
 * duration.
 */

const LUCIDE_PATHS: Record<string, string> = {
  success: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  warning:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  loading: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
};

export function buildToastJs(): string {
  const paths = JSON.stringify(LUCIDE_PATHS);
  return `
  var TOAST_PATHS = ${paths};
  function toastIconSvg(type) {
    var body = TOAST_PATHS[type] || TOAST_PATHS.info;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }
  window.studioToast = function (opts) {
    opts = opts || {};
    var viewport = document.getElementById('toast-viewport');
    if (!viewport) return;
    var type = opts.type || 'info';
    var el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.innerHTML = toastIconSvg(type);
    var body = document.createElement('div');
    body.className = 'toast__body';
    var title = document.createElement('p');
    title.className = 'toast__title';
    title.textContent = opts.title || '';
    body.appendChild(title);
    if (opts.desc) {
      var desc = document.createElement('p');
      desc.className = 'toast__desc';
      desc.textContent = opts.desc;
      body.appendChild(desc);
    }
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.setAttribute('aria-label', 'Tutup');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    el.appendChild(icon);
    el.appendChild(body);
    el.appendChild(close);
    viewport.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('toast--in'); });
    var timer = null;
    function dismiss() {
      if (timer) clearTimeout(timer);
      el.classList.remove('toast--in');
      el.classList.add('toast--out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    }
    close.addEventListener('click', dismiss);
    if (type !== 'loading' && opts.duration !== 0) {
      timer = setTimeout(dismiss, opts.duration || 5000);
    }
    return { close: dismiss };
  };
  `;
}
