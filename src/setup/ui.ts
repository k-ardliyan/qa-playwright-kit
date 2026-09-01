/**
 * Setup Wizard — console UI helpers.
 *
 * One place for banners, numbered step headers, and check lists so every
 * screen of the wizard shares the same layout and width. Pure formatting +
 * console output — no prompts, no I/O decisions.
 *
 * @module src/setup/ui
 */

import { type WizardLang, t } from './i18n';

const WIDTH = 62;

/** Full-width wizard banner printed once at start. */
export function printBanner(lang: WizardLang): void {
  const title = t(lang, 'Setup Wizard — qa-playwright-kit', 'Setup Wizard — qa-playwright-kit');
  const pad = Math.max(0, WIDTH - 2 - title.length - 2);
  const left = Math.floor(pad / 2);
  console.log('');
  console.log(`╭${'─'.repeat(WIDTH - 2)}╮`);
  console.log(`│${' '.repeat(left + 1)}${title}${' '.repeat(pad - left + 1)}│`);
  console.log(`╰${'─'.repeat(WIDTH - 2)}╯`);
}

/** Numbered step header, e.g. `── [2/6] Environment ──────────────`. */
export function printStep(
  step: number,
  total: number,
  lang: WizardLang,
  id: string,
  en: string,
): void {
  const label = t(lang, id, en);
  const head = ` [${step}/${total}] ${label} `;
  const rest = Math.max(2, WIDTH - head.length - 2);
  console.log('');
  console.log(`──${head}${'─'.repeat(rest)}`);
}

/** Section header without numbering (write/verify/summary phases). */
export function printSection(lang: WizardLang, id: string, en: string): void {
  const label = t(lang, id, en);
  const head = ` ${label} `;
  const rest = Math.max(2, WIDTH - head.length - 2);
  console.log('');
  console.log(`──${head}${'─'.repeat(rest)}`);
}

export function stepLine(message: string): void {
  console.log(`  ${message}`);
}

/** Muted helper line (hints, secondary info). */
export function hintLine(message: string): void {
  console.log(`    ${message}`);
}

export interface ChecklistItem {
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail?: string;
  fix?: string;
}

/** Render one checklist line: `✓ label — detail` (+ indented fix hint). */
export function formatChecklistLine(item: ChecklistItem): string {
  const mark = item.status === 'pass' ? '✓' : item.status === 'warn' ? '⚠' : '✗';
  const detail = item.detail ? ` — ${item.detail}` : '';
  const line = `  ${mark} ${item.label}${detail}`;
  return item.fix ? `${line}\n      ↳ ${item.fix}` : line;
}

export function printChecklist(items: ChecklistItem[]): void {
  for (const item of items) {
    console.log(formatChecklistLine(item));
  }
}
