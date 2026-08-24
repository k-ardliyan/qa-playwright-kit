/** @jsxImportSource @kitajs/html */

/**
 * Slim repository attribution footer rendered once per document,
 * below every dashboard / report page.
 *
 * Kept intentionally tiny and muted — a quiet credit line, not UI chrome.
 */
export function RepoFooter() {
  return (
    <p class="repo-footer">
      {'QA Playwright Kit · by '}
      <a
        href="https://github.com/k-ardliyan/qa-playwright-kit"
        target="_blank"
        rel="noopener noreferrer"
      >
        k-ardliyan
      </a>
      {' on GitHub'}
    </p>
  );
}
