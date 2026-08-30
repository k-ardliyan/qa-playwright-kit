/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';
import { getDashboardStyles } from '../styles';
import { renderChartScript, renderInteractiveScript, renderThemeScript } from '../shared';
import { buildClientBootstrapJs } from '../client';
import { RepoFooter } from './RepoFooter';
import type { TestSummary } from '../types';

export interface DashboardDocumentProps {
  pageTitle: string;
  summary?: TestSummary;
  includeChart?: boolean;
  children: Children;
}

export function DashboardDocument({
  pageTitle,
  summary,
  includeChart = false,
  children,
}: DashboardDocumentProps) {
  const safeChartScript = includeChart && summary ? renderChartScript(summary) : '';
  const safeThemeScript = renderThemeScript();
  const safeInteractiveScript = renderInteractiveScript();
  const safeStyles = getDashboardStyles();

  const safeClientBootstrap = buildClientBootstrapJs();

  return (
    '<!doctype html>' +
    (
      <html lang="en" data-density="dense">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title safe>{pageTitle}</title>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
            rel="stylesheet"
          />
          {includeChart && (
            <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" />
          )}
          <style>{safeStyles}</style>
        </head>
        <body>
          <div class="page-shell">
            <div class="page-backdrop" aria-hidden="true" />
            <main class="page">{children}</main>
          </div>
          <RepoFooter />
          {safeThemeScript}
          {safeChartScript}
          {safeInteractiveScript}
          {safeClientBootstrap}
        </body>
      </html>
    )
  );
}
