/**
 * Client-side clipboard helper for copying text, failure packets, and structured context.
 */
export function buildClipboardJs(): string {
  return `
  function copyTextToClipboard(text, triggerEl, successText) {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text).then(function () {
        if (!triggerEl) return;
        var orig = triggerEl.textContent;
        triggerEl.textContent = successText || 'Copied!';
        setTimeout(function () { triggerEl.textContent = orig; }, 1500);
      });
    } catch (err) {
      console.warn('Clipboard write failed', err);
    }
  }

  function formatFailureContext(testData) {
    if (!testData) return '';
    var lines = [
      'Test: ' + (testData.title || testData.testId || 'Unknown'),
      'Status: ' + (testData.status || 'Failed'),
      'File: ' + (testData.filePath || '-'),
      'Duration: ' + ((testData.duration || 0) / 1000).toFixed(1) + 's'
    ];
    if (testData.errorMessage) {
      lines.push('Error: ' + testData.errorMessage.split('\\n')[0]);
    }
    if (testData.failureSource) {
      lines.push('Failure Source: ' + testData.failureSource);
    }
    if (testData.attachments && testData.attachments.length) {
      var traces = testData.attachments.filter(function(a) { return a.kind === 'trace'; });
      var screenshots = testData.attachments.filter(function(a) { return a.kind === 'screenshot'; });
      if (traces.length) lines.push('Trace: ' + traces[0].name);
      if (screenshots.length) lines.push('Screenshot: ' + screenshots[0].name);
    }
    return lines.join('\\n');
  }
  `;
}
