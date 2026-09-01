/**
 * Setup Wizard — lightweight bilingual strings (id/en).
 *
 * Default language is Indonesian (target users are non-coder QA in ID).
 * English is opt-in via the first-run language prompt or `--lang en`.
 *
 * Kept deliberately tiny: `t(lang, id, en)` two-column lookup. No plural
 * rules, no interpolation beyond template literals at call sites.
 *
 * @module src/setup/i18n
 */

export type WizardLang = 'id' | 'en';

export const DEFAULT_LANG: WizardLang = 'id';

export const KNOWN_LANGS: WizardLang[] = ['id', 'en'];

export const LANG_LABELS: Record<WizardLang, string> = {
  id: 'Bahasa Indonesia',
  en: 'English',
};

export function isKnownLang(v: string): v is WizardLang {
  return v === 'id' || v === 'en';
}

/** Pick the Indonesian string by default, English when requested. */
export function t(lang: WizardLang, id: string, en: string): string {
  return lang === 'en' ? en : id;
}
