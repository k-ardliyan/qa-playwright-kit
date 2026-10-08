/**
 * Not-implemented reason categories — pure helpers, no DOM, no state.
 *
 * The reporter carries the raw fixme annotation text per row
 * (`notImplementedReason`); this module groups those free-text Indonesian
 * reasons into a small canonical set so the overview panel can answer QA's
 * "kenapa belum jalan?" with a count and a next action per category. Keyword
 * matching is deliberately local: an unmapped reason falls into `alasan-lain`
 * and the raw text is never discarded (it travels in `reasons` for the
 * tooltip), so new phrasings degrade to visible, not lost.
 *
 * @module src/support/custom-dashboard/domain/not-implemented-categories
 */

export interface NotImplementedCategoryEntry {
  categoryId: NotImplementedCategoryId;
  label: string;
  /** The one action that unblocks this category, in QA language. */
  nextAction: string;
  count: number;
  /** Distinct raw reasons in this category (max 3, insertion order). */
  reasons: string[];
}

export const NOT_IMPLEMENTED_CATEGORY_ORDER = [
  'halaman-belum-dieksplorasi',
  'butuh-seed',
  'butuh-sesi',
  'butuh-rantai-data',
  'tanpa-alasan',
  'alasan-lain',
] as const;

export type NotImplementedCategoryId = (typeof NOT_IMPLEMENTED_CATEGORY_ORDER)[number];

interface CategoryDefinition {
  id: NotImplementedCategoryId;
  label: string;
  nextAction: string;
  /** Absent for the no-reason / other fallbacks (they match nothing). */
  patterns?: RegExp[];
}

/** Order matters: the first matching category wins. */
const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    id: 'halaman-belum-dieksplorasi',
    label: 'Halaman belum dieksplorasi',
    nextAction:
      'Snapshot halamannya (snapshot_page / discover_pages) sampai form/dialog-nya terkatalog, lalu regenerate.',
    patterns: [/belum dieksplorasi/i, /selector catalog/i],
  },
  {
    id: 'butuh-seed',
    label: 'Butuh seed/data khusus',
    nextAction:
      'Deklarasikan produser seed di config/qa-kit.seeds.json (lihat list_seeds) atau siapkan fixture datanya, lalu regenerate.',
    patterns: [/seed/i, /data khusus/i],
  },
  {
    id: 'butuh-sesi',
    label: 'Butuh sesi/kredensial',
    nextAction:
      'Daftarkan role via npm run env:edit lalu npm run auth:setup untuk role terkait, kemudian regenerate.',
    patterns: [/sesi/i, /session/i, /kedaluwarsa/i, /\bauth\b/i],
  },
  {
    id: 'butuh-rantai-data',
    label: 'Butuh rantai data',
    nextAction:
      'Skenario butuh state dari alur lain (mis. data harus sudah melewati tahap sebelumnya) — jalankan alur pembentuk datanya atau siapkan seed state akhir, lalu regenerate.',
    patterns: [/prasyarat/i, /rantai/i, /berjalan sampai/i],
  },
];

const NO_REASON: CategoryDefinition = {
  id: 'tanpa-alasan',
  label: 'Tanpa alasan',
  nextAction:
    'Regenerate dengan alasan fixme yang jelas — QA tidak bisa menindaklanjuti utang kerja tanpa tahu apa yang ditunggu.',
};

const OTHER_REASON: CategoryDefinition = {
  id: 'alasan-lain',
  label: 'Alasan lain',
  nextAction: 'Tinjau alasannya di tooltip Alasan / AI NOTES, lalu putuskan langkah berikutnya.',
};

/** Map one raw reason text to its canonical category id. */
export function categorizeNotImplementedReason(reason: unknown): NotImplementedCategoryId {
  if (typeof reason !== 'string' || reason.trim() === '') return NO_REASON.id;
  for (const category of CATEGORY_DEFINITIONS) {
    if (category.patterns?.some((p) => p.test(reason))) return category.id;
  }
  return OTHER_REASON.id;
}

function definitionOf(id: NotImplementedCategoryId): CategoryDefinition {
  return (
    CATEGORY_DEFINITIONS.find((c) => c.id === id) ??
    (id === NO_REASON.id ? NO_REASON : OTHER_REASON)
  );
}

/**
 * Group not-implemented test cases (raw summary shape) by reason category.
 * Rows with another status are ignored. Ordered by the canonical category
 * order; empty categories are omitted. Pure — unit-testable without DOM.
 */
export function computeNotImplementedByCategory(
  rawTestCases: unknown[],
): NotImplementedCategoryEntry[] {
  const buckets = new Map<NotImplementedCategoryId, { count: number; reasons: string[] }>();
  for (const tc of rawTestCases) {
    if (!tc || typeof tc !== 'object') continue;
    const record = tc as Record<string, unknown>;
    if (record.status !== 'not-implemented') continue;
    const id = categorizeNotImplementedReason(record.notImplementedReason);
    const bucket = buckets.get(id) ?? { count: 0, reasons: [] };
    bucket.count += 1;
    const reason =
      typeof record.notImplementedReason === 'string' ? record.notImplementedReason : '';
    if (reason && !bucket.reasons.includes(reason) && bucket.reasons.length < 3) {
      bucket.reasons.push(reason);
    }
    buckets.set(id, bucket);
  }

  return NOT_IMPLEMENTED_CATEGORY_ORDER.filter((id) => buckets.has(id)).map((id) => {
    const definition = definitionOf(id);
    const bucket = buckets.get(id)!;
    return {
      categoryId: id,
      label: definition.label,
      nextAction: definition.nextAction,
      count: bucket.count,
      reasons: bucket.reasons,
    };
  });
}
