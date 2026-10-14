import fs from 'node:fs';
import path from 'node:path';

export const HTML_THEME_OVERRIDE_STYLE = `
<style data-dashboard-theme-override="light">
  :root:not(.dark-mode):not(.light-mode) { color-scheme: light; }
  :root { color-scheme: light; }
</style>
<script data-dashboard-theme-override="light">
  (function () {
    function forceLight() {
      try {
        var root = document.documentElement;
        var meta = document.querySelector("meta[name='color-scheme']");
        if (meta) meta.setAttribute('content', 'light');
        if (root.classList.contains('dark-mode')) {
          root.classList.remove('dark-mode');
          root.classList.add('light-mode');
        }
        try { localStorage.setItem('playwright-report-theme', 'light'); } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
    }
    forceLight();
    document.addEventListener('DOMContentLoaded', forceLight);
    new MutationObserver(forceLight).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  })();
</script>
`;

export function forcePlaywrightHtmlToLight(htmlFolder: string): void {
  const indexPath = path.join(htmlFolder, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return;
  }

  let content = fs.readFileSync(indexPath, 'utf-8');
  if (content.includes('data-dashboard-theme-override="light"')) {
    return;
  }

  const injection = `    ${HTML_THEME_OVERRIDE_STYLE.trim()}\n`;
  const headCloseIdx = content.indexOf('</head>');
  if (headCloseIdx === -1) {
    return;
  }

  content = content.slice(0, headCloseIdx) + injection + content.slice(headCloseIdx);
  fs.writeFileSync(indexPath, content, 'utf-8');
}
