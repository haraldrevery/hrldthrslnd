/**
 * The small values an author types into a block's settings: a CSS length
 * (a gallery's gap, a tile height) and a picture ratio.
 *
 * Read the same way by the validator, which says when one cannot be read, and
 * by the renderer, which then leaves it out — so an unreadable value is a
 * warning in the editor and the default on the page, never a broken style
 * attribute. Both are narrow on purpose: whatever passes here is written into
 * a style attribute as it is.
 *
 * Pure: no imports, nothing on disk.
 */

const LENGTH = /^(\d*\.?\d+)(rem|em|px|%|vw|vh|ch)$/;

/**
 * A CSS length as typed, or null. `percent: false` for a height, which has
 * nothing to be a percentage of; `positive: true` where zero means nothing is
 * shown.
 */
export function cssLength(value, { percent = true, positive = false } = {}) {
  const v = String(value ?? "").trim();
  const m = LENGTH.exec(v);
  if (!m) return null;
  if (!percent && m[2] === "%") return null;
  if (positive && !(Number(m[1]) > 0)) return null;
  return v;
}

/** The narrowest and the widest ratio a cell may be cropped to. */
export const RATIO_RANGE = [1 / 5, 5];

const RATIO = /^(\d*\.?\d+)\s*(?:[:/x×]\s*(\d*\.?\d+))?$/i;

/**
 * A width-over-height ratio from "3:2", "3/2", "3x2" or "1.5", or null when it
 * is not one or falls outside RATIO_RANGE — past 5:1 a cell is a strip, and
 * the picture in it is mostly cropped away.
 */
export function parseRatio(value) {
  const m = RATIO.exec(String(value ?? "").trim());
  if (!m) return null;
  const ratio = m[2] === undefined ? Number(m[1]) : Number(m[1]) / Number(m[2]);
  return Number.isFinite(ratio) && ratio >= RATIO_RANGE[0] && ratio <= RATIO_RANGE[1] ? ratio : null;
}
