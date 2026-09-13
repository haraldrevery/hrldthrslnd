/**
 * How wide a tile's text sets, estimated from its characters, and the number
 * of columns a tile grid takes from that.
 *
 * The build has no browser, so it cannot measure type. It estimates: a line of
 * a tile is its characters times the width one character of that style takes,
 * measured once on the live site (block_test_page.html's "Extended readout",
 * in a 1440-wide window) and written down here. What it feeds is coarse —
 * three to six columns — so an estimate within a sixth of the truth changes
 * nothing. If theme.css changes the size of .display-sm, .micro or --step--1,
 * measure again and change the numbers here, and nowhere else.
 *
 * Pure: no imports, nothing on disk.
 */

/** Widths in px at the reference window, with the root at 16px. */
export const TILE_METRICS = {
  referencePx: 1360, // the column in a 1440-wide window: 1440 less 2.5rem either side
  minPx: 208, //         13rem, the narrowest a tile gets
  paddingPx: 40, //      .stat-grid > * pads 1.25rem either side
  labelChar: 11.2, //    .micro: the mono face, uppercase, with its tracking
  titleChar: 12.4, //    .display-sm at its 1.6rem ceiling: mono, uppercase, with its tracking
  textChar: 7.4, //      --step--1 in the text face
  titleLines: 2, //      a tile heading may take two lines;
  textLines: 5, //       its text about five, before the tile is taller than its row wants
};

const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean);
const longestWord = (s) => words(s).reduce((most, w) => Math.max(most, [...w].length), 0);
const length = (s) => [...String(s ?? "").trim().replace(/\s+/g, " ")].length;

/** The label a tile is printed with: its number, then its own label. */
export function tileLabel(tile, index) {
  return [String(index + 1).padStart(2, "0"), String(tile?.label ?? "").trim()].filter(Boolean).join(" · ");
}

/**
 * The width in px one tile needs so that nothing in it is squeezed: the label
 * on one line, no heading word broken, the heading in two lines and the text
 * in about five.
 */
export function tileNeed(tile, index, m = TILE_METRICS) {
  return m.paddingPx + Math.max(
    length(tileLabel(tile, index)) * m.labelChar,
    longestWord(tile?.title) * m.titleChar,
    (length(tile?.title) * m.titleChar) / m.titleLines,
    longestWord(tile?.text) * m.textChar,
    (length(tile?.text) * m.textChar) / m.textLines,
  );
}

/**
 * The columns for `count` tiles on a wide screen, when as many as `fit` would
 * fit: three to six, never more than there are tiles, and of those the count
 * that leaves the fewest empty cells in the last row — the most columns when
 * two tie. Six tiles that would fit five across are 3 + 3, not 5 + 1.
 */
export function balancedColumns(count, fit) {
  if (count <= 3) return Math.max(1, count);
  const top = Math.min(6, count, Math.max(3, fit));
  const empty = (n) => (n - (count % n)) % n;
  let best = 3;
  for (let n = 4; n <= top; n += 1) if (empty(n) <= empty(best)) best = n;
  return best;
}

/**
 * A tile grid's layout: how many columns it has on a wide screen, and the
 * narrowest a tile may get (in rem) before a narrower screen gives up a
 * column rather than squeeze its text.
 *
 * `columns` is the block's choice: "auto", or 3 to 6 as the author's own
 * count, which is taken as it is (never more than the tiles). Either way the
 * minimum never stops the chosen count fitting in the reference window.
 */
export function tileLayout(tiles, columns = "auto", m = TILE_METRICS) {
  const list = Array.isArray(tiles) ? tiles : [];
  const need = Math.max(m.minPx, ...list.map((tile, i) => tileNeed(tile, i, m)));
  const chosen = /^[3-6]$/.test(String(columns))
    ? Math.min(Number(columns), Math.max(1, list.length))
    : balancedColumns(list.length, Math.floor(m.referencePx / need));
  const minPx = Math.min(need, m.referencePx / chosen);
  return { columns: chosen, tileMin: Math.floor((minPx / 16) * 4) / 4, need: Math.round(need) };
}
