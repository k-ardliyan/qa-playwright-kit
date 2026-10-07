/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';
import {
  IconArrowLeft,
  IconCircleCheck,
  IconCircleSlash2,
  IconCircleX,
  IconHammer,
  IconSquarePen,
  IconTriangleAlert,
  IconX,
} from './icons';

/**
 * String-template icon helpers.
 *
 * `build-fragments.ts` and `build-history-view.ts` compose raw HTML strings
 * rather than KitaJS elements, so they cannot render a component directly.
 * These wrappers serialise the SAME Lucide components the TSX paths use, which
 * keeps one source of truth for icon geometry — a glyph can never drift between
 * the two renderers.
 */

function svg(children: Children): string {
  return String(children);
}

export const iconCircleCheck = (size = 13) => svg(<IconCircleCheck size={size} />);
export const iconCircleX = (size = 13) => svg(<IconCircleX size={size} />);
export const iconCircleSlash = (size = 13) => svg(<IconCircleSlash2 size={size} />);
export const iconHammer = (size = 13) => svg(<IconHammer size={size} />);
export const iconTriangleAlert = (size = 13) => svg(<IconTriangleAlert size={size} />);
export const iconX = (size = 14) => svg(<IconX size={size} />);
export const iconSquarePen = (size = 12) => svg(<IconSquarePen size={size} />);
export const iconArrowLeft = (size = 14) => svg(<IconArrowLeft size={size} />);
