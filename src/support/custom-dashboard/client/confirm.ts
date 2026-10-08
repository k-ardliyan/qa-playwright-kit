/**
 * Confirm dialog client — a promise-based confirm for important actions.
 *
 * `window.studioConfirm({ title, desc, confirmLabel, cancelLabel, tone })`
 * returns a Promise<boolean>. Uses a single shared native <dialog id="confirm-dialog">
 * (mounted in DashboardDocument) so it inherits focus trapping + Escape from
 * the platform, matching the app's other dialogs.
 */
export function buildConfirmJs(): string {
  return `
  window.studioConfirm = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var dlg = document.getElementById('confirm-dialog');
      if (!dlg || typeof dlg.showModal !== 'function') {
        // No dialog available — fall back to the platform confirm.
        resolve(window.confirm(opts.title || 'Lanjutkan?'));
        return;
      }
      dlg.querySelector('#confirm-title').textContent = opts.title || 'Konfirmasi';
      var descEl = dlg.querySelector('#confirm-desc');
      descEl.textContent = opts.desc || '';
      descEl.hidden = !opts.desc;
      var ok = dlg.querySelector('#confirm-ok');
      var cancel = dlg.querySelector('#confirm-cancel');
      var closeBtn = dlg.querySelector('#confirm-close');
      ok.textContent = opts.confirmLabel || 'Lanjutkan';
      cancel.textContent = opts.cancelLabel || 'Batal';
      ok.className = 'btn ' + (opts.tone === 'danger' ? 'btn-danger' : 'btn-primary');
      function done(value) {
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        if (closeBtn) closeBtn.removeEventListener('click', onCancel);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        resolve(value);
      }
      function onOk() { done(true); }
      function onCancel() { done(false); }
      function onClose() { done(false); }
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      if (closeBtn) closeBtn.addEventListener('click', onCancel);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  };
  `;
}
