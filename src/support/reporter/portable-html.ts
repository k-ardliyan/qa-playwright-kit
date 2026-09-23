import * as fs from 'node:fs';
import * as path from 'node:path';
import { escapeHtml } from '../custom-dashboard/shared';
import { resolveWorkspaceReportDir } from '../../shared/workspace-paths';

export interface PortableCase {
  title?: string;
  status?: string;
  role?: string;
  expectedResult?: string;
  actualResult?: string;
  aiNotes?: string;
  errorMessage?: string;
  reqRef?: string;
  track?: 'strict' | 'express';
  attachments?: Array<{ kind?: string; relativePath?: string; name?: string }>;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Cap inline bytes so one export stays shareable. ponytail: no resize, add sharp/webp when files exceed ~5MB. */
const MAX_INLINE_BYTES = 400_000;

export function inlineScreenshot(reportDir: string, relativePath: string): string | null {
  const root = path.resolve(reportDir);
  const abs = path.resolve(root, relativePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME[ext];
  if (!mime || !fs.existsSync(abs)) return null;
  const buf = fs.readFileSync(abs);
  if (buf.length > MAX_INLINE_BYTES) return null;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function shotFor(reportDir: string, item: PortableCase): string | null {
  const shots = (item.attachments ?? []).filter((a) => a.kind === 'screenshot' && a.relativePath);
  const pick = shots[shots.length - 1];
  if (!pick?.relativePath) return null;
  return inlineScreenshot(reportDir, pick.relativePath);
}

/** Trace archive path for SDET follow-up. Kept as a relative link, never inlined. */
function traceFor(item: PortableCase): string | null {
  const traces = (item.attachments ?? []).filter((a) => a.kind === 'trace' && a.relativePath);
  return traces[traces.length - 1]?.relativePath ?? null;
}

function insightList(summary: Record<string, unknown>): string {
  const insights = Array.isArray(summary.aiInsights) ? (summary.aiInsights as unknown[]) : [];
  const items = insights.filter((i): i is string => typeof i === 'string' && i.trim().length > 0);
  if (items.length === 0) return '';
  return `<section class="exec">
<h2>Temuan AI</h2>
<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
</section>`;
}

export function buildPortableHtml(summary: Record<string, unknown>, reportDir: string): string {
  const cases = Array.isArray(summary.testCases) ? (summary.testCases as PortableCase[]) : [];
  const passed = cases.filter((c) => c.status === 'passed').length;
  const failed = cases.filter((c) => c.status === 'failed' || c.status === 'timedOut').length;
  const skipped = cases.filter((c) => c.status === 'skipped').length;
  const passRate = cases.length > 0 ? Math.round((passed / cases.length) * 100) : 0;

  const runMeta = (summary.runMeta as Record<string, unknown> | undefined) ?? {};
  const metaBits: string[] = [];
  const appEnv =
    (typeof runMeta.appEnv === 'string' && runMeta.appEnv) ||
    (typeof summary.appEnv === 'string' && summary.appEnv) ||
    '';
  if (appEnv) metaBits.push(`Environment: ${appEnv}`);
  const reqPath =
    (typeof runMeta.requirementPath === 'string' && runMeta.requirementPath) ||
    (typeof summary.requirementPath === 'string' && summary.requirementPath) ||
    '';
  if (reqPath) metaBits.push(`Requirement: ${reqPath}`);
  const ranAt =
    (typeof summary.timestamp === 'string' && summary.timestamp) ||
    (typeof runMeta.generatedAt === 'string' && runMeta.generatedAt) ||
    '';
  if (ranAt) metaBits.push(`Waktu: ${ranAt}`);
  const totalMs =
    typeof runMeta.totalDurationMs === 'number'
      ? runMeta.totalDurationMs
      : cases.reduce((sum, c) => sum + ((c as { duration?: number }).duration ?? 0), 0);
  if (totalMs > 0) metaBits.push(`Durasi: ${(totalMs / 1000).toFixed(1)}s`);

  const rows = cases
    .map((c) => {
      const img = shotFor(reportDir, c);
      const thumb = img ? `<img alt="" src="${img}">` : '';
      const note = c.aiNotes || c.actualResult || '';
      const err = c.errorMessage ? `<pre class="eng">${escapeHtml(c.errorMessage)}</pre>` : '';
      const duration = (c as { duration?: number }).duration;
      const trace = traceFor(c);
      const engBits = [
        duration ? `${duration}ms` : '',
        trace ? `<a href="${escapeHtml(trace)}">trace</a>` : '',
      ].filter(Boolean);
      const eng = engBits.length > 0 ? `<div class="eng">${engBits.join(' · ')}</div>` : '';
      return `<tr>
        <td>${escapeHtml(c.status ?? '')}</td>
        <td>${escapeHtml(c.title ?? '')}${c.reqRef ? ` <code>${escapeHtml(c.reqRef)}</code>` : ''}${c.track === 'express' ? ' express' : ''}${eng}</td>
        <td>${escapeHtml(c.role ?? '')}</td>
        <td>${escapeHtml(c.expectedResult ?? '')}</td>
        <td>${escapeHtml(note)}${err}</td>
        <td>${thumb}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>QA report</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; color: #111; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  th { text-align: left; background: #f4f4f4; }
  img { max-width: 160px; max-height: 100px; }
  .fail { color: #a00; }
  .eng { display: none; }
  body:has(#eng:checked) .eng { display: block; }
  .kpi { display: flex; gap: 24px; align-items: baseline; flex-wrap: wrap; }
  .kpi strong { font-size: 28px; }
  .kpi .rate { color: ${failed > 0 ? '#a00' : '#070'}; }
  .meta { color: #555; font-size: 13px; }
</style>
</head>
<body>
<label><input type="checkbox" id="eng"> Detail engineer</label>
<h1>QA report</h1>
<section class="exec">
<div class="kpi">
  <span><strong class="rate">${passRate}%</strong> lulus</span>
  <span><strong>${passed}</strong> lulus</span>
  <span><strong>${failed}</strong> gagal</span>
  <span><strong>${skipped}</strong> dilewati</span>
  <span><strong>${cases.length}</strong> total</span>
</div>
<p class="meta">${escapeHtml(metaBits.join(' · '))}</p>
</section>
${insightList(summary)}
<table>
<thead><tr><th>Status</th><th>Skenario</th><th>Role</th><th>Expected</th><th>Catatan</th><th>Bukti</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}

export function writePortableReport(summaryPath?: string): string {
  const reportDir = resolveWorkspaceReportDir();
  const src = summaryPath ?? path.join(reportDir, 'test-summary.json');
  const summary = JSON.parse(fs.readFileSync(src, 'utf-8')) as Record<string, unknown>;
  const html = buildPortableHtml(summary, reportDir);
  const out = path.join(reportDir, 'portable-report.html');
  fs.writeFileSync(out, html, 'utf-8');
  return out;
}
