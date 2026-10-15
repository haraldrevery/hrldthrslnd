/**
 * Advance widths, read from the site's own font file.
 *
 * The title card sizes its title so the longest word fits on one line (see
 * .cine-title in css/input.css), and for that it needs the word's real width,
 * not an average letter's. Every letter of that title is its own inline-block,
 * so no kerning or ligature reaches from one to the next: a word is exactly the
 * sum of its glyphs' advances, plus the tracking after each. Those advances are
 * in the font — cmap finds the glyph, hmtx holds its advance, head says how many
 * units make an em — and measured in Chromium they match the file to the third
 * decimal, because `font-synthesis: none` keeps the browser from widening a
 * faked bold.
 *
 * The TrueType file, not the WOFF2 the browser downloads: that is the same
 * tables inside a Brotli stream, and the .ttf sits beside it in font/.
 */
import fs from "node:fs";

/**
 * The face the body text — and with it the title card's title — is set in:
 * "Harald Revery Text" in css/input.css. tests/font_metrics.test.js holds the
 * two to the same file.
 */
export const TEXT_FACE = "font/HaraldReveryTextFont.ttf";

/** Faces read so far, by path. A face is read once per build, not per title. */
const cache = new Map();

/**
 * A function from one character to its advance in em, or null when the face
 * does not have it. Null, too, for every character when the file is missing or
 * is not a font this can read.
 */
export function faceAdvances(file) {
  if (!cache.has(file)) {
    let advance = () => null;
    try {
      advance = parseAdvances(fs.readFileSync(file));
    } catch {
      // Missing or unreadable: every letter goes unmeasured, which the caller
      // already has to allow for — a letter the face lacks is unmeasured too.
    }
    cache.set(file, advance);
  }
  return cache.get(file);
}

/** The same, from the bytes of a TrueType or OpenType file. Throws on anything else. */
export function parseAdvances(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = {};
  for (let i = 0, count = view.getUint16(4); i < count; i++) {
    const record = 12 + 16 * i;
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
    tables[tag] = view.getUint32(record + 8);
  }
  const { head, hhea, hmtx, cmap } = tables;
  if ([head, hhea, hmtx, cmap].includes(undefined)) throw new Error("not a font with head, hhea, hmtx and cmap");

  const unitsPerEm = view.getUint16(head + 18);
  const metrics = view.getUint16(hhea + 34);
  const glyphOf = cmapLookup(view, cmap);
  // Glyphs past the last full metric share its advance; that is how hmtx
  // stores a run of monospaced glyphs at the end.
  const advanceOf = (glyph) => view.getUint16(hmtx + 4 * Math.min(glyph, metrics - 1)) / unitsPerEm;

  return (char) => {
    const point = char.codePointAt(0);
    // A face without a no-break space of its own is drawn with its space by
    // every browser, and that is the width the title gets.
    const glyph = glyphOf(point) || (point === 0xa0 ? glyphOf(0x20) : 0);
    return glyph ? advanceOf(glyph) : null;
  };
}

/**
 * Code point to glyph id, 0 for none. Format 12 where the font has one, since
 * it covers every plane; format 4 otherwise, which is what a font limited to
 * the Basic Multilingual Plane carries alone.
 */
function cmapLookup(view, cmap) {
  const subtables = [];
  for (let i = 0, count = view.getUint16(cmap + 2); i < count; i++) {
    const record = cmap + 4 + 8 * i;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    // Unicode platform, or Windows Unicode (BMP or full repertoire).
    if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) {
      const at = cmap + view.getUint32(record + 4);
      subtables.push({ at, format: view.getUint16(at) });
    }
  }
  const full = subtables.find((s) => s.format === 12);
  if (full) return format12(view, full.at);
  const basic = subtables.find((s) => s.format === 4);
  if (basic) return format4(view, basic.at);
  throw new Error("no Unicode cmap in format 12 or 4");
}

function format12(view, at) {
  const groups = view.getUint32(at + 12);
  return (point) => {
    for (let i = 0; i < groups; i++) {
      const group = at + 16 + 12 * i;
      const start = view.getUint32(group);
      if (point >= start && point <= view.getUint32(group + 4)) return view.getUint32(group + 8) + point - start;
    }
    return 0;
  };
}

function format4(view, at) {
  const segments = view.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const offsets = deltas + 2 * segments;
  return (point) => {
    if (point > 0xffff) return 0;
    for (let i = 0; i < segments; i++) {
      if (point > view.getUint16(ends + 2 * i)) continue;
      const start = view.getUint16(starts + 2 * i);
      if (point < start) return 0;
      const delta = view.getUint16(deltas + 2 * i);
      const offset = view.getUint16(offsets + 2 * i);
      if (offset === 0) return (point + delta) & 0xffff;
      const glyph = view.getUint16(offsets + 2 * i + offset + 2 * (point - start));
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}
