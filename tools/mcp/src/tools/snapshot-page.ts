/**
 * MCP tool: `snapshot_page`.
 *
 * Navigate to a URL, capture an ARIA snapshot, and persist a structured
 * selector catalog under `selector-catalog/<featureName>/<pageName>.{aria.yml,json}`.
 * The full tree is written to disk so the AI agent only sees a compact summary
 * in the MCP response.
 */

import { createToolError, type ToolError } from '../utils/safety';
import {
  snapshotPageCore,
  SnapshotCoreError,
  DEFAULT_MAX_ELEMENTS,
} from './_internal/snapshot-core';

export interface SnapshotPageArgs {
  url?: unknown;
  featureName?: unknown;
  pageName?: unknown;
  role?: unknown;
  exploreModals?: unknown;
  waitForSelector?: unknown;
  include?: unknown;
  maxElements?: unknown;
  force?: unknown;
  waitUntil?: unknown;
  navigationTimeoutMs?: unknown;
}

export interface SnapshotPageOutput {
  status: 'success' | 'error';
  featureName?: string;
  pageName?: string;
  url?: string;
  role?: string;
  hash?: string;
  elementCount?: number;
  truncated?: boolean;
  ariaYmlPath?: string;
  selectorsJsonPath?: string;
  semanticSummary?: {
    tablesCount: number;
    statCardsCount: number;
    tabsCount: number;
    steppersCount: number;
    formsCount: number;
    modalsCount: number;
    subRoutesCount: number;
  };
  skipped?: boolean;
  skipReason?: string;
  message: string;
  error?: ToolError;
}

function readString(value: unknown, _field: string): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim().length === 0) return null;
  return value.trim();
}

function readNumber(value: unknown, _field: string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function readWaitUntil(value: unknown): 'networkidle' | 'domcontentloaded' | 'load' | undefined {
  if (value === 'networkidle' || value === 'domcontentloaded' || value === 'load') return value;
  return undefined;
}

export async function snapshotPage(
  args: SnapshotPageArgs | undefined,
): Promise<SnapshotPageOutput> {
  if (!args || typeof args !== 'object') {
    return {
      status: 'error',
      message: 'Invalid arguments object.',
      error: { code: 'INVALID_INPUT', message: 'args must be an object.' },
    };
  }

  const url = readString(args.url, 'url');
  const featureName = readString(args.featureName, 'featureName');
  const pageName = readString(args.pageName, 'pageName');

  if (!url) {
    const err = createToolError(
      'INVALID_INPUT',
      '`url` is required and must be a non-empty string.',
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }
  if (!featureName) {
    const err = createToolError(
      'INVALID_INPUT',
      '`featureName` is required and must be a non-empty string.',
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }
  if (!pageName) {
    const err = createToolError(
      'INVALID_INPUT',
      '`pageName` is required and must be a non-empty string.',
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }

  const include = Array.isArray(args.include)
    ? args.include.filter((v): v is string => typeof v === 'string')
    : undefined;
  const role = readString(args.role, 'role') ?? undefined;
  const exploreModals = readBoolean(args.exploreModals);
  const maxElements = readNumber(args.maxElements, 'maxElements') ?? DEFAULT_MAX_ELEMENTS;
  const force = readBoolean(args.force);
  const waitUntil = readWaitUntil(args.waitUntil);
  const navigationTimeoutMs =
    readNumber(args.navigationTimeoutMs, 'navigationTimeoutMs') ?? undefined;

  try {
    const result = await snapshotPageCore({
      url,
      featureName,
      pageName,
      role,
      exploreModals,
      waitForSelector: readString(args.waitForSelector, 'waitForSelector') ?? undefined,
      include,
      maxElements,
      force,
      waitUntil,
      navigationTimeoutMs: navigationTimeoutMs ?? undefined,
    });

    const semanticSummary = result.semantic
      ? {
          tablesCount: result.semantic.tables.length,
          treegridsCount: result.semantic.treegrids.length,
          treeViewsCount: result.semantic.treeViews.length,
          kanbanBoardsCount: result.semantic.kanbanBoards.length,
          radioGroupsCount: result.semantic.radioGroups.length,
          toggleSwitchesCount: result.semantic.toggleSwitches.length,
          slidersCount: result.semantic.sliders.length,
          spinbuttonsCount: result.semantic.spinbuttons.length,
          breadcrumbsCount: result.semantic.breadcrumbs.length,
          paginationsCount: result.semantic.paginations.length,
          accordionsCount: result.semantic.accordions.length,
          actionMenusCount: result.semantic.actionMenus.length,
          commandPalettesCount: result.semantic.commandPalettes.length,
          chartsCount: result.semantic.charts.length,
          progressBarsCount: result.semantic.progressBars.length,
          statCardsCount: result.semantic.statCards.length,
          tabsCount: result.semantic.tabs.length,
          steppersCount: result.semantic.steppers.length,
          formsCount: result.semantic.forms.length,
          modalsCount: result.semantic.modalsAndDrawers.length,
          subRoutesCount: result.semantic.subRoutes.length,
        }
      : undefined;

    return {
      status: 'success',
      featureName: result.featureName,
      pageName: result.pageName,
      url: result.url,
      role: result.role,
      hash: result.hash,
      elementCount: result.elementCount,
      truncated: result.truncated,
      ariaYmlPath: result.ariaYmlRelativePath,
      selectorsJsonPath: result.selectorsJsonRelativePath,
      semanticSummary,
      skipped: result.skipped,
      skipReason: result.skipReason,
      message: result.skipped
        ? `Catalog already fresh for "${result.pageName}". Reuse ${result.selectorsJsonRelativePath}.`
        : `Captured ${result.elementCount} element(s) → ${result.selectorsJsonRelativePath}`,
    };
  } catch (error) {
    if (error instanceof SnapshotCoreError) {
      const err = createToolError(error.code, error.message);
      return { status: 'error', message: err.error.message, error: err.error };
    }
    const message = error instanceof Error ? error.message : String(error);
    const err = createToolError('TOOL_ERROR', message);
    return { status: 'error', message: err.error.message, error: err.error };
  }
}
